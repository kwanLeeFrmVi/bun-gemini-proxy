# Suggested Commands for Development

## Bun Path Setup (Required First)
```bash
# Add bun to PATH if not already available
export PATH=$HOME/.bun/bin:$PATH

# Or use full path
~/.bun/bin/bun <command>
```

## Core Development Commands

### Running the Application
```bash
# Start the server
bun run index.ts

# Start with hot reload (auto-restart on changes)
bun --hot index.ts

# Start with watch mode
bun --watch index.ts
```

### Package Management
```bash
# Install dependencies
bun install

# Add a new dependency
bun add <package>

# Add a dev dependency
bun add -d <package>

# Update dependencies
bun update
```

### Testing
```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run specific test file
bun test path/to/file.test.ts
```

### Building & Bundling
```bash
# Build/bundle TypeScript files
bun build index.ts --outdir=dist

# Build with minification
bun build index.ts --outdir=dist --minify
```

### TypeScript & Linting
```bash
# Type check without emitting
bun tsc --noEmit

# Check TypeScript types
bun run tsc
```

### Database (SQLite)
```bash
# Access SQLite shell (once DB is created)
bun run sqlite3 <database.db>
```

### Environment & Debugging
```bash
# Run with environment variables (Bun auto-loads .env)
bun run index.ts

# Run with debug output
BUN_DEBUG=1 bun run index.ts

# Check Bun version
bun --version
```

### Git Commands
```bash
# Check status
git status

# Stage changes
git add .

# Commit changes
git commit -m "message"

# Push changes
git push origin main
```

### System Utilities (macOS/Darwin)
```bash
# List files with details
ls -la

# Find files
find . -name "*.ts"

# Search in files
grep -r "pattern" .

# Check port usage
lsof -i :4806

# Kill process on port
kill -9 $(lsof -t -i:4806)
```

### Project-Specific (Future)
```bash
# Start proxy server on port 4806
PORT=4806 bun run index.ts

# Run with specific config
CONFIG_PATH=./config.yaml bun run index.ts

# Check health endpoint
curl http://localhost:4806/health

# View metrics
curl http://localhost:4806/metrics
```

## Important Notes
- Bun automatically loads `.env` files - no need for dotenv
- Use Bun's native APIs (Bun.serve, bun:sqlite) instead of Node.js packages
- The project runs on macOS (Darwin), some commands may differ on Linux