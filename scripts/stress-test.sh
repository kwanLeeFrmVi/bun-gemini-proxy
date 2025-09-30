#!/bin/bash
#
# Stress Test Script for Gemini Proxy - Key Rotation Testing
#
# This script sends concurrent requests to test:
# - Key rotation behavior under load
# - Circuit breaker activation
# - Health monitoring
# - Error handling and recovery
#
# Usage: ./scripts/stress-test.sh [options]
#   --url URL           Target server URL (default: http://localhost:8000)
#   --requests N        Number of requests per batch (default: 50)
#   --concurrent N      Concurrent requests (default: 10)
#   --batches N         Number of batches to run (default: 3)
#   --delay N           Delay between batches in seconds (default: 5)
#   --show-responses    Show full responses (verbose mode)
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default configuration
BASE_URL="${BASE_URL:-http://localhost:8000}"
TOTAL_REQUESTS=50
CONCURRENT=10
BATCHES=3
DELAY=5
SHOW_RESPONSES=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --url)
      BASE_URL="$2"
      shift 2
      ;;
    --requests)
      TOTAL_REQUESTS="$2"
      shift 2
      ;;
    --concurrent)
      CONCURRENT="$2"
      shift 2
      ;;
    --batches)
      BATCHES="$2"
      shift 2
      ;;
    --delay)
      DELAY="$2"
      shift 2
      ;;
    --show-responses)
      SHOW_RESPONSES=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Create temp directory for results
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║        Gemini Proxy Stress Test - Key Rotation Testing        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Configuration:${NC}"
echo "  Target URL:          $BASE_URL"
echo "  Requests per batch:  $TOTAL_REQUESTS"
echo "  Concurrent:          $CONCURRENT"
echo "  Batches:             $BATCHES"
echo "  Delay between:       ${DELAY}s"
echo ""

# Function to make a single request
make_request() {
  local req_num=$1
  local batch=$2
  local result_file="$TEMP_DIR/batch${batch}_req${req_num}.json"
  local time_file="$TEMP_DIR/batch${batch}_req${req_num}.time"

  START=$(date +%s%N)

  HTTP_CODE=$(curl -X POST "${BASE_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"gemini-2.0-flash-exp\",\"messages\":[{\"role\":\"user\",\"content\":\"Say 'test $req_num' in 3 words\"}],\"stream\":false}" \
    -s -o "$result_file" -w "%{http_code}" 2>/dev/null)

  END=$(date +%s%N)
  DURATION=$((($END - $START) / 1000000))

  echo "$HTTP_CODE|$DURATION" > "$time_file"

  if [ "$SHOW_RESPONSES" = true ]; then
    echo -e "${CYAN}Response $req_num:${NC} $(cat $result_file | jq -c .)"
  fi
}

# Function to run a batch of requests
run_batch() {
  local batch=$1

  echo -e "${YELLOW}┌─────────────────────────────────────────────────────────────┐${NC}"
  echo -e "${YELLOW}│ Batch $batch: Running $TOTAL_REQUESTS requests ($CONCURRENT concurrent)${NC}"
  echo -e "${YELLOW}└─────────────────────────────────────────────────────────────┘${NC}"

  local pids=()
  local count=0

  for i in $(seq 1 $TOTAL_REQUESTS); do
    make_request $i $batch &
    pids+=($!)
    count=$((count + 1))

    # Limit concurrent requests
    if [ $count -ge $CONCURRENT ]; then
      wait ${pids[@]}
      pids=()
      count=0
    fi
  done

  # Wait for remaining requests
  wait ${pids[@]}

  # Analyze results
  echo ""
  echo -e "${BLUE}Batch $batch Results:${NC}"

  SUCCESS=0
  ERRORS=0
  TOTAL_TIME=0
  MIN_TIME=999999
  MAX_TIME=0

  for i in $(seq 1 $TOTAL_REQUESTS); do
    time_file="$TEMP_DIR/batch${batch}_req${i}.time"
    if [ -f "$time_file" ]; then
      IFS='|' read -r HTTP_CODE DURATION < "$time_file"

      if [ "$HTTP_CODE" = "200" ]; then
        SUCCESS=$((SUCCESS + 1))
      else
        ERRORS=$((ERRORS + 1))
        echo -e "${RED}  ✗ Request $i: HTTP $HTTP_CODE (${DURATION}ms)${NC}"
      fi

      TOTAL_TIME=$((TOTAL_TIME + DURATION))
      [ $DURATION -lt $MIN_TIME ] && MIN_TIME=$DURATION
      [ $DURATION -gt $MAX_TIME ] && MAX_TIME=$DURATION
    fi
  done

  AVG_TIME=$((TOTAL_TIME / TOTAL_REQUESTS))

  echo -e "${GREEN}  ✓ Successful: $SUCCESS / $TOTAL_REQUESTS${NC}"
  [ $ERRORS -gt 0 ] && echo -e "${RED}  ✗ Errors: $ERRORS${NC}"
  echo -e "${BLUE}  ⏱  Min: ${MIN_TIME}ms | Avg: ${AVG_TIME}ms | Max: ${MAX_TIME}ms${NC}"
}

