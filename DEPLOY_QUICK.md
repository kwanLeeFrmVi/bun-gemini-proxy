# Quick Deployment Guide - Option 2 (Local Build)

Fast reference for deploying to `quanle@100.84.141.95` using local Podman build.

## Prerequisites ✅

- [x] Podman installed locally (you have this!)
- [x] SSH access to remote server
- [x] Config files: `proxy.yaml` and `keys.yaml` (you have these!)

## Deploy Now 🚀

```bash
# Full deployment (build + transfer + deploy)
./scripts/deploy-podman.sh
```

That's it! The script will:
1. Build container image locally (~2 min)
2. Export to tarball (~80MB)
3. Copy to remote server
4. Import and start container
5. Run health check

**Total time: ~3-5 minutes**

## Common Commands

```bash
# Deploy (full process)
./scripts/deploy-podman.sh

# Deploy without rebuilding (if image exists)
./scripts/deploy-podman.sh --skip-build

# Preview what will happen
./scripts/deploy-podman.sh --dry-run

# Keep tarball after deploy (for debugging)
./scripts/deploy-podman.sh --no-cleanup
```

## Check Deployment

```bash
# Health check from your machine
curl http://100.84.141.95:5001/health

# View logs
ssh quanle@100.84.141.95 'podman logs -f gemini-proxy'

# Check container status
ssh quanle@100.84.141.95 'podman ps'

# Container stats
ssh quanle@100.84.141.95 'podman stats gemini-proxy'
```

## Manage Service

```bash
# Restart container
ssh quanle@100.84.141.95 'podman restart gemini-proxy'

# Stop container
ssh quanle@100.84.141.95 'podman stop gemini-proxy'

# Start container
ssh quanle@100.84.141.95 'podman start gemini-proxy'

# Remove container
ssh quanle@100.84.141.95 'podman stop gemini-proxy && podman rm gemini-proxy'
```

## Update Config Files

Config files are **never overwritten** automatically. To update:

```bash
# Edit on remote
ssh quanle@100.84.141.95
cd /home/quanle/bun-gemini-proxy
vim proxy.yaml  # or keys.yaml

# Restart to apply changes
podman restart gemini-proxy
```

## Workflow

### Daily Development Cycle

```bash
# 1. Make code changes locally
vim src/router/router.ts

# 2. Test locally
bun run start

# 3. Deploy to remote
./scripts/deploy-podman.sh

# 4. Verify
curl http://100.84.141.95:5001/health
ssh quanle@100.84.141.95 'podman logs gemini-proxy'
```

### Quick Redeploy (after first deploy)

```bash
# If image already built and unchanged
./scripts/deploy-podman.sh --skip-build
```

This skips the 2-minute build step and just transfers the existing image.

### Emergency Rollback

```bash
# SSH to remote
ssh quanle@100.84.141.95

# List images
podman images

# If you have old image tagged
podman stop gemini-proxy
podman rm gemini-proxy
podman run -d --name gemini-proxy ... <old-image-tag>
```

**Pro tip:** Tag images with versions for easy rollback:

```bash
# Before deploying new version
ssh quanle@100.84.141.95 'podman tag localhost/gemini-proxy:latest localhost/gemini-proxy:backup'
```

## Troubleshooting

### Build fails locally

```bash
# Check Podman is working
podman --version
podman ps

# Clean up and retry
podman system prune -a
./scripts/deploy-podman.sh
```

### Transfer is slow

**Expected transfer time:** 30-60 seconds for ~80MB tarball

If slower:
- Check network: `ping 100.84.141.95`
- Use compression: The script already uses SCP efficiently

### Container won't start on remote

```bash
# Check logs
ssh quanle@100.84.141.95 'podman logs gemini-proxy'

# Check if configs exist
ssh quanle@100.84.141.95 'ls -la /home/quanle/bun-gemini-proxy/*.yaml'

# Check port not in use
ssh quanle@100.84.141.95 'ss -tlnp | grep 5001'

# Manual start with debug
ssh quanle@100.84.141.95
cd /home/quanle/bun-gemini-proxy
podman run --rm -it localhost/gemini-proxy:latest  # Interactive mode
```

### Health check fails

```bash
# Test from remote server
ssh quanle@100.84.141.95 'curl -v http://localhost:5001/health'

# Check container is running
ssh quanle@100.84.141.95 'podman ps | grep gemini'

# View full logs
ssh quanle@100.84.141.95 'podman logs --tail 100 gemini-proxy'
```

## Performance Tips

### Speed Up Builds

```bash
# Build once, reuse multiple times
./scripts/deploy-podman.sh              # First time
./scripts/deploy-podman.sh --skip-build  # Subsequent deploys

# Or build manually and deploy multiple times
podman build -t localhost/gemini-proxy:latest .
./scripts/deploy-podman.sh --skip-build
# ... make config changes on remote ...
./scripts/deploy-podman.sh --skip-build  # Redeploy same image
```

### Parallel Operations

If deploying to multiple servers:

```bash
# Deploy to server 1
./scripts/deploy-podman.sh &
PID1=$!

# Deploy to server 2 (edit script for different host)
./scripts/deploy-podman-server2.sh &
PID2=$!

# Wait for both
wait $PID1 $PID2
```

## Files Created During Deployment

**Local (cleaned up automatically):**
- `gemini-proxy-image.tar` - Exported image (~80MB, deleted after import)

**Remote (`/home/quanle/bun-gemini-proxy/`):**
- `gemini-proxy-image.tar` - Image tarball (can be deleted after import)
- `podman-compose.yml` - Container config
- `proxy.yaml` - Server config (never overwritten)
- `keys.yaml` - API keys (never overwritten)
- `.runtime/` - Persistent state directory
  - `key-health.db` - SQLite database
  - `*.json` - Fallback state files

## Security Notes

- ✅ Container runs as non-root user (UID 1000)
- ✅ Read-only config mounts
- ✅ Resource limits enforced (1 CPU, 512MB RAM)
- ✅ SELinux labels applied
- ✅ No new privileges allowed

## Next Steps

1. **First deployment:**
   ```bash
   ./scripts/deploy-podman.sh
   ```

2. **Verify it works:**
   ```bash
   curl http://100.84.141.95:5001/health
   ```

3. **Check logs:**
   ```bash
   ssh quanle@100.84.141.95 'podman logs -f gemini-proxy'
   ```

4. **Test your API:**
   ```bash
   curl http://100.84.141.95:5001/v1/models
   ```

## Full Documentation

- [DEPLOYMENT_PODMAN.md](DEPLOYMENT_PODMAN.md) - Complete guide with all options
- [scripts/deploy-podman.sh](scripts/deploy-podman.sh) - Deployment script
- [podman-compose.yml](podman-compose.yml) - Container configuration

## Support

**Issues?** Check logs first:
```bash
ssh quanle@100.84.141.95 'podman logs --tail 50 gemini-proxy'
```

**Need help?** Open an issue with:
- Error message from logs
- Output from `podman ps`
- Config files (redact API keys!)
