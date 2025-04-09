const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
        // Validate inputs
        console.log('Validating input parameters...');
        const host = core.getInput('host', { required: true });
        const username = core.getInput('username', { required: true });
        const port = core.getInput('port') || '22';
        const sourceDir = core.getInput('source_dir', { required: true });
        const remoteDir = core.getInput('remote_dir', { required: true });
        const privateKey = core.getInput('private_key', { required: true });

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

        const batchFileContent = `cd ${remoteDir}\nput -r ${sourceDir}/*`;
        await fs.promises.writeFile(batchFilePath, batchFileContent);
        console.log('SFTP batch file created successfully at:', batchFilePath);
        console.log('Batch file contents:', batchFileContent);

        // Execute SFTP transfer
        console.log('Preparing SFTP command...');
        const sftpCommand = `sftp -b ${batchFilePath} -P ${port} ${username}@${host}`;
        console.log('Executing SFTP command:', sftpCommand);

        console.log('Starting file transfer...');
        const result = await exec.getExecOutput(sftpCommand);
        console.log('SFTP command output:', result.stdout);
        if (result.stderr) {
            console.warn('SFTP command stderr:', result.stderr);
        }
        console.log(`SFTP transfer completed with exit code: ${result.exitCode}`);

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

            const batchFileContent = `cd ${remoteDir}\nput -r ${sourceDir}/*`;
            await fsModule.promises.writeFile(batchFilePath, batchFileContent);
            console.log('SFTP batch file created successfully at:', batchFilePath);
            console.log('Batch file contents:', batchFileContent);

            // Execute SFTP transfer
            console.log('Preparing SFTP command...');
            const sftpCommand = `sftp -b ${batchFilePath} -P ${port} ${username}@${host}`;
            console.log('Executing SFTP command:', sftpCommand);

            console.log('Starting file transfer...');
            const result = await execModule.getExecOutput(sftpCommand);
            console.log('SFTP command output:', result.stdout);
            if (result.stderr) {
                console.warn('SFTP command stderr:', result.stderr);
            }
            console.log(`SFTP transfer completed with exit code: ${result.exitCode}`);

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