# Function to check health and key stats
check_health() {
  echo ""
  echo -e "${CYAN}Server Health Check:${NC}"

  HEALTH=$(curl -s "${BASE_URL}/health")

  if [ $? -eq 0 ] && [ "$HEALTH" = "ok" ]; then
    echo -e "${GREEN}  ✓ Server is healthy${NC}"
  else
    echo -e "${RED}  ✗ Server health check failed${NC}"
  fi

  # Try to get admin stats if available (may require auth)
  ADMIN_HEALTH=$(curl -s "${BASE_URL}/admin/health" 2>/dev/null)
  if echo "$ADMIN_HEALTH" | jq -e '.totalKeys' > /dev/null 2>&1; then
    echo ""
    echo -e "${CYAN}  Key Statistics:${NC}"
    echo "$ADMIN_HEALTH" | jq -r '
      "    Total Keys: \(.totalKeys)",
      "    Active Keys: \(.activeKeys)",
      "    Circuit Broken: \(.circuitBrokenKeys)"
    '

    echo ""
    echo -e "${CYAN}  Key Details:${NC}"
    echo "$ADMIN_HEALTH" | jq -r '.keys[] |
      "    • \(.name): \(if .healthy then "✓ HEALTHY" else "✗ UNHEALTHY" end) | " +
      "Score: \(.healthScore) | " +
      "Success: \(.successCount) | " +
      "Failures: \(.failureCount) | " +
      "Circuit: \(if .circuitBroken then "OPEN" else "CLOSED" end)"
    '
  fi
}

# Initial health check
echo -e "${BLUE}Initial Health Check:${NC}"
check_health

# Run batches
for batch in $(seq 1 $BATCHES); do
  echo ""
  echo ""
  run_batch $batch

  # Check health after each batch
  check_health

  # Delay before next batch (except last one)
  if [ $batch -lt $BATCHES ]; then
    echo ""
    echo -e "${YELLOW}⏳ Waiting ${DELAY}s before next batch...${NC}"
    sleep $DELAY
  fi
done

# Final summary
echo ""
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                      Final Summary                             ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"

TOTAL_SUCCESS=0
TOTAL_ERRORS=0
TOTAL_TIME=0
ALL_MIN_TIME=999999
ALL_MAX_TIME=0

for batch in $(seq 1 $BATCHES); do
  for i in $(seq 1 $TOTAL_REQUESTS); do
    time_file="$TEMP_DIR/batch${batch}_req${i}.time"
    if [ -f "$time_file" ]; then
      IFS='|' read -r HTTP_CODE DURATION < "$time_file"

      if [ "$HTTP_CODE" = "200" ]; then
        TOTAL_SUCCESS=$((TOTAL_SUCCESS + 1))
      else
        TOTAL_ERRORS=$((TOTAL_ERRORS + 1))
      fi

      TOTAL_TIME=$((TOTAL_TIME + DURATION))
      [ $DURATION -lt $ALL_MIN_TIME ] && ALL_MIN_TIME=$DURATION
      [ $DURATION -gt $ALL_MAX_TIME ] && ALL_MAX_TIME=$DURATION
    fi
  done
done

TOTAL_ALL_REQUESTS=$((BATCHES * TOTAL_REQUESTS))
AVG_ALL_TIME=$((TOTAL_TIME / TOTAL_ALL_REQUESTS))
SUCCESS_RATE=$((TOTAL_SUCCESS * 100 / TOTAL_ALL_REQUESTS))

echo ""
echo -e "${BLUE}Overall Statistics:${NC}"
echo "  Total Requests:      $TOTAL_ALL_REQUESTS"
echo -e "${GREEN}  Successful:          $TOTAL_SUCCESS (${SUCCESS_RATE}%)${NC}"
[ $TOTAL_ERRORS -gt 0 ] && echo -e "${RED}  Errors:              $TOTAL_ERRORS${NC}"
echo -e "${BLUE}  Min Latency:         ${ALL_MIN_TIME}ms${NC}"
echo -e "${BLUE}  Avg Latency:         ${AVG_ALL_TIME}ms${NC}"
echo -e "${BLUE}  Max Latency:         ${ALL_MAX_TIME}ms${NC}"

echo ""
echo -e "${CYAN}Final Health State:${NC}"
check_health

echo ""
if [ $TOTAL_ERRORS -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed! Key rotation working correctly.${NC}"
else
  echo -e "${YELLOW}⚠ Some errors occurred. Check logs for details.${NC}"
fi

echo ""
