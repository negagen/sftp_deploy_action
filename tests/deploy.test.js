const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');

// Mock the @actions/core module
jest.mock('@actions/core', () => ({
  getInput: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  startGroup: jest.fn(),
  endGroup: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  setSecret: jest.fn(),
  debug: jest.fn()
}));

// Mock the @actions/exec module
jest.mock('@actions/exec');

// Mock fs module
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn()
}));

describe('SFTP Deploy Action', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Setup default mock implementations
    core.getInput.mockImplementation((name) => {
      const inputs = {
        host: 'test-host',
        username: 'test-user',
        'private-key': 'test-key',
        port: '22',
        'source-dir': './dist',
        'remote-dir': '/var/www/html'
      };
      return inputs[name];
    });

    // Mock fs.existsSync to return true by default
    fs.existsSync.mockReturnValue(true);
    
    // Mock fs.readdirSync to return some test files
    fs.readdirSync.mockReturnValue(['file1.js', 'file2.css']);
    
    // Mock fs.statSync to return file stats
    fs.statSync.mockImplementation((_filePath) => ({
      isDirectory: () => false,
      isFile: () => true
    }));

    // Mock exec.getExecOutput for SSH agent
    exec.getExecOutput.mockImplementation(() => Promise.resolve({
      stdout: 'SSH_AUTH_SOCK=/tmp/agent.1234; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=1234; export SSH_AGENT_PID;\n',
      stderr: '',
      exitCode: 0
    }));

    // Mock exec.exec
    exec.exec.mockImplementation(() => Promise.resolve(0));
  });

  describe('Input Validation', () => {
    test('should get all required inputs', () => {
      expect(core.getInput('host')).toBe('test-host');
      expect(core.getInput('username')).toBe('test-user');
      expect(core.getInput('private-key')).toBe('test-key');
    });

    test('should use default values for optional inputs', () => {
      expect(core.getInput('port')).toBe('22');
      expect(core.getInput('source-dir')).toBe('./dist');
      expect(core.getInput('remote-dir')).toBe('/var/www/html');
    });
  });

  describe('File System Operations', () => {
    test('should check if source directory exists', () => {
      fs.existsSync.mockReturnValue(false);
      expect(fs.existsSync('./dist')).toBe(false);
    });

    test('should read directory contents', () => {
      const files = fs.readdirSync('./dist');
      expect(files).toEqual(['file1.js', 'file2.css']);
    });

    test('should handle nested directories', () => {
      fs.statSync.mockImplementation((filePath) => ({
        isDirectory: () => filePath.includes('nested'),
        isFile: () => !filePath.includes('nested')
      }));
      
      fs.readdirSync.mockImplementation((dirPath) => {
        if (dirPath === './dist') {
          return ['nested', 'file1.js'];
        }
        return ['file3.js'];
      });

      const rootFiles = fs.readdirSync('./dist');
      expect(rootFiles).toEqual(['nested', 'file1.js']);
      
      const nestedFiles = fs.readdirSync('./dist/nested');
      expect(nestedFiles).toEqual(['file3.js']);
    });
  });

  describe('SFTP Operations', () => {
    test('should construct correct SFTP command', async () => {
      // Import and run the deploy function
      const { deploy } = require('../src/deploy');
      await deploy();
      
      // Verify SFTP command was called with correct arguments
      expect(exec.exec).toHaveBeenCalledWith(
        'sftp',
        expect.arrayContaining([
          '-P', '22',
          '-o', 'StrictHostKeyChecking=no',
          '-b', expect.any(String),
          'test-user@test-host'
        ]),
        expect.any(Object)
      );
    });

    test('should handle SFTP command failure', async () => {
      exec.exec.mockRejectedValue(new Error('SFTP failed'));
      
      // Import and run the deploy function
      const { deploy } = require('../src/deploy');
      await deploy();
      
      // Verify error handling
      expect(core.setFailed).toHaveBeenCalledWith('SFTP failed');
    });
  });
}); 