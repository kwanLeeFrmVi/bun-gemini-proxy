# Deployment Guide

This guide covers deploying the Gemini Proxy Server to production environments.

## Overview

The deployment uses a **single binary approach** with PM2 process management via Bun. The compiled binary includes all dependencies and runs without needing source code or Node.js on the server.

## Architecture

```
Local Machine                      Remote Server (EC2)
┌─────────────┐                   ┌─────────────────────┐
│             │   Build Binary    │                     │
│ bun build   │ ───────────────▶  │  ARM64 Binary       │
│             │   + Config files  │  + Config (YAML)    │
│             │                   │  + PM2 (via Bun)    │
└─────────────┘                   └─────────────────────┘
```

## Prerequisites

### Local Machine

- **Bun**: v1.2+ installed (`curl -fsSL https://bun.sh/install | bash`)
- **SSH Access**: Configured SSH key for target server
- **Configuration Files**: `proxy.yaml` and `keys.yaml` (copy from `.example` files)

### Remote Server (EC2)

- **Bun**: Installed at `~/.bun/bin/bun`
- **PM2**: Installed via Bun (`bunx pm2`)
- **Architecture**: ARM64 (Graviton) or x64
- **OS**: Linux (Amazon Linux 2023, Ubuntu, etc.)

## Initial Server Setup

### 1. Install Bun on Server

```bash
ssh your-server
curl -fsSL https://bun.sh/install | bash
```

### 2. Add Bun to PATH

The deployment script automatically adds Bun to `.bashrc`, but you can verify:

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
bunx pm2 --version  # Should show PM2 version
```

### 3. Configure SSH Access

Update `ecosystem.config.js` and `scripts/deploy.sh` with your server details:

```javascript
// In scripts/deploy.sh
SSH_HOST="your-ssh-alias"  // From ~/.ssh/config
REMOTE_PATH="/home/user/bun-gemini-proxy"
BINARY_NAME="bun-gemini-proxy-linux-arm64-glibc"  // Or x64 variant
```

## Configuration Files

### Required Files

1. **proxy.yaml** - Server configuration
   ```bash
   cp proxy.example.yaml proxy.yaml
   # Edit: port, timeout, rate limits, etc.
   ```

2. **keys.yaml** - Gemini API keys
   ```bash
   cp keys.example.yaml keys.yaml
   # Add your Gemini API keys
   ```

3. **ecosystem.config.js** - PM2 process configuration
   - Pre-configured for binary execution
   - Auto-restart, logging, memory limits

## Deployment

### Quick Deploy

```bash
# Full deployment (build + deploy)
bun deploy

# Fast deployment (skip build, use existing binary)
bun deploy --skip-build

# Dry run (preview without deploying)
bun deploy --dry-run
```

### What Happens During Deployment

1. **Build Phase** (unless `--skip-build`)
   - Compiles TypeScript to standalone binary
   - Targets: Linux ARM64 (for EC2 Graviton)
   - Output: `./bin/bun-gemini-proxy-linux-arm64-glibc`

2. **Upload Phase**
   - Creates remote directory structure
   - Copies binary to server
   - Copies config files (`proxy.yaml`, `keys.yaml`, `ecosystem.config.js`)
   - Sets executable permissions

3. **PM2 Management**
   - Stops existing process (if any)
   - Starts new process with updated binary
   - Saves PM2 configuration for auto-restart on reboot

## Process Management

### Using PM2 Commands

```bash
# View logs (live tail)
ssh your-server 'bunx pm2 logs bun-gemini-proxy'

# View last 100 lines
ssh your-server 'bunx pm2 logs bun-gemini-proxy --lines 100'

# Restart service
ssh your-server 'bunx pm2 restart bun-gemini-proxy'

# Stop service
ssh your-server 'bunx pm2 stop bun-gemini-proxy'

# Check status
ssh your-server 'bunx pm2 status'

# Monitor resources (CPU, memory)
ssh your-server 'bunx pm2 monit'

# Delete process
ssh your-server 'bunx pm2 delete bun-gemini-proxy'
```

### PM2 Configuration

Located in `ecosystem.config.js`:

```javascript
{
  name: 'bun-gemini-proxy',
  script: './bin/bun-gemini-proxy-linux-arm64-glibc',  // Binary path
  interpreter: 'none',  // No interpreter needed
  autorestart: true,
  max_memory_restart: '500M',
  env: {
    NODE_ENV: 'production',
    PORT: 8000,
    PROXY_CONFIG_PATH: './proxy.yaml',
    KEYS_CONFIG_PATH: './keys.yaml',
  },
}
```

## Health Checks

### Verify Deployment

```bash
# Health endpoint
ssh your-server 'curl -s http://localhost:8000/health'
# Expected: "ok"

# Admin health dashboard
ssh your-server 'curl -s http://localhost:8000/admin/health'
# Expected: JSON with key health stats

# PM2 process status
ssh your-server 'bunx pm2 status'
# Expected: "online" status, 0 restarts (if stable)
```

### Common Endpoints

- `http://server:8000/health` - Health check
- `http://server:8000/admin/health` - Detailed health metrics
- `http://server:8000/help` - User guide
- `http://server:8000/v1/chat/completions` - OpenAI-compatible API

## Troubleshooting

### Binary Not Executing

