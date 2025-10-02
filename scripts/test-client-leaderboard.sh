#!/bin/bash
# Test script for client leaderboard feature

set -e

echo "🧪 Testing Client Leaderboard Feature"
echo "======================================"

# Check if server is running
if ! curl -s http://localhost:8000/health > /dev/null 2>&1; then
  echo "❌ Error: Server is not running on port 8000"
  echo "Start the server with: bun run start"
  exit 1
fi

echo "✅ Server is running"
echo ""

# Check database for client metrics table
if [ -f ".runtime/state.sqlite" ]; then
  echo "📊 Checking database schema..."
  TABLE_EXISTS=$(sqlite3 .runtime/state.sqlite "SELECT name FROM sqlite_master WHERE type='table' AND name='client_metrics';" 2>/dev/null || echo "")
  if [ -n "$TABLE_EXISTS" ]; then
    echo "✅ client_metrics table exists"

    # Check current records
    RECORD_COUNT=$(sqlite3 .runtime/state.sqlite "SELECT COUNT(*) FROM client_metrics;" 2>/dev/null || echo "0")
    echo "📈 Current client metrics records: $RECORD_COUNT"
  else
    echo "❌ client_metrics table not found"
    exit 1
  fi
else
  echo "⚠️  Database file not found yet (will be created on first request)"
fi

echo ""
echo "🚀 Sending test requests..."

# Send 5 requests
for i in {1..5}; do
  curl -s -X POST http://localhost:8000/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model": "gemini-2.0-flash-lite", "messages": [{"role": "user", "content": "Test"}], "max_tokens": 2}' \
    > /dev/null 2>&1 && echo "  ✓ Request $i sent" || echo "  ✗ Request $i failed"
done

echo ""
echo "⏳ Waiting 12 seconds for metrics flush..."
sleep 12

echo ""
echo "🔍 Checking database for new records..."
if [ -f ".runtime/state.sqlite" ]; then
  NEW_COUNT=$(sqlite3 .runtime/state.sqlite "SELECT COUNT(*) FROM client_metrics;" 2>/dev/null || echo "0")
  echo "📈 Client metrics records after test: $NEW_COUNT"

  if [ "$NEW_COUNT" -gt "0" ]; then
    echo ""
    echo "✅ SUCCESS! Client metrics are being tracked"
    echo ""
    echo "📋 Client metrics data:"
    sqlite3 .runtime/state.sqlite "SELECT client_id, timestamp, request_count, success_count, error_count FROM client_metrics;" -header -column

    echo ""
    echo "🌐 Visit http://localhost:8000/info to see the client leaderboard"
  else
    echo "⚠️  No metrics found yet - this may indicate an issue with the flush interval"
  fi
else
  echo "❌ Database file still not found"
fi

echo ""
echo "======================================"
echo "Test complete!"
