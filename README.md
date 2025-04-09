# SFTP Deploy Action

A GitHub Action to securely deploy files to a remote server via SFTP using SSH key authentication.

## Features

- 🔒 Secure SSH key authentication
- 📁 Individual file transfer with improved reliability
- 📊 Detailed progress logging
- 🚀 Fast and efficient file deployment
- 🧹 Automatic cleanup of temporary files
- 🛠️ Automatic installation of SSH tools if needed

## Usage

```yaml
- name: Deploy to SFTP
  uses: yourusername/sftp-deploy-action@v1
  with:
    host: ${{ secrets.SFTP_HOST }}
    username: ${{ secrets.SFTP_USERNAME }}
    private-key: ${{ secrets.SSH_PRIVATE_KEY }}
    source-dir: './dist'
    remote-dir: '/var/www/html'
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| host | SFTP server hostname | Yes | - |
| username | SFTP username | Yes | - |
| private-key | SSH private key | Yes | - |
| port | SFTP port | No | 22 |
| source-dir | Local directory to upload | No | ./dist |
| remote-dir | Remote directory path | No | /var/www/html |

## Outputs

| Output | Description |
|--------|-------------|
| deployed-files | Number of files deployed |
| deployment-time | Timestamp of deployment completion |

## Example Workflow

```yaml
name: Deploy Website
on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build site
        run: |
          npm ci
          npm run build
          
      - name: Deploy to SFTP
        uses: yourusername/sftp-deploy-action@v1
        with:
          host: ${{ secrets.SFTP_HOST }}
          username: ${{ secrets.SFTP_USERNAME }}
          private-key: ${{ secrets.SSH_PRIVATE_KEY }}
          source-dir: './dist'
          remote-dir: '/var/www/html'
```

## How It Works

The action performs the following steps:

1. Checks and installs OpenSSH tools if they're missing
2. Validates all input parameters
3. Normalizes the private key (ensuring it ends with a newline)
4. Creates a temporary identity file for authentication
5. Generates an SFTP batch file with individual file transfer commands
6. Transfers files using SFTP with strict security settings
7. Cleans up all temporary files

## Setting Up SSH Keys

1. Generate a new SSH key pair:
   ```bash
   ssh-keygen -t ed25519 -C "github-action"
   ```

2. Add the public key to your server's `~/.ssh/authorized_keys`

3. Add the private key to your GitHub repository secrets as `SSH_PRIVATE_KEY`

## Troubleshooting

- **Permission Issues**: Ensure the private key has the correct format with a newline at the end
- **Connection Failures**: Verify firewall rules allow SFTP connections on the specified port
- **SFTP Command Errors**: Check server logs for detailed error information

## Contributors

- [@negagen](https://github.com/negagen) - Enhanced error handling, private key normalization, and file transfer reliability

## License

MIT License - see [LICENSE](LICENSE)