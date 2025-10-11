# Podman Remote Deployment Guide

Complete guide for deploying the Gemini API Proxy to a remote server using Podman containers.

## Quick Start

```bash
# Deploy with local build (recommended for fast deploys)
./scripts/deploy-podman.sh

# Or build directly on remote server (slower, no local podman needed)
./scripts/deploy-podman.sh --remote-build
```

## Prerequisites

### Local Machine

**Option 1 - Local Build (Faster):**
- Podman or Docker installed
- SSH access to remote server
- Config files: `proxy.yaml` and `keys.yaml` (first deployment only)

**Option 2 - Remote Build (No container tools needed):**
- SSH access to remote server
- rsync installed
- Config files: `proxy.yaml` and `keys.yaml` (first deployment only)

### Remote Server (100.84.141.95)

- Podman installed
- User: `quanle`
- Port 5001 exposed for the service
- SSH key authentication configured

## Deployment Methods

### Method 1: Local Build + Transfer (Recommended)

**Fastest method** - Build image locally, transfer to remote server.

```bash
# Full deployment (build + transfer + run)
./scripts/deploy-podman.sh

# Skip build if image already exists locally
./scripts/deploy-podman.sh --skip-build

# Dry run to see what would happen
./scripts/deploy-podman.sh --dry-run

# Keep tarball after deployment for debugging
./scripts/deploy-podman.sh --no-cleanup
```

**Process:**
1. Builds container image locally using Podman/Docker
2. Exports image to tarball (~50-100MB)
3. Copies tarball + configs to remote via SCP
4. Imports image on remote server
5. Starts container with podman-compose or podman run
6. Cleans up local tarball

**Pros:** Fast, works offline on remote, repeatable
**Cons:** Requires local Podman/Docker installation

### Method 2: Remote Build

**Best for laptops without Podman/Docker** - Build directly on remote server.

```bash
# Deploy with remote build
./scripts/deploy-podman.sh --remote-build
```

**Process:**
1. Syncs project files to remote (Dockerfile, source, configs)
2. Builds container image on remote server
3. Starts container directly
4. No tarball transfer needed

**Pros:** No local container tools needed, smaller data transfer
**Cons:** Slower build, requires remote server resources

## Configuration Files

### First Deployment

Create configuration files before first deployment:

```bash
# Copy example files
cp proxy.example.yaml proxy.yaml
cp keys.example.yaml keys.yaml

# Edit with your settings
vim proxy.yaml  # Server settings
vim keys.yaml   # Gemini API keys
```

The deployment script will copy these files to the remote server **only on first deployment**.

### Updates to Config Files

Config files on remote server are **never overwritten** by the deployment script. To update configs:

```bash
# SSH into remote server
ssh quanle@100.84.141.95

# Edit configs directly
cd /home/quanle/bun-gemini-proxy
vim proxy.yaml
vim keys.yaml

# Restart container to apply changes
podman restart gemini-proxy
```

## Script Options

```bash
./scripts/deploy-podman.sh [OPTIONS]

Options:
  --skip-build       Skip image build (use existing local image)
  --dry-run          Show deployment plan without executing
  --remote-build     Build on remote server instead of locally
  --no-cleanup       Keep local tarball after deployment

Examples:
  ./scripts/deploy-podman.sh                          # Standard deployment
  ./scripts/deploy-podman.sh --remote-build           # Build on remote
  ./scripts/deploy-podman.sh --skip-build --dry-run   # Preview without build
```

## Service Management

### Container Operations

```bash
# View logs
ssh quanle@100.84.141.95 'podman logs gemini-proxy'

# Follow logs in real-time
ssh quanle@100.84.141.95 'podman logs -f gemini-proxy'

# Restart container
ssh quanle@100.84.141.95 'podman restart gemini-proxy'

# Stop container
ssh quanle@100.84.141.95 'podman stop gemini-proxy'

# Start container
ssh quanle@100.84.141.95 'podman start gemini-proxy'

# Remove container (requires stop first)
ssh quanle@100.84.141.95 'podman rm gemini-proxy'

# View container stats
ssh quanle@100.84.141.95 'podman stats gemini-proxy'
```

### Health Checks

```bash
# Local health check from remote server
ssh quanle@100.84.141.95 'curl http://localhost:5001/health'

# Health check from your machine
curl http://100.84.141.95:5001/health

# Expected response
{"status":"ok","timestamp":"2025-10-11T...","version":"1.0.0"}
```

### Using podman-compose

If `podman-compose` is available on remote:

```bash
ssh quanle@100.84.141.95
cd /home/quanle/bun-gemini-proxy

# Start service
podman-compose up -d

# Stop service
podman-compose down

# View logs
podman-compose logs -f

# Restart service
podman-compose restart

# Rebuild and restart
podman-compose up -d --build
```

## Directory Structure on Remote

```
/home/quanle/bun-gemini-proxy/
├── gemini-proxy-image.tar    # Image tarball (cleaned after import)
├── podman-compose.yml         # Container orchestration config
├── proxy.yaml                 # Server configuration
├── keys.yaml                  # API keys (never overwritten)
├── .runtime/                  # Persistent state directory
│   ├── key-health.db         # SQLite database for key health
│   └── *.json                # JSON fallback state files
└── logs/                      # Log files (if configured)
```

