const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function checkAndInstallSshTools() {
    core.startGroup('🔧 Checking SSH tools');
    try {
        core.info('Checking if ssh-add is available...');
        const sshAddResult = await exec.getExecOutput('which', ['ssh-add'], { ignoreReturnCode: true });
        
        if (sshAddResult.exitCode !== 0) {
            core.info('ssh-add not found, installing OpenSSH client...');
            
            // Detect platform and install appropriate packages
            if (os.platform() === 'linux') {
                await exec.exec('sudo', ['apt-get', 'update']);
                await exec.exec('sudo', ['apt-get', 'install', '-y', 'openssh-client']);
            } else if (os.platform() === 'darwin') {
                // macOS usually has OpenSSH installed
                core.info('On macOS, OpenSSH should be pre-installed');
            } else if (os.platform() === 'win32') {
                core.warning('On Windows, please ensure OpenSSH is installed via Windows features');
            }
            
            // Verify installation
            const verifyResult = await exec.getExecOutput('which', ['ssh-add'], { ignoreReturnCode: true });
            if (verifyResult.exitCode !== 0) {
                throw new Error('Failed to install or locate ssh-add after installation attempt');
            }
        }
        
        core.info('SSH tools are available');
    } catch (error) {
        core.error('Failed to setup SSH tools');
        core.error(error);
        throw error;
    } finally {
        core.endGroup();
    }
}

async function startSshAgent(privateKey) {
    core.startGroup('🔐 Setting up SSH Agent');
    try {
        if (!privateKey) {
            throw new Error('Private key is required');
        }

        core.info('Starting ssh-agent process...');
        const agentInfo = await exec.getExecOutput('ssh-agent', ['-s']);
        core.info('ssh-agent output:', agentInfo);
        
        if (!agentInfo || !agentInfo.stdout) {
            throw new Error('Failed to get ssh-agent output');
        }

        const authSockMatch = agentInfo.stdout.match(/SSH_AUTH_SOCK=([^;]*)/);
        const agentPidMatch = agentInfo.stdout.match(/SSH_AGENT_PID=([^;]*)/);

        if (!authSockMatch || !agentPidMatch) {
            throw new Error('Failed to parse ssh-agent output');
        }

        const authSock = authSockMatch[1];
        const agentPid = agentPidMatch[1];
        
        process.env.SSH_AUTH_SOCK = authSock;
        process.env.SSH_AGENT_PID = agentPid;
        
        core.info(`SSH Agent started with PID: ${agentPid}`);

        core.info('Adding SSH key to agent...');
        await exec.getExecOutput('ssh-add', ['-'], {
            input: Buffer.from(privateKey),
            silent: true
        });
        
        core.info('SSH key added successfully');
        
        return async () => {
            core.info('Terminating SSH agent...');
            await exec.exec('ssh-agent', ['-k']);
        };
    } catch (error) {
        core.error('Failed to setup SSH agent');
        core.error(error);
        throw error;
    } finally {
        core.endGroup();
    }
}

async function getFileCount(directory) {
    let count = 0;
    const files = fs.readdirSync(directory, { recursive: true });
    for (const file of files) {
        const fullPath = path.join(directory, file);
        if (fs.statSync(fullPath).isFile()) {
            count++;
        }
    }
    return count;
}

