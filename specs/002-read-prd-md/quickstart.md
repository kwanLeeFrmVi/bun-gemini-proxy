# Quickstart Guide: Gemini Proxy Server

**Generated**: 2025-09-29
**Feature**: Gemini Proxy Server

This guide validates the core user scenarios from the feature specification through step-by-step testing.

## Prerequisites

- Bun runtime installed (latest stable version)
- Valid Gemini API keys
- OpenAI SDK or curl for testing

## Setup

### 1. Configuration

Create `config/keys.yaml`:
```yaml
keys:
  - name: "primary-key"
    key: "your-gemini-api-key-1"
    weight: 2
  - name: "backup-key"
    key: "your-gemini-api-key-2"
    weight: 1
```

Create `config/proxy.yaml`:
```yaml
proxy:
  port: 4806
  host: "localhost"
  maxPayloadSize: 10485760  # 10MB
  adminToken: "secure-admin-token"

monitoring:
  healthCheckInterval: 30
  failureThreshold: 3
  recoveryTime: 300  # 5 minutes
```

### 2. Start Server

```bash
bun run index.ts
```

Expected output:
```
🚀 Gemini Proxy Server started on http://localhost:4806
📊 Admin endpoints available at /admin/*
🔑 Loaded 2 API keys from configuration
✅ Health monitoring active
```

## Acceptance Scenario Testing

### Scenario 1: OpenAI SDK Compatibility

**Given**: Backend engineer has OpenAI SDK configured for localhost:4806
**When**: Send chat completion request
**Then**: Request successfully forwarded to Gemini API

```bash
# Test with curl (simulating OpenAI SDK)
curl -X POST http://localhost:4806/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-pro",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "max_tokens": 100
  }'
```

**Expected Response**:
- Status: 200 OK
- Body: Valid OpenAI-compatible chat completion response
- Headers: Standard OpenAI response headers

**Validation Steps**:
1. ✅ Request accepted and processed
2. ✅ Response follows OpenAI schema
3. ✅ Latency under 100ms overhead
4. ✅ Response contains actual Gemini content

### Scenario 2: Automatic Key Rotation

**Given**: Multiple API keys configured
**When**: One key becomes unhealthy due to rate limits
**Then**: System automatically routes to healthy keys

**Setup**: Trigger rate limiting on primary key
```bash
# Send multiple rapid requests to trigger rate limiting
for i in {1..10}; do
  curl -X POST http://localhost:4806/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model": "gemini-pro", "messages": [{"role": "user", "content": "Test '$i'"}]}' &
done
wait
```

**Check Key Health**:
```bash
curl -H "Authorization: Bearer secure-admin-token" \
  http://localhost:4806/admin/keys
```

**Expected Behavior**:
1. ✅ Primary key shows degraded health score
2. ✅ Requests automatically route to backup key
3. ✅ No service interruption experienced
4. ✅ Circuit breaker activates after 3 failures

**Validation Steps**:
1. Monitor admin endpoint for key status changes
2. Verify continued successful responses during rotation
3. Check logs for key switching events
4. Confirm backup key receives traffic

### Scenario 3: State Persistence Across Restarts

**Given**: Proxy server running with health data
**When**: Server is restarted
**Then**: Retains all key health scores and usage history

**Setup**: Generate some health data
```bash
# Generate mixed success/failure requests
curl -X POST http://localhost:4806/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gemini-pro", "messages": [{"role": "user", "content": "Test request"}]}'

# Send malformed request to generate failure
curl -X POST http://localhost:4806/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"invalid": "request"}'
```

**Check Initial State**:
```bash
curl -H "Authorization: Bearer secure-admin-token" \
  http://localhost:4806/admin/health
```

**Restart Server**:
```bash
# Stop server (Ctrl+C)
# Restart server
bun run index.ts
```

**Validate Persistence**:
```bash
curl -H "Authorization: Bearer secure-admin-token" \
  http://localhost:4806/admin/health
```

