#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SERVER_PORT=8000
SERVER_URL="http://localhost:${SERVER_PORT}"
TIMEOUT=30

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Gemini Proxy - OpenAI Endpoints Test Suite  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Function to check if server is running
check_server() {
    local max_attempts=30
    local attempt=1

    echo -e "${YELLOW}⏳ Waiting for server to start...${NC}"

    while [ $attempt -le $max_attempts ]; do
        if curl -s -o /dev/null -w "%{http_code}" "${SERVER_URL}/healthz" | grep -q "200\|503"; then
            echo -e "${GREEN}✓ Server is ready!${NC}"
            return 0
        fi

        echo -n "."
        sleep 1
        attempt=$((attempt + 1))
    done

    echo -e "\n${RED}✗ Server failed to start within ${TIMEOUT}s${NC}"
    return 1
}

# Function to stop server
cleanup() {
    if [ -n "${SERVER_PID:-}" ]; then
        echo -e "\n${YELLOW}🛑 Stopping server (PID: ${SERVER_PID})...${NC}"
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
        echo -e "${GREEN}✓ Server stopped${NC}"
    fi
}

# Set up cleanup trap
trap cleanup EXIT INT TERM

# Parse command line arguments
MODE="${1:-mock}"
RUN_LIVE="${2:-no}"

echo -e "${BLUE}📋 Test Configuration:${NC}"
echo -e "   Mode: ${YELLOW}${MODE}${NC}"
echo -e "   Port: ${YELLOW}${SERVER_PORT}${NC}"
echo -e "   URL:  ${YELLOW}${SERVER_URL}${NC}"
echo ""

# ============================================
# Phase 1: Mock Mode Tests
# ============================================

if [ "$MODE" == "mock" ] || [ "$RUN_LIVE" == "all" ]; then
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Phase 1: Mock Mode Testing${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo ""

    # Backup current config
    echo -e "${YELLOW}📝 Backing up config...${NC}"
    cp config/proxy.yaml config/proxy.yaml.backup || true

    # Configure for mock mode
    echo -e "${YELLOW}⚙️  Configuring mock mode...${NC}"
    cat > config/proxy.yaml << 'EOF'
proxy:
  host: "0.0.0.0"
  port: 8000
  adminToken: "test-admin-token"
  requestTimeoutMs: 10000
  upstreamBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/"
  mode: "mock"
  accessTokens: []
  requireAuth: false

monitoring:
  healthCheckIntervalSeconds: 30
  failureThreshold: 3
  recoveryTimeSeconds: 300
  windowSeconds: 300

persistence:
  sqlitePath: ".runtime/state.sqlite"
  fallbackJsonPath: ".runtime/state.json"
EOF

    echo -e "${GREEN}✓ Mock mode configured${NC}"
    echo ""

    # Start server
    echo -e "${YELLOW}🚀 Starting server in mock mode...${NC}"
    bun run start > .test-server.log 2>&1 &
    SERVER_PID=$!
    echo -e "${GREEN}✓ Server started (PID: ${SERVER_PID})${NC}"

    # Wait for server
    if ! check_server; then
        echo -e "${RED}✗ Server health check failed${NC}"
        echo -e "${YELLOW}📄 Server logs:${NC}"
        cat .test-server.log
        exit 1
    fi

    echo ""
    echo -e "${YELLOW}🧪 Running mock mode tests...${NC}"
    echo ""

    if bun test tests/contract/openai-endpoints.test.ts; then
        echo ""
        echo -e "${GREEN}✅ Mock mode tests PASSED${NC}"
    else
        echo ""
        echo -e "${RED}❌ Mock mode tests FAILED${NC}"
        echo -e "${YELLOW}📄 Server logs:${NC}"
        cat .test-server.log
        exit 1
    fi

    # Stop server
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    SERVER_PID=""

    # Restore config
    echo ""
    echo -e "${YELLOW}♻️  Restoring config...${NC}"
    mv config/proxy.yaml.backup config/proxy.yaml || true

    echo ""
fi

# ============================================
# Phase 2: Live Mode Tests
# ============================================

if [ "$MODE" == "live" ] || [ "$RUN_LIVE" == "all" ]; then
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Phase 2: Live Mode Testing${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════${NC}"
    echo ""

    # Check if keys.yaml has valid keys
    if ! grep -q "AIza" config/keys.yaml 2>/dev/null; then
        echo -e "${YELLOW}⚠️  Warning: No valid Gemini API keys found in config/keys.yaml${NC}"
        echo -e "${YELLOW}⚠️  Live tests may fail without valid keys${NC}"
        echo ""
    fi

    # Backup current config
    echo -e "${YELLOW}📝 Backing up config...${NC}"
    cp config/proxy.yaml config/proxy.yaml.backup || true

    # Configure for live mode
    echo -e "${YELLOW}⚙️  Configuring live mode...${NC}"
    cat > config/proxy.yaml << 'EOF'
proxy:
  host: "0.0.0.0"
  port: 8000
  adminToken: "test-admin-token"
  requestTimeoutMs: 10000
  upstreamBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/"
  mode: "live"
  accessTokens:
    - "sk-proxy-test-token-1"
  requireAuth: true

monitoring:
  healthCheckIntervalSeconds: 30
  failureThreshold: 3
  recoveryTimeSeconds: 300
  windowSeconds: 300

persistence:
  sqlitePath: ".runtime/state.sqlite"
  fallbackJsonPath: ".runtime/state.json"
EOF

    echo -e "${GREEN}✓ Live mode configured${NC}"
    echo ""

    # Start server
    echo -e "${YELLOW}🚀 Starting server in live mode...${NC}"
    bun run start > .test-server.log 2>&1 &
    SERVER_PID=$!
    echo -e "${GREEN}✓ Server started (PID: ${SERVER_PID})${NC}"

    # Wait for server
    if ! check_server; then
        echo -e "${RED}✗ Server health check failed${NC}"
        echo -e "${YELLOW}📄 Server logs:${NC}"
        cat .test-server.log
        exit 1
    fi

    echo ""
    echo -e "${YELLOW}🧪 Running live mode tests...${NC}"
    echo ""

    if bun test tests/contract/openai-endpoints.test.ts; then
        echo ""
        echo -e "${GREEN}✅ Live mode tests PASSED${NC}"
    else
        echo ""
        echo -e "${RED}❌ Live mode tests FAILED${NC}"
        echo -e "${YELLOW}📄 Server logs:${NC}"
        cat .test-server.log
        exit 1
    fi

    # Stop server
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
    SERVER_PID=""

    # Restore config
    echo ""
    echo -e "${YELLOW}♻️  Restoring config...${NC}"
    mv config/proxy.yaml.backup config/proxy.yaml || true

    echo ""
fi

# ============================================
# Summary
# ============================================

echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           ✅ All Tests Passed! ✅             ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}📊 Test Results:${NC}"
echo -e "   • Mock mode: ${GREEN}PASSED${NC}"
if [ "$RUN_LIVE" == "all" ]; then
    echo -e "   • Live mode: ${GREEN}PASSED${NC}"
fi
echo ""
echo -e "${YELLOW}💡 To run tests:${NC}"
echo -e "   ${BLUE}./scripts/test-endpoints.sh mock${NC}   # Mock mode only"
echo -e "   ${BLUE}./scripts/test-endpoints.sh live${NC}   # Live mode only"
echo -e "   ${BLUE}./scripts/test-endpoints.sh all${NC}    # Both modes"
echo ""