## Port Mapping

- **Remote Container Port**: 8000 (internal)
- **Remote Host Port**: 5001 (exposed)
- **Access URL**: `http://100.84.141.95:5001`

## Container Specifications

From [podman-compose.yml](podman-compose.yml:1):

- **Image**: `localhost/gemini-proxy:latest`
- **Container Name**: `gemini-proxy`
- **Restart Policy**: `unless-stopped`
- **Resource Limits**:
  - CPU: 1 core max, 0.25 reserved
  - Memory: 512MB max, 128MB reserved
- **Volumes**:
  - `./proxy.yaml:/app/proxy.yaml:ro,Z` (read-only config)
  - `./keys.yaml:/app/keys.yaml:ro,Z` (read-only keys)
  - `./.runtime:/app/.runtime:Z` (persistent state)
- **Security**:
  - Run as non-root user (UID 1000)
  - `no-new-privileges` enabled
  - SELinux label: `container_runtime_t`

## Troubleshooting

### Build Fails Locally

```bash
# Check Podman/Docker is working
podman --version
podman images

# Try remote build instead
./scripts/deploy-podman.sh --remote-build
```

### Transfer is Slow

```bash
# Use remote build to avoid large tarball transfer
./scripts/deploy-podman.sh --remote-build

# Check network speed
ssh quanle@100.84.141.95 'speedtest'
```

### Container Won't Start

```bash
# Check container logs
ssh quanle@100.84.141.95 'podman logs gemini-proxy'

# Check if configs exist
ssh quanle@100.84.141.95 'ls -la /home/quanle/bun-gemini-proxy/*.yaml'

# Verify port is not in use
ssh quanle@100.84.141.95 'ss -tlnp | grep 5001'

# Check SELinux denials (if applicable)
ssh quanle@100.84.141.95 'sudo ausearch -m avc -ts recent'
```

### Health Check Fails

```bash
# Check container is running
ssh quanle@100.84.141.95 'podman ps | grep gemini-proxy'

# Test internal health endpoint
ssh quanle@100.84.141.95 'curl -v http://localhost:5001/health'

# Check container networking
ssh quanle@100.84.141.95 'podman inspect gemini-proxy | grep IPAddress'

# View detailed logs
ssh quanle@100.84.141.95 'podman logs --tail 100 gemini-proxy'
```

### Config Changes Not Applied

```bash
# Configs are read-only mounted - must restart container
ssh quanle@100.84.141.95 'podman restart gemini-proxy'

# Verify config files are correct
ssh quanle@100.84.141.95 'cat /home/quanle/bun-gemini-proxy/proxy.yaml'
```

### Permission Denied Errors

```bash
# Check file ownership
ssh quanle@100.84.141.95 'ls -la /home/quanle/bun-gemini-proxy'

# Fix permissions if needed
ssh quanle@100.84.141.95 'chmod 755 /home/quanle/bun-gemini-proxy/.runtime'

# Check SELinux context (if applicable)
ssh quanle@100.84.141.95 'ls -Z /home/quanle/bun-gemini-proxy'
```

## SSH Configuration

Add to `~/.ssh/config` for easier access:

```ssh-config
Host gemini-proxy
    HostName 100.84.141.95
    User quanle
    IdentityFile ~/.ssh/id_rsa
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

Then use shorter commands:

```bash
# Deploy
./scripts/deploy-podman.sh  # Uses IP from script

# Manage
ssh gemini-proxy 'podman logs -f gemini-proxy'
```

## Comparison: PM2 vs Podman Deployment

| Feature | PM2 (deploy.sh) | Podman (deploy-podman.sh) |
|---------|-----------------|---------------------------|
| **Isolation** | Process-level | Container-level |
| **Resource Limits** | OS limits | CPU/Memory quotas |
| **Portability** | Binary + configs | Container image |
| **Rollback** | Git + redeploy | Image tags |
| **Auto-restart** | PM2 daemon | Podman restart policy |
| **Logs** | PM2 log files | Container logs + journald |
| **Overhead** | ~10MB | ~50MB (image) + runtime |
| **Build Time** | 30s (binary) | 2-3min (image) |
| **Deploy Time** | 10s | 30-60s (local build) |

**Recommendation:**
- **Development/staging**: PM2 deployment (faster iteration)
- **Production**: Podman deployment (better isolation, scalability)

## Security Considerations

1. **API Keys**: Never commit `keys.yaml` to git - use `.gitignore`
2. **SSH Keys**: Use key-based auth, disable password authentication
3. **Firewall**: Limit port 5001 to trusted IPs if possible
4. **Container Security**: Image runs as non-root user (UID 1000)
5. **SELinux**: Podman labels enabled for enhanced security
6. **Secrets Management**: Consider using Podman secrets for sensitive data

## Additional Resources

- [Podman Documentation](https://docs.podman.io/)
- [podman-compose GitHub](https://github.com/containers/podman-compose)
- [Bun Build Documentation](https://bun.sh/docs/bundler)
- [Project README](README.md)
- [Architecture Specs](specs/)