async function deploy() {
    console.log('Starting deployment process...');
    try {
        // Check and install SSH tools if needed
        await checkAndInstallSshTools();
        
        // Validate inputs
        console.log('Validating input parameters...');
        const host = core.getInput('host', { required: true });
        const username = core.getInput('username', { required: true });
        const port = core.getInput('port') || '22';
        const sourceDir = core.getInput('source_dir', { required: true });
        const remoteDir = core.getInput('remote_dir', { required: true });
        let privateKey = core.getInput('private_key', { required: true });

        // Normalize private key: ensure it ends with a newline
        if (!privateKey.endsWith('\n')) {
            privateKey += '\n';
            console.log('Added missing newline to private key');
        }

        // Mask private key in logs for security
        core.setSecret(privateKey);

        console.log(`Configuration validated:
            - Host: ${host}
            - Username: ${username}
            - Port: ${port}
            - Source Directory: ${sourceDir}
            - Remote Directory: ${remoteDir}
            - Private Key Length: ${privateKey ? privateKey.length : 0} characters`);

        // Start SSH agent
        console.log('Starting SSH agent...');
        const agentInfo = await startSshAgent(privateKey);
        console.log('SSH agent started successfully:', agentInfo);

        // Create batch file
        console.log('Creating SFTP batch file...');
        const batchFilePath = path.join(os.tmpdir(), 'sftp_batch');
        const fileCount = await getFileCount(sourceDir);
        console.log(`Found ${fileCount} files to transfer in source directory`);

        // Create a better formatted batch file with explicit paths
        // Ensure the remote directory exists first
        let batchFileContent = `-mkdir ${remoteDir}\n`;  // Create directory if it doesn't exist (will be ignored if already exists)
        batchFileContent += `cd ${remoteDir}\n`;
        
        // List all files in source directory and create individual put commands
        // This is more reliable than put -r for some SFTP implementations
        const files = fs.readdirSync(sourceDir, { withFileTypes: true });
        for (const file of files) {
            const sourcePath = path.join(sourceDir, file.name);
            if (file.isFile()) {
                batchFileContent += `put "${sourcePath}" "${file.name}"\n`;
            }
        }
        
        await fs.promises.writeFile(batchFilePath, batchFileContent);
        console.log('SFTP batch file created successfully at:', batchFilePath);
        console.log('Batch file contents:', batchFileContent);

        // Execute SFTP transfer
        console.log('Preparing SFTP command...');
        
        // Create a temporary identity file for this connection
        const identityFile = path.join(os.tmpdir(), 'deploy_identity');
        await fs.promises.writeFile(identityFile, privateKey, { mode: 0o600 });
        console.log(`Identity file created at: ${identityFile}`);
        
        // Use direct SFTP command with explicit identity file instead of ssh-agent
        const sftpCommand = `sftp -v -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${identityFile} -b ${batchFilePath} -P ${port} ${username}@${host}`;
        console.log(`Executing SFTP command: ${sftpCommand}`);

        console.log('Starting file transfer...');
        try {
            const result = await exec.getExecOutput(sftpCommand);
            console.log('SFTP command output:', result.stdout);
            if (result.stderr) {
                console.warn('SFTP command stderr:', result.stderr);
            }
            console.log(`SFTP transfer completed with exit code: ${result.exitCode}`);
            
            // Clean up temporary identity file
            try {
                await fs.promises.unlink(identityFile);
                console.log('Temporary identity file deleted');
            } catch (err) {
                console.warn('Error deleting temporary identity file:', err);
            }
        } catch (sftpError) {
            console.error('SFTP command failed:', sftpError);
            // Clean up temporary identity file even on error
            try {
                await fs.promises.unlink(identityFile);
                console.log('Temporary identity file deleted');
            } catch (err) {
                console.warn('Error deleting temporary identity file:', err);
            }
            throw sftpError;
        }

        // Cleanup
        console.log('Starting cleanup process...');
        try {
            await fs.promises.unlink(batchFilePath);
            console.log('Batch file deleted successfully');
        } catch (error) {
            console.warn('Error deleting batch file:', error);
        }

        try {
            await exec.exec('ssh-agent', ['-k']);
            console.log('SSH agent killed successfully');
        } catch (error) {
            console.warn('Error killing SSH agent:', error);
        }

        console.log('Deployment completed successfully!');
        return true;
    } catch (error) {
        console.error('Deployment failed with error:', error);
        if (error.stack) {
            console.error('Error stack trace:', error.stack);
        }
        throw error;
    }
}

// Add error handling for uncaught exceptions
process.on('unhandledRejection', (error) => {
    core.error('Unhandled promise rejection');
    core.error(error);
    process.exit(1);
});

