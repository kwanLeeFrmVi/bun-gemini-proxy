# Deployment Guide

## Docker Deployment

### Prerequisites

- Docker 20.10+ or Podman 4.0+
- At least 512MB RAM available
- Valid Gemini API key(s)

### Quick Start with Docker Compose

1. **Clone and configure**:
```bash
git clone <repository-url>
cd bun-gemini-proxy
cp .env.example .env
```

2. **Edit `.env` file**:
```bash
# Add your Gemini API key(s)
GEMINI_API_KEYS=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Set a secure admin token
ADMIN_TOKEN=your-secure-random-token-here
```

3. **Start the service**:
```bash
docker-compose up -d
```

4. **Verify it's running**:
```bash
curl http://localhost:3000/health
```

### Quick Start with Podman Compose

1. **Same configuration steps as Docker**

2. **Start with Podman**:
```bash
podman-compose -f podman-compose.yml up -d
```

3. **Verify**:
```bash
curl http://localhost:3000/health
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEYS` | ✅ | - | Comma-separated Gemini API keys |
| `ADMIN_TOKEN` | ✅ | - | Admin API authentication token |
| `HOST` | ❌ | `0.0.0.0` | Server bind address |
| `PORT` | ❌ | `3000` | Server port |
| `GEMINI_BASE_URL` | ❌ | Google default | Upstream Gemini API URL |
| `REQUEST_TIMEOUT` | ❌ | `10000` | Request timeout (ms) |
| `MAX_PAYLOAD_SIZE` | ❌ | `10485760` | Max payload size (bytes) |
| `HEALTH_WINDOW_MS` | ❌ | `300000` | Health tracking window (ms) |
| `HEALTH_THRESHOLD` | ❌ | `0.5` | Health score threshold |
| `CIRCUIT_FAILURE_THRESHOLD` | ❌ | `3` | Failures before circuit break |

### Using Custom Config File

Create `config/keys.yaml`:
```yaml
keys:
  - key: AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
    name: primary-key
  - key: AIzaSyYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY
    name: secondary-key

monitoring:
  healthWindowMs: 300000
  healthThreshold: 0.5
```

Uncomment the volume mount in `docker-compose.yml`:
```yaml
volumes:
  - ./config/keys.yaml:/app/config/keys.yaml:ro
```

## Persistence

The proxy stores key health state in `/app/data/` inside the container.

Data is persisted via Docker/Podman volumes:
- SQLite database: `/app/data/proxy-state.db`
- JSON fallback: `/app/data/proxy-state.json`

### Backup State
```bash
# Docker
docker cp gemini-proxy:/app/data ./backup

# Podman
podman cp gemini-proxy:/app/data ./backup
```

## Production Deployment

### Security Hardening

1. **Use strong admin token**:
```bash
ADMIN_TOKEN=$(openssl rand -hex 32)
```

2. **Enable TLS** (use reverse proxy):
```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

3. **Restrict network access**:
```yaml
# docker-compose.yml
networks:
  default:
    internal: true
  proxy:
    external: true
```

### Resource Tuning

Adjust limits based on traffic:
```yaml
deploy:
  resources:
    limits:
      cpus: '2'      # Increase for high traffic
      memory: 1G     # Increase for many keys
```

### High Availability

1. **Multiple replicas with load balancer**:
```yaml
services:
  gemini-proxy:
    deploy:
      replicas: 3
```

2. **Health check integration**:
```bash
# Add to monitoring system
curl http://localhost:3000/health
# Returns 200 OK if healthy, 503 if degraded
```

## Docker Commands

### Build locally
```bash
docker build -t gemini-proxy:latest .
```

### Run without compose
```bash
docker run -d \
  --name gemini-proxy \
  -p 3000:3000 \
  -e GEMINI_API_KEYS=AIzaSy... \
  -e ADMIN_TOKEN=your-token \
  -v $(pwd)/data:/app/data \
  gemini-proxy:latest
```

### View logs
```bash
docker logs -f gemini-proxy
```

### Restart service
```bash
docker-compose restart
```

### Update and redeploy
```bash
git pull
docker-compose build
docker-compose up -d
```

## Podman-Specific Commands

### Rootless mode (recommended)
```bash
podman-compose -f podman-compose.yml up -d
```

### Generate systemd unit
```bash
podman generate systemd --new --name gemini-proxy > ~/.config/systemd/user/gemini-proxy.service
systemctl --user enable gemini-proxy
systemctl --user start gemini-proxy
```

### SELinux context (if needed)
```bash
# Add :Z to volume mounts for automatic labeling
volumes:
  - ./data:/app/data:Z
```

## Monitoring

### Health Endpoints
- **Health check**: `GET /health` - Returns 200 OK or 503 degraded
- **Admin health**: `GET /admin/health` - Detailed key status (requires auth)
- **Metrics**: `GET /admin/metrics` - Prometheus metrics (requires auth)

### View key status
```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  http://localhost:3000/admin/health
```

### Prometheus integration
```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'gemini-proxy'
    static_configs:
      - targets: ['gemini-proxy:3000']
    metrics_path: '/admin/metrics'
    bearer_token: 'YOUR_ADMIN_TOKEN'
```

## Troubleshooting

### Container won't start
```bash
# Check logs
docker logs gemini-proxy

# Common issues:
# - Missing GEMINI_API_KEYS environment variable
# - Port 3000 already in use
# - Insufficient permissions on data directory
```

### Health check failing
```bash
# Test directly
docker exec gemini-proxy bun -e "console.log(await fetch('http://localhost:3000/health').then(r => r.text()))"

# Check key status
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  http://localhost:3000/admin/keys
```

### Permission issues (Podman)
```bash
# Ensure ownership matches
chown -R $(id -u):$(id -g) ./data

# Or use :Z volume flag for SELinux
```

### High memory usage
```bash
# Check current usage
docker stats gemini-proxy

# Adjust limits in docker-compose.yml
```

## Updating

### Docker Compose
```bash
docker-compose down
git pull
docker-compose build
docker-compose up -d
```

### Podman Compose
```bash
podman-compose down
git pull
podman-compose build
podman-compose up -d
```

### Zero-downtime update (multiple replicas)
```bash
docker-compose up -d --no-deps --scale gemini-proxy=6
# Wait for new containers to be healthy
docker-compose up -d --no-deps --scale gemini-proxy=3
```
