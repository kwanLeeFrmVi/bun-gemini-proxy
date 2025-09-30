# bun-gemini-proxy

Gemini API Proxy Server with OpenAI-compatible endpoints, supporting key rotation, health monitoring, and circuit breaking.

## Quick Start with bunx

Run directly from GitHub without cloning:

```bash
# 1. Create config files in your working directory
curl -o proxy.yaml https://raw.githubusercontent.com/YOUR_USERNAME/bun-gemini-proxy/main/proxy.example.yaml
curl -o keys.yaml https://raw.githubusercontent.com/YOUR_USERNAME/bun-gemini-proxy/main/keys.example.yaml

# 2. Edit keys.yaml with your Gemini API keys

# 3. Run the proxy
bunx github:YOUR_USERNAME/bun-gemini-proxy
```

The proxy will automatically read `proxy.yaml` and `keys.yaml` from your current directory.

When the server starts, you'll see:
```
🚀 Gemini Proxy Server is running!
📖 Open user guide: http://0.0.0.0:8000/help
```

**Open http://localhost:8000/help in your browser** for comprehensive documentation including:
- API endpoints and usage
- SDK integration examples (JavaScript, Python, Go, Ruby)
- Configuration reference
- Admin endpoints
- Troubleshooting guide
- Performance tuning

## Local Development

```bash
# Install dependencies
bun install

# Copy example configs
cp proxy.example.yaml config/proxy.yaml
cp keys.example.yaml config/keys.yaml

# Edit config/keys.yaml with your API keys

# Run locally
bun run start

# Open user guide in browser
open http://localhost:8000/help
```

## Configuration

### Config Priority

The proxy searches for config files in this order:
1. CLI options (if provided via code)
2. Environment variables (`PROXY_CONFIG_PATH`, `KEYS_CONFIG_PATH`)
3. Current working directory (`./proxy.yaml`, `./keys.yaml`)
4. Local config directory (`./config/proxy.yaml`, `./config/keys.yaml`)

### Example Config Files

See [proxy.example.yaml](proxy.example.yaml) and [keys.example.yaml](keys.example.yaml) for configuration examples.

This project uses [Bun](https://bun.com) as its runtime.
