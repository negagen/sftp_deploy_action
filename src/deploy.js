import core from '@actions/core';
import exec from '@actions/exec';
import fs from 'fs';
import path from 'path';

async function startSshAgent(privateKey) {
    core.startGroup('🔐 Setting up SSH Agent');
    try {
        core.info('Starting ssh-agent process...');
        const agentInfo = await exec.getExecOutput('ssh-agent', ['-s']);
        
        const authSock = agentInfo.stdout.match(/SSH_AUTH_SOCK=([^;]*)/)[1];
        const agentPid = agentInfo.stdout.match(/SSH_AGENT_PID=([^;]*)/)[1];
        
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
    let cleanup = null;
    
    try {
        // Log action start
        core.info('🚀 Starting SFTP deployment...');
        
        // Get and validate inputs
        core.startGroup('📥 Validating inputs');
        const host = core.getInput('host', { required: true });
        const username = core.getInput('username', { required: true });
        const port = core.getInput('port') || '22';
        const sourceDir = core.getInput('source-dir') || './dist';
        const remoteDir = core.getInput('remote-dir') || '/var/www/html';
        const privateKey = core.getInput('private-key', { required: true });

        // Mask private key in logs
        core.setSecret(privateKey);

        core.info(`Host: ${host}`);
        core.info(`Username: ${username}`);
        core.info(`Port: ${port}`);
        core.info(`Source directory: ${sourceDir}`);
        core.info(`Remote directory: ${remoteDir}`);

        if (!fs.existsSync(sourceDir)) {
            throw new Error(`Source directory ${sourceDir} does not exist`);
        }

        const fileCount = await getFileCount(sourceDir);
        core.info(`Found ${fileCount} files to upload`);
        core.endGroup();

        // Setup SSH agent
        cleanup = await startSshAgent(privateKey);

        // Create batch file
        core.startGroup('📝 Preparing SFTP batch file');
        const batchFilePath = path.join(process.env.RUNNER_TEMP || '/tmp', 'sftp_batch');
        const batchCommands = [
            'mkdir -p ' + remoteDir,
            'cd ' + remoteDir,
            'put -r ' + sourceDir + '/* .'
        ].join('\n');

        fs.writeFileSync(batchFilePath, batchCommands);
        core.info('SFTP batch file created');
        core.debug(`Batch file contents:\n${batchCommands}`);
        core.endGroup();

        try {
            // Execute SFTP transfer
            core.startGroup('📤 Executing SFTP transfer');
            const sftpOptions = [
                '-P', port,
                '-o', 'StrictHostKeyChecking=no',
                '-b', batchFilePath,
                `${username}@${host}`
            ];

            // Set up output handling
            const options = {
                listeners: {
                    stdout: (data) => {
                        const output = data.toString().trim();
                        if (output) core.info(output);
                    },
                    stderr: (data) => {
                        const error = data.toString().trim();
                        if (error.includes('Error') || error.includes('fatal')) {
                            core.error(error);
                        } else if (error.includes('Warning')) {
                            core.warning(error);
                        } else {
                            core.info(error);
                        }
                    }
                }
            };

            core.info('Starting file transfer...');
            await exec.exec('sftp', sftpOptions, options);
            
            core.info('✅ SFTP transfer completed successfully');
            core.endGroup();

        } finally {
            // Cleanup batch file
            core.startGroup('🧹 Cleanup');
            try {
                fs.unlinkSync(batchFilePath);
                core.info('Batch file deleted');
            } catch (error) {
                core.warning(`Failed to delete batch file: ${error.message}`);
            }
            core.endGroup();
        }

        // Set output
        core.setOutput('deployed-files', fileCount);
        core.setOutput('deployment-time', new Date().toISOString());

    } catch (error) {
        core.error('❌ Deployment failed');
        core.setFailed(error.message);
    } finally {
        // Cleanup SSH agent
        if (cleanup) {
            core.startGroup('🧹 Cleaning up SSH agent');
            try {
                await cleanup();
                core.info('SSH agent terminated');
            } catch (error) {
                core.warning(`Failed to cleanup ssh-agent: ${error.message}`);
            }
            core.endGroup();
        }
    }
}

// Add error handling for uncaught exceptions
process.on('unhandledRejection', (error) => {
    core.error('Unhandled promise rejection');
    core.error(error);
    process.exit(1);
});

// Export the deploy function for testing
module.exports = { deploy };

// Only run deploy() if this file is being run directly
if (require.main === module) {
    deploy();
}