**Expected Results**:
1. ✅ Health scores match pre-restart values
2. ✅ Request counters preserved
3. ✅ Circuit breaker states maintained
4. ✅ Configuration reloaded correctly

### Scenario 4: Operational Visibility

**Given**: Ops team member needs system status
**When**: Access health endpoint
**Then**: Clear diagnostic information available

**Health Check**:
```bash
curl -H "Authorization: Bearer secure-admin-token" \
  http://localhost:4806/admin/health
```

**Expected Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-09-29T10:30:00Z",
  "uptime": 3600,
  "keys": {
    "total": 2,
    "healthy": 2,
    "unhealthy": 0,
    "disabled": 0
  }
}
```

**Detailed Key Status**:
```bash
curl -H "Authorization: Bearer secure-admin-token" \
  http://localhost:4806/admin/keys
```

**Prometheus Metrics**:
```bash
curl -H "Authorization: Bearer secure-admin-token" \
  http://localhost:4806/admin/metrics
```

**Validation Checklist**:
1. ✅ Overall system status clearly indicated
2. ✅ Individual key health scores visible
3. ✅ Circuit breaker states shown
4. ✅ Metrics available for monitoring tools
5. ✅ Admin authentication working
6. ✅ Clear error messages for issues

## Edge Case Testing

### All Keys Unhealthy
```bash
# Disable all keys manually
curl -X POST -H "Authorization: Bearer secure-admin-token" \
  http://localhost:4806/admin/keys/primary-key/disable

curl -X POST -H "Authorization: Bearer secure-admin-token" \
  http://localhost:4806/admin/keys/backup-key/disable

# Test request with all keys disabled
curl -X POST http://localhost:4806/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gemini-pro", "messages": [{"role": "user", "content": "Test"}]}'
```

**Expected**: 503 Service Unavailable with clear error message

### Malformed Requests
```bash
# Test oversized payload
curl -X POST http://localhost:4806/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gemini-pro", "messages": [{"role": "user", "content": "'$(head -c 15000000 /dev/zero | tr '\0' 'a')'"}]}'
```

**Expected**: 413 Payload Too Large

### Configuration Hot Reload
```bash
# Modify config/keys.yaml to add new key
# Check for automatic reload
curl -H "Authorization: Bearer secure-admin-token" \
  http://localhost:4806/admin/keys
```

**Expected**: New key appears without restart

## Performance Validation

### Latency Testing
```bash
# Measure proxy overhead
time curl -X POST http://localhost:4806/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gemini-pro", "messages": [{"role": "user", "content": "Quick test"}]}'
```

**Target**: Total response time should show <100ms proxy overhead

### Concurrent Load Testing
```bash
# Test concurrent requests
for i in {1..50}; do
  curl -X POST http://localhost:4806/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"model": "gemini-pro", "messages": [{"role": "user", "content": "Load test '$i'"}]}' &
done
wait
```

**Expected**: 99% success rate under concurrent load

## Success Criteria

- ✅ All acceptance scenarios pass
- ✅ Edge cases handled gracefully
- ✅ Performance targets met
- ✅ Admin endpoints functional
- ✅ State persistence working
- ✅ Configuration hot reload active
- ✅ Comprehensive logging and metrics

## Troubleshooting

### Common Issues

1. **Connection refused**: Check if server is running on correct port
2. **Authentication errors**: Verify admin token in config
3. **Rate limiting**: Check Gemini API quotas and key validity
4. **Health degradation**: Monitor circuit breaker states and recovery

### Log Analysis
```bash
# Check server logs for errors
grep "ERROR" proxy.log

# Monitor key rotation events
grep "KEY_ROTATION" proxy.log

# Check health score changes
grep "HEALTH_UPDATE" proxy.log
```

This quickstart guide validates all core functionality and serves as both testing framework and user documentation.