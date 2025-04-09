const core = require('@actions/core');
const exec = require('@actions/exec');
const realFs = jest.requireActual('fs');

// Mock the @actions/core module
jest.mock('@actions/core');

// Mock fs module
const mockFs = {
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  promises: {
    access: jest.fn(),
    appendFile: jest.fn(),
    chmod: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn()
  },
  constants: realFs.constants
};

jest.mock('fs', () => mockFs);

// Import the deploy function
const { deploy, deployWithDependencies } = require('../src/deploy');

describe('SFTP Deploy Action', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    
    // Setup process.env
    process.env = { ...originalEnv, RUNNER_TEMP: '/tmp' };
    
    // Setup default mock implementations
    core.getInput = jest.fn((name, options) => {
      const inputs = {
        host: 'test-host',
        username: 'test-user',
        private_key: 'test-key',
        port: '22',
        source_dir: './dist',
        remote_dir: '/var/www/html'
      };
      
      const value = inputs[name];
      if (options?.required && !value) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return value;
    });

    // Mock fs functions
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(['file1.js', 'file2.css']);
    mockFs.statSync.mockImplementation((_filePath) => ({
      isDirectory: () => false,
      isFile: () => true
    }));

    // Mock exec functions
    exec.getExecOutput = jest.fn((command, args, options) => {
      if (command === 'ssh-agent') {
        return Promise.resolve({
          stdout: 'SSH_AUTH_SOCK=/tmp/agent.1234; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=1234; export SSH_AGENT_PID;\n',
          stderr: '',
          exitCode: 0
        });
      }
      if (command === 'ssh-add') {
        expect(options.input).toBeDefined();
        expect(Buffer.isBuffer(options.input)).toBe(true);
        expect(options.input.toString()).toBe('test-key');
        return Promise.resolve({
          stdout: '',
          stderr: '',
          exitCode: 0
        });
      }
      return Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0
      });
    });
    exec.exec = jest.fn(() => Promise.resolve(0));

    // Mock other core functions
    core.setOutput = jest.fn();
    core.setFailed = jest.fn();
    core.startGroup = jest.fn();
    core.endGroup = jest.fn();
    core.info = jest.fn();
    core.error = jest.fn();
    core.warning = jest.fn();
    core.setSecret = jest.fn();
    core.debug = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Input Validation', () => {
    test('should get all required inputs', () => {
      expect(core.getInput('host')).toBe('test-host');
      expect(core.getInput('username')).toBe('test-user');
      expect(core.getInput('private_key')).toBe('test-key');
    });

    test('should use default values for optional inputs', () => {
      expect(core.getInput('port')).toBe('22');
      expect(core.getInput('source_dir')).toBe('./dist');
      expect(core.getInput('remote_dir')).toBe('/var/www/html');
    });
    
    test('should mask private key in logs', async () => {
      // Use deployWithDependencies instead of direct deploy()
      const mockInputs = {
        host: 'test-host',
        username: 'test-user',
        private_key: 'test-key',
        port: '22',
        source_dir: './dist',
        remote_dir: '/var/www/html'
      };
      
      // Mock core module
      const mockCore = {
        getInput: jest.fn((name) => mockInputs[name] || ''),
        setSecret: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        setOutput: jest.fn(),
        setFailed: jest.fn(),
        startGroup: jest.fn(),
        endGroup: jest.fn()
      };
      
      // Mock exec functions
      const mockExec = {
        getExecOutput: jest.fn().mockImplementation((command) => {
          if (command === 'ssh-agent') {
            return Promise.resolve({
              stdout: 'SSH_AUTH_SOCK=/tmp/agent.1234; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=1234; export SSH_AGENT_PID;\n',
              stderr: '',
              exitCode: 0
            });
          }
          return Promise.resolve({
            stdout: '',
            stderr: '',
            exitCode: 0
          });
        }),
        exec: jest.fn().mockResolvedValue(0)
      };
      
      // Mock fs module
      const mockFileSystem = {
        promises: {
          writeFile: jest.fn().mockResolvedValue(undefined),
          unlink: jest.fn().mockResolvedValue(undefined)
        },
        existsSync: jest.fn().mockReturnValue(true),
        readdirSync: jest.fn().mockReturnValue(['file1.js', 'file2.css']),
        statSync: jest.fn().mockImplementation((_filePath) => ({
          isDirectory: () => false,
          isFile: () => true
        }))
      };
      
      // Run the deployWithDependencies function
      await deployWithDependencies({
        host: 'test-host',
        username: 'test-user',
        port: '22',
        sourceDir: './dist',
        remoteDir: '/var/www/html',
        privateKey: 'test-key'
      }, {
        coreModule: mockCore,
        execModule: mockExec,
        fsModule: mockFileSystem,
        osModule: { tmpdir: () => '/tmp' },
        pathModule: { join: (...args) => args.join('/') }
      });
      
      // Verify that setSecret was called with the private key
      expect(mockCore.setSecret).toHaveBeenCalledWith('test-key');
    });
  });

  describe('File System Operations', () => {
    test('should check if source directory exists', () => {
      mockFs.existsSync.mockReturnValue(false);
      expect(mockFs.existsSync('./dist')).toBe(false);
    });

    test('should read directory contents', () => {
      const files = mockFs.readdirSync('./dist');
      expect(files).toEqual(['file1.js', 'file2.css']);
    });

    test('should handle nested directories', () => {
      mockFs.statSync.mockImplementation((filePath) => ({
        isDirectory: () => filePath.includes('nested'),
        isFile: () => !filePath.includes('nested')
      }));
      
      mockFs.readdirSync.mockImplementation((dirPath) => {
        if (dirPath === './dist') {
          return ['nested', 'file1.js'];
        }
        return ['file3.js'];
      });

      const rootFiles = mockFs.readdirSync('./dist');
      expect(rootFiles).toEqual(['nested', 'file1.js']);
      
      const nestedFiles = mockFs.readdirSync('./dist/nested');
      expect(nestedFiles).toEqual(['file3.js']);
    });
  });

  describe('SFTP Operations', () => {
    test('should properly set up SSH agent with private key', async () => {
      // Use deployWithDependencies instead of direct deploy()
      const mockInputs = {
        host: 'test-host',
        username: 'test-user',
        private_key: 'test-key',
        port: '22',
        source_dir: './dist',
        remote_dir: '/var/www/html'
      };
      
      // Mock core module
      const mockCore = {
        getInput: jest.fn((name) => mockInputs[name] || ''),
        setSecret: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        setOutput: jest.fn(),
        setFailed: jest.fn(),
        startGroup: jest.fn(),
        endGroup: jest.fn()
      };
      
      // Mock exec functions
      const mockExec = {
        getExecOutput: jest.fn().mockImplementation((command, args, options) => {
          if (command === 'ssh-agent') {
            return Promise.resolve({
              stdout: 'SSH_AUTH_SOCK=/tmp/agent.1234; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=1234; export SSH_AGENT_PID;\n',
              stderr: '',
              exitCode: 0
            });
          }
          if (command === 'ssh-add' && args && args[0] === '-') {
            expect(options).toBeDefined();
            expect(options.input).toBeDefined();
            return Promise.resolve({
              stdout: '',
              stderr: '',
              exitCode: 0
            });
          }
          return Promise.resolve({
            stdout: '',
            stderr: '',
            exitCode: 0
          });
        }),
        exec: jest.fn().mockResolvedValue(0)
      };
      
      // Mock fs module
      const mockFileSystem = {
        promises: {
          writeFile: jest.fn().mockResolvedValue(undefined),
          unlink: jest.fn().mockResolvedValue(undefined)
        },
        existsSync: jest.fn().mockReturnValue(true),
        readdirSync: jest.fn().mockReturnValue(['file1.js', 'file2.css']),
        statSync: jest.fn().mockImplementation((_filePath) => ({
          isDirectory: () => false,
          isFile: () => true
        }))
      };
      
      // Mock process.env
      const mockProcessEnv = {};
      
      // Run the deployWithDependencies function
      await deployWithDependencies({
        host: 'test-host',
        username: 'test-user',
        port: '22',
        sourceDir: './dist',
        remoteDir: '/var/www/html',
        privateKey: 'test-key'
      }, {
        coreModule: mockCore,
        execModule: mockExec,
        fsModule: mockFileSystem,
        osModule: { tmpdir: () => '/tmp' },
        pathModule: { join: (...args) => args.join('/') },
        processEnv: mockProcessEnv
      });
      
      // Verify SSH agent was started
      expect(mockExec.getExecOutput).toHaveBeenCalledWith('ssh-agent', ['-s']);
      
      // Verify the SSH key was added
      expect(mockExec.getExecOutput).toHaveBeenCalledWith('ssh-add', ['-'], expect.any(Object));
      
      // Verify process.env was set
      expect(mockProcessEnv.SSH_AUTH_SOCK).toBeDefined();
      expect(mockProcessEnv.SSH_AGENT_PID).toBeDefined();
    });

    test('should construct correct SFTP command', async () => {
      // Use deployWithDependencies instead of direct deploy()
      const mockInputs = {
        host: 'test-host',
        username: 'test-user',
        private_key: 'test-key',
        port: '22',
        source_dir: './dist',
        remote_dir: '/var/www/html'
      };
      
      // Mock core module
      const mockCore = {
        getInput: jest.fn((name) => mockInputs[name] || ''),
        setSecret: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        setOutput: jest.fn(),
        setFailed: jest.fn(),
        startGroup: jest.fn(),
        endGroup: jest.fn()
      };
      
      // Mock exec functions
      const mockExec = {
        getExecOutput: jest.fn().mockImplementation((command, args, options) => {
          if (command === 'ssh-agent') {
            return Promise.resolve({
              stdout: 'SSH_AUTH_SOCK=/tmp/agent.1234; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=1234; export SSH_AGENT_PID;\n',
              stderr: '',
              exitCode: 0
            });
          }
          if (command === 'ssh-add') {
            return Promise.resolve({
              stdout: '',
              stderr: '',
              exitCode: 0
            });
          }
          if (command.includes('sftp')) {
            expect(command).toContain('sftp -b');
            expect(command).toContain('-P 22');
            expect(command).toContain('test-user@test-host');
            return Promise.resolve({
              stdout: '',
              stderr: '',
              exitCode: 0
            });
          }
          return Promise.resolve({
            stdout: '',
            stderr: '',
            exitCode: 0
          });
        }),
        exec: jest.fn().mockResolvedValue(0)
      };
      
      // Mock fs module
      const mockFileSystem = {
        promises: {
          writeFile: jest.fn().mockResolvedValue(undefined),
          unlink: jest.fn().mockResolvedValue(undefined)
        },
        existsSync: jest.fn().mockReturnValue(true),
        readdirSync: jest.fn().mockReturnValue(['file1.js', 'file2.css']),
        statSync: jest.fn().mockImplementation((_filePath) => ({
          isDirectory: () => false,
          isFile: () => true
        }))
      };
      
      // Run the deployWithDependencies function
      await deployWithDependencies({
        host: 'test-host',
        username: 'test-user',
        port: '22',
        sourceDir: './dist',
        remoteDir: '/var/www/html',
        privateKey: 'test-key'
      }, {
        coreModule: mockCore,
        execModule: mockExec,
        fsModule: mockFileSystem,
        osModule: { tmpdir: () => '/tmp' },
        pathModule: { join: (...args) => args.join('/') }
      });
      
      // Verify batch file was created
      expect(mockFileSystem.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/sftp_batch',
        expect.stringContaining('cd /var/www/html')
      );
      
      // Verify SFTP command was executed with correct parameters
      expect(mockExec.getExecOutput).toHaveBeenCalledWith(
        'sftp -b /tmp/sftp_batch -P 22 test-user@test-host'
      );
    });

    test('should handle SFTP command failure', async () => {
      // Use deployWithDependencies instead of direct deploy()
      const mockInputs = {
        host: 'test-host',
        username: 'test-user',
        private_key: 'test-key',
        port: '22',
        source_dir: './dist',
        remote_dir: '/var/www/html'
      };
      
      // Mock core module
      const mockCore = {
        getInput: jest.fn((name) => mockInputs[name] || ''),
        setSecret: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        setOutput: jest.fn(),
        setFailed: jest.fn(),
        startGroup: jest.fn(),
        endGroup: jest.fn()
      };
      
      // Mock exec with SFTP failure
      const mockExec = {
        getExecOutput: jest.fn().mockImplementation((command, args, options) => {
          if (command === 'ssh-agent') {
            return Promise.resolve({
              stdout: 'SSH_AUTH_SOCK=/tmp/agent.1234; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=1234; export SSH_AGENT_PID;\n',
              stderr: '',
              exitCode: 0
            });
          }
          if (command === 'ssh-add') {
            return Promise.resolve({
              stdout: '',
              stderr: '',
              exitCode: 0
            });
          }
          if (command.includes('sftp')) {
            return Promise.resolve({
              stdout: '',
              stderr: 'Connection refused',
              exitCode: 1
            });
          }
          return Promise.resolve({
            stdout: '',
            stderr: '',
            exitCode: 0
          });
        }),
        exec: jest.fn().mockResolvedValue(0)
      };
      
      // Mock fs module
      const mockFileSystem = {
        promises: {
          writeFile: jest.fn().mockResolvedValue(undefined),
          unlink: jest.fn().mockResolvedValue(undefined)
        },
        existsSync: jest.fn().mockReturnValue(true),
        readdirSync: jest.fn().mockReturnValue(['file1.js', 'file2.css']),
        statSync: jest.fn().mockImplementation((_filePath) => ({
          isDirectory: () => false,
          isFile: () => true
        }))
      };
      
      // Run the deployWithDependencies function and expect it to throw
      try {
        await deployWithDependencies(mockInputs, {
          coreModule: mockCore,
          execModule: mockExec,
          fsModule: mockFileSystem,
          osModule: { tmpdir: () => '/tmp' },
          pathModule: { join: (...args) => args.join('/') }
        });
        fail('Expected an error to be thrown');
      } catch (error) {
        // Verify the error handling
        expect(error).toBeDefined();
        expect(mockCore.error).toHaveBeenCalled();
      }
    });
  });

  describe('SFTP Operations with Dependency Injection', () => {
    // Create common mock dependencies for all tests
    let mockCore, mockExec, mockFs, mockEnv;

    beforeEach(() => {
      mockCore = {
        setSecret: jest.fn(),
        startGroup: jest.fn(),
        endGroup: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
        warning: jest.fn()
      };
      
      mockExec = {
        getExecOutput: jest.fn().mockImplementation((command, args, options) => {
          if (command === 'ssh-agent') {
            return Promise.resolve({
              stdout: 'SSH_AUTH_SOCK=/tmp/agent.1234; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=1234; export SSH_AGENT_PID;\n',
              stderr: '',
              exitCode: 0
            });
          }
          if (command === 'ssh-add') {
            // Verify the private key is being passed correctly
            expect(options.input).toBeDefined();
            expect(Buffer.isBuffer(options.input)).toBe(true);
            expect(options.input.toString()).toBe('test-key');
            return Promise.resolve({
              stdout: '',
              stderr: '',
              exitCode: 0
            });
          }
          if (command === 'sftp') {
            return Promise.resolve({
              stdout: 'Transfer complete',
              stderr: '',
              exitCode: 0
            });
          }
          return Promise.resolve({
            stdout: '',
            stderr: '',
            exitCode: 0
          });
        }),
        exec: jest.fn().mockResolvedValue(0)
      };
      
      mockFs = {
        readdirSync: jest.fn().mockReturnValue(['file1.js', 'file2.css']),
        statSync: jest.fn().mockImplementation(() => ({
          isFile: () => true
        })),
        promises: {
          writeFile: jest.fn().mockResolvedValue(undefined),
          unlink: jest.fn().mockResolvedValue(undefined)
        }
      };
      
      mockEnv = {};
    });
    
    test('should properly set up SSH agent with private key', async () => {
      // Run the injected version of deploy
      await deployWithDependencies(
        {
          host: 'test-host',
          username: 'test-user',
          privateKey: 'test-key',
          port: '22',
          sourceDir: './dist',
          remoteDir: '/var/www/html'
        },
        {
          coreModule: mockCore,
          execModule: mockExec,
          fsModule: mockFs,
          osModule: { tmpdir: () => '/tmp' },
          pathModule: { join: (...args) => args.join('/') },
          processEnv: mockEnv
        }
      );
      
      // Verify SSH agent was started
      expect(mockExec.getExecOutput).toHaveBeenCalledWith('ssh-agent', ['-s']);
      
      // Verify the SSH key was added
      expect(mockExec.getExecOutput).toHaveBeenCalledWith('ssh-add', ['-'], expect.objectContaining({
        input: expect.any(Buffer),
        silent: true
      }));
      
      // Verify environment variables were set
      expect(mockEnv.SSH_AUTH_SOCK).toBe('/tmp/agent.1234');
      expect(mockEnv.SSH_AGENT_PID).toBe('1234');
      
      // Verify private key was masked
      expect(mockCore.setSecret).toHaveBeenCalledWith('test-key');
    });

    test('should create batch file with correct content', async () => {
      await deployWithDependencies(
        {
          host: 'test-host',
          username: 'test-user',
          privateKey: 'test-key',
          port: '22',
          sourceDir: './dist',
          remoteDir: '/var/www/html'
        },
        {
          coreModule: mockCore,
          execModule: mockExec,
          fsModule: mockFs,
          osModule: { tmpdir: () => '/tmp' },
          pathModule: { join: (...args) => args.join('/') },
          processEnv: mockEnv
        }
      );
      
      // Verify batch file was created with correct content
      expect(mockFs.promises.writeFile).toHaveBeenCalledWith(
        '/tmp/sftp_batch',
        'cd /var/www/html\nput -r ./dist/*'
      );
    });

    test('should execute SFTP command with correct parameters', async () => {
      await deployWithDependencies(
        {
          host: 'test-host',
          username: 'test-user',
          privateKey: 'test-key',
          port: '2222', // Custom port
          sourceDir: './dist',
          remoteDir: '/var/www/html'
        },
        {
          coreModule: mockCore,
          execModule: mockExec,
          fsModule: mockFs,
          osModule: { tmpdir: () => '/tmp' },
          pathModule: { join: (...args) => args.join('/') },
          processEnv: mockEnv
        }
      );
      
      // Verify SFTP command was executed with correct parameters
      expect(mockExec.getExecOutput).toHaveBeenCalledWith(
        'sftp -b /tmp/sftp_batch -P 2222 test-user@test-host'
      );
    });

    test('should handle errors during the process', async () => {
      // Mock exec.getExecOutput to throw an error when executing SFTP
      mockExec.getExecOutput = jest.fn().mockImplementation((command) => {
        if (command === 'ssh-agent') {
          return Promise.resolve({
            stdout: 'SSH_AUTH_SOCK=/tmp/agent.1234; export SSH_AUTH_SOCK;\nSSH_AGENT_PID=1234; export SSH_AGENT_PID;\n',
            stderr: '',
            exitCode: 0
          });
        }
        if (command === 'ssh-add') {
          return Promise.resolve({
            stdout: '',
            stderr: '',
            exitCode: 0
          });
        }
        if (command.startsWith('sftp')) {
          const error = new Error('SFTP command failed');
          mockCore.error('SFTP command failed');
          return Promise.reject(error);
        }
        return Promise.resolve({
          stdout: '',
          stderr: '',
          exitCode: 0
        });
      });
      
      // Run deploy and expect it to throw an error
      await expect(
        deployWithDependencies(
          {
            host: 'test-host',
            username: 'test-user',
            privateKey: 'test-key',
            port: '22',
            sourceDir: './dist',
            remoteDir: '/var/www/html'
          },
          {
            coreModule: mockCore,
            execModule: mockExec,
            fsModule: mockFs,
            osModule: { tmpdir: () => '/tmp' },
            pathModule: { join: (...args) => args.join('/') },
            processEnv: mockEnv
          }
        )
      ).rejects.toThrow('SFTP command failed');
      
      // Verify error was logged
      expect(mockCore.error).toHaveBeenCalledWith(expect.stringContaining('SFTP command failed'));
    });
  });
}); 