// Export the deploy function for testing with optional dependency injection
module.exports = { 
    deploy,
    // Add an injectable version for testing
    deployWithDependencies: async (params = {}, dependencies = {}) => {
        const {
            host = core.getInput('host', { required: true }),
            username = core.getInput('username', { required: true }),
            port = core.getInput('port') || '22',
            sourceDir = core.getInput('source_dir', { required: true }),
            remoteDir = core.getInput('remote_dir', { required: true }),
            privateKey = core.getInput('private_key', { required: true })
        } = params;

        const {
            coreModule = core,
            execModule = exec,
            fsModule = fs,
            osModule = os,
            pathModule = path,
            processEnv = process.env
        } = dependencies;

        console.log('Starting deployment process with injected dependencies...');
        try {
            // Check and install SSH tools if needed with injected dependencies
            const checkAndInstallSshToolsWithDeps = async () => {
                coreModule.startGroup('🔧 Checking SSH tools');
                try {
                    coreModule.info('Checking if ssh-add is available...');
                    const sshAddResult = await execModule.getExecOutput('which', ['ssh-add'], { ignoreReturnCode: true });
                    
                    if (sshAddResult.exitCode !== 0) {
                        coreModule.info('ssh-add not found, installing OpenSSH client...');
                        
                        // Detect platform and install appropriate packages
                        if (osModule.platform() === 'linux') {
                            await execModule.exec('sudo', ['apt-get', 'update']);
                            await execModule.exec('sudo', ['apt-get', 'install', '-y', 'openssh-client']);
                        } else if (osModule.platform() === 'darwin') {
                            // macOS usually has OpenSSH installed
                            coreModule.info('On macOS, OpenSSH should be pre-installed');
                        } else if (osModule.platform() === 'win32') {
                            coreModule.warning('On Windows, please ensure OpenSSH is installed via Windows features');
                        }
                        
                        // Verify installation
                        const verifyResult = await execModule.getExecOutput('which', ['ssh-add'], { ignoreReturnCode: true });
                        if (verifyResult.exitCode !== 0) {
                            throw new Error('Failed to install or locate ssh-add after installation attempt');
                        }
                    }
                    
                    coreModule.info('SSH tools are available');
                } catch (error) {
                    coreModule.error('Failed to setup SSH tools');
                    coreModule.error(error);
                    throw error;
                } finally {
                    coreModule.endGroup();
                }
            };
            
            await checkAndInstallSshToolsWithDeps();
            
            // Validate inputs
            console.log('Validating input parameters...');
            
            // Mask private key in logs for security
            coreModule.setSecret(privateKey);

            console.log(`Configuration validated:
                - Host: ${host}
                - Username: ${username}
                - Port: ${port}
                - Source Directory: ${sourceDir}
                - Remote Directory: ${remoteDir}
                - Private Key Length: ${privateKey ? privateKey.length : 0} characters`);

            // Start SSH agent
            console.log('Starting SSH agent...');
            
            // Custom startSshAgent with injected dependencies
            const startSshAgentWithDeps = async (pk) => {
                coreModule.startGroup('🔐 Setting up SSH Agent');
                try {
                    if (!pk) {
                        throw new Error('Private key is required');
                    }

                    coreModule.info('Starting ssh-agent process...');
                    const agentInfo = await execModule.getExecOutput('ssh-agent', ['-s']);
                    coreModule.info('ssh-agent output:', agentInfo);
                    
                    if (!agentInfo || !agentInfo.stdout) {
                        throw new Error('Failed to get ssh-agent output');
                    }

                    const authSockMatch = agentInfo.stdout.match(/SSH_AUTH_SOCK=([^;]*)/);
                    const agentPidMatch = agentInfo.stdout.match(/SSH_AGENT_PID=([^;]*)/);

                    if (!authSockMatch || !agentPidMatch) {
                        throw new Error('Failed to parse ssh-agent output');
                    }

                    const authSock = authSockMatch[1];
                    const agentPid = agentPidMatch[1];
                    
                    processEnv.SSH_AUTH_SOCK = authSock;
                    processEnv.SSH_AGENT_PID = agentPid;
                    
                    coreModule.info(`SSH Agent started with PID: ${agentPid}`);

                    coreModule.info('Adding SSH key to agent...');
                    await execModule.getExecOutput('ssh-add', ['-'], {
                        input: Buffer.from(pk),
                        silent: true
                    });
                    
                    coreModule.info('SSH key added successfully');
                    
                    return async () => {
                        coreModule.info('Terminating SSH agent...');
                        await execModule.exec('ssh-agent', ['-k']);
                    };
                } catch (error) {
                    coreModule.error('Failed to setup SSH agent');
                    coreModule.error(error);
                    throw error;
                } finally {
                    coreModule.endGroup();
                }
            };

            const agentInfo = await startSshAgentWithDeps(privateKey);
            console.log('SSH agent started successfully:', agentInfo);

            // Create batch file
            console.log('Creating SFTP batch file...');
            const batchFilePath = pathModule.join(osModule.tmpdir(), 'sftp_batch');
            
            // Custom getFileCount with injected dependencies
            const getFileCountWithDeps = async (directory) => {
                let count = 0;
                const files = fsModule.readdirSync(directory, { recursive: true });
                for (const file of files) {
                    const fullPath = pathModule.join(directory, file);
                    if (fsModule.statSync(fullPath).isFile()) {
                        count++;
                    }
                }
                return count;
            };
            
            const fileCount = await getFileCountWithDeps(sourceDir);
            console.log(`Found ${fileCount} files to transfer in source directory`);

            // Create a better formatted batch file with explicit paths
            // Ensure the remote directory exists first
            let batchFileContent = `-mkdir ${remoteDir}\n`;  // Create directory if it doesn't exist (will be ignored if already exists)
            batchFileContent += `cd ${remoteDir}\n`;
            
            // List all files in source directory and create individual put commands
            // This is more reliable than put -r for some SFTP implementations
            const files = fsModule.readdirSync(sourceDir, { withFileTypes: true });
            for (const file of files) {
                const sourcePath = pathModule.join(sourceDir, file.name);
                if (file.isFile()) {
                    batchFileContent += `put "${sourcePath}" "${file.name}"\n`;
                }
            }
            
            await fsModule.promises.writeFile(batchFilePath, batchFileContent);
            console.log('SFTP batch file created successfully at:', batchFilePath);
            console.log('Batch file contents:', batchFileContent);

            // Execute SFTP transfer
            console.log('Preparing SFTP command...');
            
            // Create a temporary identity file for this connection
            const identityFile = pathModule.join(osModule.tmpdir(), 'deploy_identity');
            await fsModule.promises.writeFile(identityFile, privateKey, { mode: 0o600 });
            console.log(`Identity file created at: ${identityFile}`);
            
            // Use direct SFTP command with explicit identity file instead of ssh-agent
            const sftpCommand = `sftp -v -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i ${identityFile} -b ${batchFilePath} -P ${port} ${username}@${host}`;
            console.log(`Executing SFTP command: ${sftpCommand}`);

            console.log('Starting file transfer...');
            try {
                const result = await execModule.getExecOutput(sftpCommand);
                console.log('SFTP command output:', result.stdout);
                if (result.stderr) {
                    console.warn('SFTP command stderr:', result.stderr);
                }
                console.log(`SFTP transfer completed with exit code: ${result.exitCode}`);
                
                // Clean up temporary identity file
                try {
                    await fsModule.promises.unlink(identityFile);
                    console.log('Temporary identity file deleted');
                } catch (err) {
                    console.warn('Error deleting temporary identity file:', err);
                }
            } catch (sftpError) {
                console.error('SFTP command failed:', sftpError);
                // Clean up temporary identity file even on error
                try {
                    await fsModule.promises.unlink(identityFile);
                    console.log('Temporary identity file deleted');
                } catch (err) {
                    console.warn('Error deleting temporary identity file:', err);
                }
                throw sftpError;
            }

            // Cleanup
            console.log('Starting cleanup process...');
            try {
                await fsModule.promises.unlink(batchFilePath);
                console.log('Batch file deleted successfully');
            } catch (error) {
                console.warn('Error deleting batch file:', error);
            }

            try {
                await execModule.exec('ssh-agent', ['-k']);
                console.log('SSH agent killed successfully');
            } catch (error) {
                console.warn('Error killing SSH agent:', error);
            }

            console.log('Deployment completed successfully!');
            return true;
        } catch (error) {
            console.error('Deployment failed with error:', error);
            if (error.stack) {
                console.error('Error stack trace:', error.stack);
            }
            throw error;
        }
    }
};

// Only run deploy() if this file is being run directly
if (require.main === module) {
    console.log('Running deploy.js directly');
    deploy().then(() => {
        console.log('Deployment completed successfully');
    }).catch(error => {
        console.error('Deployment failed:', error);
        process.exit(1);
    });
}