```bash
# Check binary permissions
ssh your-server 'ls -la /home/ec2-user/bun-gemini-proxy/bin/'
# Should show: -rwxr-xr-x (executable)

# Fix permissions
ssh your-server 'chmod +x /home/ec2-user/bun-gemini-proxy/bin/bun-gemini-proxy-*'
```

### PM2 Process Crashing

```bash
# View error logs
ssh your-server 'bunx pm2 logs bun-gemini-proxy --err --lines 50'

# Check for missing config files
ssh your-server 'ls /home/ec2-user/bun-gemini-proxy/*.yaml'
# Should show: proxy.yaml, keys.yaml

# Check process memory
ssh your-server 'bunx pm2 status'
# Look for high restart count (↺ column)
```

### Config File Issues

```bash
# Validate YAML syntax
ssh your-server 'cd /home/ec2-user/bun-gemini-proxy && bun -e "console.log(require(\"yaml\").parse(require(\"fs\").readFileSync(\"proxy.yaml\", \"utf8\")))"'

# Test with minimal config
# Temporarily edit proxy.yaml with minimal settings
```

### Bun Not Found

```bash
# Check Bun installation
ssh your-server 'ls -la ~/.bun/bin/bun'

# Check PATH
ssh your-server 'echo $PATH | grep bun'

# Reinstall Bun
ssh your-server 'curl -fsSL https://bun.sh/install | bash'
```

## Architecture-Specific Notes

### ARM64 (Graviton/M1/M2)

Default binary: `bun-gemini-proxy-linux-arm64-glibc`

```bash
# In scripts/deploy.sh
BINARY_NAME="bun-gemini-proxy-linux-arm64-glibc"
```

### x64 (Intel/AMD)

Change binary name in `scripts/deploy.sh`:

```bash
# For modern CPUs
BINARY_NAME="bun-gemini-proxy-linux-x64-glibc"

# For older CPUs (baseline compatibility)
BINARY_NAME="bun-gemini-proxy-linux-x64-glibc-baseline"

# For Alpine/musl-based systems
BINARY_NAME="bun-gemini-proxy-linux-x64-musl"
```

## Security Best Practices

### 1. API Key Management

- **Never commit** `keys.yaml` to version control (`.gitignore` configured)
- Use environment variables for CI/CD: `KEYS_CONFIG_PATH=/secure/keys.yaml`
- Rotate keys regularly, test with health dashboard

### 2. Network Security

```bash
# Firewall: Only allow necessary ports
sudo ufw allow 8000/tcp  # API port
sudo ufw allow 22/tcp    # SSH
sudo ufw enable

# Use reverse proxy (nginx/caddy) for HTTPS
# Proxy: https://your-domain.com → http://localhost:8000
```

### 3. File Permissions

```bash
# Config files should not be world-readable
ssh your-server 'chmod 600 /home/ec2-user/bun-gemini-proxy/*.yaml'

# Binary should be executable by user only
ssh your-server 'chmod 700 /home/ec2-user/bun-gemini-proxy/bin/*'
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Build binary
        run: bun run build:linux

      - name: Deploy to server
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_PRIVATE_KEY" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          bun deploy --skip-build
```

## Monitoring

### PM2 Built-in Monitoring

```bash
# Real-time monitoring
ssh your-server 'bunx pm2 monit'

# Process info
ssh your-server 'bunx pm2 info bun-gemini-proxy'
```

### Log Rotation

PM2 automatically rotates logs via `pm2-logrotate` module:

```bash
# Configure log rotation
ssh your-server 'bunx pm2 install pm2-logrotate'
ssh your-server 'bunx pm2 set pm2-logrotate:max_size 10M'
ssh your-server 'bunx pm2 set pm2-logrotate:retain 7'
```

### External Monitoring

Integrate with monitoring services via health endpoint:

```bash
# Uptime monitoring (e.g., UptimeRobot, Pingdom)
GET http://your-server:8000/health

# Prometheus metrics
GET http://your-server:8000/metrics
```

## Rollback

### Quick Rollback

```bash
# Keep previous binary
ssh your-server 'cp /home/ec2-user/bun-gemini-proxy/bin/bun-gemini-proxy-linux-arm64-glibc \
                    /home/ec2-user/bun-gemini-proxy/bin/bun-gemini-proxy-linux-arm64-glibc.backup'

# Rollback to previous version
ssh your-server 'cd /home/ec2-user/bun-gemini-proxy && \
                 cp bin/bun-gemini-proxy-linux-arm64-glibc.backup bin/bun-gemini-proxy-linux-arm64-glibc && \
                 bunx pm2 restart bun-gemini-proxy'
```

## Performance Tuning

### PM2 Cluster Mode

For high traffic, use cluster mode:

```javascript
// ecosystem.config.js
{
  instances: 4,  // Number of instances (usually = CPU cores)
  exec_mode: 'cluster',  // Enable cluster mode
}
```

### Memory Limits

```javascript
// ecosystem.config.js
{
  max_memory_restart: '1G',  // Restart if memory exceeds 1GB
}
```

## Additional Resources

- [Bun Documentation](https://bun.sh/docs)
- [PM2 Documentation](https://pm2.keymetrics.io/)
- [Project PRD](./Deployment-PRD.md)
- [Main README](./README.md)

## Support

For deployment issues:

1. Check logs: `ssh your-server 'bunx pm2 logs bun-gemini-proxy --err'`
2. Verify health: `curl http://your-server:8000/health`
3. Review this guide's Troubleshooting section
4. Open an issue with deployment logs and error messages
