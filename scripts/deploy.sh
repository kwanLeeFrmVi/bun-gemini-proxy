#!/bin/bash
#
# Deploy script for bun-gemini-proxy to staging server
#
# This script:
# 1. Builds the Linux binary
# 2. Copies binary + config files to remote server
# 3. Restarts PM2 process on remote server
#
# Usage: ./scripts/deploy.sh [options]
#   --skip-build    Skip the build step (use existing binary)
#   --dry-run       Show what would be deployed without actually deploying
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SSH_HOST="mwmx-staging"
REMOTE_USER="ec2-user"
REMOTE_PATH="/home/ec2-user/bun-gemini-proxy"
BINARY_NAME="bun-gemini-proxy-linux-arm64-glibc"  # ARM64 for EC2 Graviton instances
LOCAL_BIN_DIR="./bin"
LOCAL_BINARY="$LOCAL_BIN_DIR/$BINARY_NAME"

# Parse arguments
SKIP_BUILD=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

echo -e "${GREEN}=== Bun Gemini Proxy Deployment ===${NC}"
echo ""

# Step 1: Build binary
if [ "$SKIP_BUILD" = false ]; then
  echo -e "${YELLOW}→ Building Linux binary...${NC}"
  bun run build:linux

  if [ ! -f "$LOCAL_BINARY" ]; then
    echo -e "${RED}✗ Build failed: $LOCAL_BINARY not found${NC}"
    exit 1
  fi

  echo -e "${GREEN}✓ Build complete${NC}"
else
  echo -e "${YELLOW}→ Skipping build (--skip-build)${NC}"

  if [ ! -f "$LOCAL_BINARY" ]; then
    echo -e "${RED}✗ Binary not found: $LOCAL_BINARY${NC}"
    echo -e "${RED}  Run without --skip-build to build first${NC}"
    exit 1
  fi
fi

# Step 2: Verify config files exist
echo ""
echo -e "${YELLOW}→ Verifying configuration files...${NC}"

CONFIG_FILES=("proxy.yaml" "keys.yaml" "ecosystem.config.js")
MISSING_FILES=()

for file in "${CONFIG_FILES[@]}"; do
  if [ ! -f "./$file" ]; then
    MISSING_FILES+=("$file")
  fi
done

if [ ${#MISSING_FILES[@]} -gt 0 ]; then
  echo -e "${RED}✗ Missing configuration files:${NC}"
  for file in "${MISSING_FILES[@]}"; do
    echo -e "${RED}  - $file${NC}"
  done
  echo ""
  echo -e "${YELLOW}Note: You may need to copy from example files:${NC}"
  echo "  cp proxy.example.yaml proxy.yaml"
  echo "  cp keys.example.yaml keys.yaml"
  exit 1
fi

echo -e "${GREEN}✓ All configuration files present${NC}"

# Step 3: Display deployment summary
echo ""
echo -e "${GREEN}=== Deployment Summary ===${NC}"
echo "  Binary: $LOCAL_BINARY"
echo "  Target: $SSH_HOST:$REMOTE_PATH"
echo "  Config: proxy.yaml, keys.yaml, ecosystem.config.js"
echo ""

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}→ Dry run mode - no actual deployment${NC}"
  exit 0
fi

# Step 4: Stop PM2 process (to unlock binary file)
echo -e "${YELLOW}→ Stopping PM2 process...${NC}"
ssh "$SSH_HOST" bash -l << 'EOF'
  if command -v bunx &> /dev/null; then
    bunx pm2 stop bun-gemini-proxy 2>/dev/null || true
  fi
EOF

# Step 5: Create remote directory structure
echo -e "${YELLOW}→ Preparing remote server...${NC}"
ssh "$SSH_HOST" "mkdir -p $REMOTE_PATH/logs && mkdir -p $REMOTE_PATH/bin"

# Step 6: Copy files to remote server
echo -e "${YELLOW}→ Copying files to server...${NC}"

# Copy binary
scp "$LOCAL_BINARY" "$SSH_HOST:$REMOTE_PATH/bin/$BINARY_NAME"

# Copy configuration files
scp "./proxy.yaml" "$SSH_HOST:$REMOTE_PATH/"
scp "./keys.yaml" "$SSH_HOST:$REMOTE_PATH/"
scp "./ecosystem.config.js" "$SSH_HOST:$REMOTE_PATH/"

echo -e "${GREEN}✓ Files copied successfully${NC}"

# Step 7: Set executable permissions
echo -e "${YELLOW}→ Setting permissions...${NC}"
ssh "$SSH_HOST" "chmod +x $REMOTE_PATH/bin/$BINARY_NAME"

# Step 8: Start PM2 process
echo ""
echo -e "${YELLOW}→ Restarting PM2 process...${NC}"

ssh "$SSH_HOST" bash -l << 'EOF'
  cd /home/ec2-user/bun-gemini-proxy

  # Start or restart PM2 process
  if bunx pm2 describe bun-gemini-proxy > /dev/null 2>&1; then
    echo "Restarting existing PM2 process..."
    bunx pm2 restart bun-gemini-proxy
  else
    echo "Starting new PM2 process..."
    bunx pm2 start ecosystem.config.js
    bunx pm2 save
  fi

  # Show status
  bunx pm2 list
  echo ""
  echo "Recent logs:"
  bunx pm2 logs bun-gemini-proxy --lines 20 --nostream
EOF

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo -e "${YELLOW}Useful commands:${NC}"
echo "  ssh $SSH_HOST 'bunx pm2 logs bun-gemini-proxy'     # View logs"
echo "  ssh $SSH_HOST 'bunx pm2 restart bun-gemini-proxy'  # Restart service"
echo "  ssh $SSH_HOST 'bunx pm2 status'                     # Check status"
echo "  ssh $SSH_HOST 'bunx pm2 monit'                      # Monitor resources"
echo ""
