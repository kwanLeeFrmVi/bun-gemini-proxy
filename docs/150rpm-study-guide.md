# Achieving 150 RPM with Free Tier - Study Guide

## Overview

This guide demonstrates achieving 150 requests per minute (RPM) on Gemini API using 5 free-tier keys with the proxy's intelligent key rotation and cooldown enforcement system. Perfect for academic assignments and learning distributed system design patterns.

## Prerequisites

### 1. Get 5 Gemini API Keys

**Recommended Model**: Gemini 2.0 Flash-Lite (30 RPM per key)

**Steps**:
1. Create 5 Google accounts (or use existing ones)
2. Visit [Google AI Studio](https://aistudio.google.com/apikey)
3. Generate API key for each account
4. Save all 5 keys securely

**Per-key limits (Free Tier)**:
- **RPM**: 30 requests/minute
- **RPD**: 200 requests/day
- **TPM**: 1,000,000 tokens/minute

**Total capacity with 5 keys**:
- **150 RPM** (5 × 30)
- **1,000 RPD** (5 × 200)

## Configuration

### keys.yaml

Create or update `keys.yaml` in your project root:

```yaml
keys:
  - name: flash-lite-key-1
    key: AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX  # Replace with your key
    cooldownSeconds: 3  # 60s / 30 RPM + 1s safety = 3s
    weight: 1

  - name: flash-lite-key-2
    key: AIzaSyYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY  # Replace with your key
    cooldownSeconds: 3
    weight: 1

  - name: flash-lite-key-3
    key: AIzaSyZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ  # Replace with your key
    cooldownSeconds: 3
    weight: 1

  - name: flash-lite-key-4
    key: AIzaSyAAAAAAAAAAAAAAAAAAAAAAAAAAAAA  # Replace with your key
    cooldownSeconds: 3
    weight: 1

  - name: flash-lite-key-5
    key: AIzaSyBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB  # Replace with your key
    cooldownSeconds: 3
    weight: 1
```

### proxy.yaml

Default settings work well:

```yaml
proxy:
  host: 0.0.0.0
  port: 4806
  maxPayloadSizeBytes: 10485760  # 10MB
  requestTimeoutMs: 10000         # 10 seconds
  upstreamBaseUrl: https://generativelanguage.googleapis.com
  requireAuth: false              # Set true for production

monitoring:
  healthCheckIntervalSeconds: 30
  failureThreshold: 10            # Tolerate 10 failures before circuit opens
  recoveryTimeSeconds: 60         # Wait 60s before retrying failed keys
  windowSeconds: 300              # 5-minute health tracking window
```

## How It Works

### 1. Key Rotation Algorithm

**Weighted Random Selection**:
- Each key has a weight (default: 1)
- Higher weight = higher selection probability
- All keys have equal weight in this configuration

**Cooldown Enforcement**:
```typescript
// Pseudo-code
isEligible(key) {
  if (!key.isActive) return false;
  if (key.circuitState === "OPEN") return false;

  // Cooldown check
  timeSinceLastUse = now - key.lastUsedAt;
  if (timeSinceLastUse < key.cooldownSeconds) return false;

  return true;
}
```

### 2. Request Flow

```
Request arrives
    ↓
Filter eligible keys (not in cooldown, circuit CLOSED)
    ↓
Weighted random selection
    ↓
Use selected key → Update lastUsedAt
    ↓
Success → Record success, update health score
    ↓
Failure → Record failure, may open circuit
```

### 3. Example Timeline

```
Time     Request  Selected  Cooldown Until  Status
------   -------  --------  --------------  ------
00:00    Req 1    Key 1     00:03          ✅ Success
00:00    Req 2    Key 2     00:03          ✅ Success
00:01    Req 3    Key 3     00:04          ✅ Success
00:01    Req 4    Key 4     00:04          ✅ Success
00:02    Req 5    Key 5     00:05          ✅ Success
00:03    Req 6    Key 1     00:06          ✅ Success (cooldown elapsed)
00:03    Req 7    Key 2     00:06          ✅ Success
00:04    Req 8    Key 3     00:07          ✅ Success
```

**Result**: Continuous 150 RPM throughput with no rate limit errors

## Testing

### 1. Start the Proxy

```bash
bun run start
```

**Expected output**:
```
{"level":30,"time":...,"msg":"Gemini proxy server listening","host":"0.0.0.0","port":4806}
{"level":30,"time":...,"msg":"Bootstrapped 5 API keys"}
```

### 2. Single Request Test

```bash
curl -X POST http://localhost:4806/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini-2.0-flash-lite",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

**Expected response**:
```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1735689600,
  "model": "gemini-2.0-flash-lite",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "I'm doing well, thank you! ..."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 45,
    "total_tokens": 57
  }
}
```

### 3. Load Test (150 RPM)

**Install Apache Bench**:
```bash
# macOS
brew install httpd

# Ubuntu/Debian
sudo apt install apache2-utils
```

**Create test payload** (`request.json`):
```json
{
  "model": "gemini-2.0-flash-lite",
  "messages": [
    {"role": "user", "content": "What is 2+2?"}
  ]
}
```

**Run load test**:
```bash
# 150 requests in 60 seconds = 150 RPM
ab -n 150 -c 5 -t 60 -T 'application/json' -p request.json \
  http://localhost:4806/v1/chat/completions
```

**Expected results**:
```
Concurrency Level:      5
Time taken for tests:   60.xxx seconds
Complete requests:      150
Failed requests:        0
Requests per second:    2.50 [#/sec] (mean)
```

### 4. Stress Test (300 RPM)

Test beyond capacity to verify cooldown enforcement:

```bash
ab -n 300 -c 10 -t 60 -T 'application/json' -p request.json \
  http://localhost:4806/v1/chat/completions
```

**Expected behavior**:
- Some requests wait for key availability
- No 429 rate limit errors
- Graceful throttling to 150 RPM

## Monitoring

### Check Key Health

```bash
curl http://localhost:4806/admin/keys | jq
```

**Expected output**:
```json
{
  "keys": [
    {
      "id": "flash-lite-key-1",
      "name": "flash-lite-key-1",
      "status": "active",
      "healthScore": 1.0,
      "lastUsed": "2025-10-02T10:30:15.123Z",
      "failureCount": 0,
      "nextRetry": null,
      "weight": 1
    },
    // ... 4 more keys
  ],
  "summary": {
    "total": 5,
    "active": 5,
    "circuit_open": 0,
    "circuit_half_open": 0,
    "disabled": 0
  }
}
```

### Check Prometheus Metrics

```bash
curl http://localhost:4806/metrics
```

**Key metrics**:
```
# Total requests processed
gemini_proxy_requests_total{endpoint="/v1/chat/completions",method="POST",status="200",result="success"} 150

# Per-key health scores (0-1)
gemini_proxy_key_health_score{key_id="flash-lite-key-1",key_name="flash-lite-key-1"} 1.0

# Circuit breaker states (0=CLOSED, 1=HALF_OPEN, 2=OPEN)
gemini_proxy_circuit_state{key_id="flash-lite-key-1",key_name="flash-lite-key-1"} 0

# Request duration histogram
gemini_proxy_request_duration_seconds_bucket{endpoint="/v1/chat/completions",method="POST",le="1"} 145
```

## System Design Patterns Demonstrated

### 1. **Load Balancing**
- **Pattern**: Weighted random selection
- **Benefit**: Even distribution across keys
- **Implementation**: [key-selector.ts](../src/keys/key-selector.ts)

### 2. **Circuit Breaker**
- **Pattern**: 3-state circuit (CLOSED → OPEN → HALF_OPEN)
- **Benefit**: Isolate failing keys, prevent cascade failures
- **Implementation**: [circuit-breaker.ts](../src/keys/circuit-breaker.ts)

### 3. **Rate Limiting**
- **Pattern**: Per-resource cooldown enforcement
- **Benefit**: Proactive 429 error prevention
- **Implementation**: [key-selector.ts](../src/keys/key-selector.ts#L63-L83)

### 4. **Health Monitoring**
- **Pattern**: Sliding window metrics
- **Benefit**: Track key reliability over time
- **Implementation**: [health-tracker.ts](../src/keys/health-tracker.ts)

### 5. **Horizontal Scaling**
- **Pattern**: Resource pooling
- **Benefit**: Linear throughput increase with resources
- **Formula**: `Total RPM = Keys × RPM_per_key`

## Assignment Demonstration Checklist

### ✅ Functional Requirements

- [ ] 5 API keys configured in `keys.yaml`
- [ ] Proxy starts successfully
- [ ] Single request test passes
- [ ] 150 RPM sustained in load test
- [ ] No 429 errors under normal load
- [ ] Keys rotate automatically

### ✅ System Architecture

- [ ] Circuit breaker pattern implemented
- [ ] Health tracking per key operational
- [ ] Cooldown enforcement working
- [ ] Weighted random selection functional
- [ ] Metrics exposed via `/metrics`

### ✅ Performance Metrics

| Metric | Target | Actual |
|--------|--------|--------|
| Max RPM | 150 | _____ |
| Success rate | >99% | _____ |
| Circuit opens | 0 | _____ |
| Avg latency | <1s | _____ |
| Daily quota | 1,000 | _____ |

### ✅ Documentation

- [ ] Architecture diagram created
- [ ] Configuration documented
- [ ] Test results captured
- [ ] Load test screenshots
- [ ] Metrics analysis included

## Troubleshooting

### Issue: Getting 429 Errors

**Symptoms**: Responses with `status: 429`

**Possible Causes**:
1. Cooldown too short
2. Keys not rotating properly
3. Using wrong model (check RPM limits)

**Solutions**:
```yaml
# Increase cooldown safety margin
cooldownSeconds: 4  # Instead of 3

# Verify model supports 30 RPM
# Use gemini-2.0-flash-lite, not gemini-2.5-pro
```

### Issue: Low Throughput

**Symptoms**: Can't achieve 150 RPM

**Check**:
```bash
# 1. Verify all keys configured
curl http://localhost:4806/admin/keys | jq '.summary.total'
# Should return: 5

# 2. Check all keys active
curl http://localhost:4806/admin/keys | jq '.summary.active'
# Should return: 5

# 3. Verify no circuits open
curl http://localhost:4806/admin/keys | jq '.summary.circuit_open'
# Should return: 0
```

**Solutions**:
- Ensure all 5 keys in `keys.yaml`
- Check each key has `weight: 1`
- Verify no keys disabled

### Issue: Circuit Breaker Opens

**Symptoms**: Keys showing `status: "circuit_open"`

**Check logs**:
```bash
# View error logs
tail -f logs/*.log | grep -i error
```

**Common causes**:
1. Invalid API key → Regenerate key
2. Network errors → Check connectivity
3. Model not available → Verify model name

**Reset circuit**:
```bash
# Manually enable key
curl -X POST http://localhost:4806/admin/keys/flash-lite-key-1/enable \
  -H "Authorization: Bearer test-admin-token"
```

## Advanced: Model Comparison

| Model | Free RPM | Keys for 150 RPM | Daily Quota (5 keys) |
|-------|----------|------------------|----------------------|
| Gemini 2.5 Pro | 5 | **30** | 500 |
| Gemini 2.5 Flash | 10 | **15** | 1,250 |
| **Gemini 2.0 Flash-Lite** ⭐ | **30** | **5** | **1,000** |
| Gemini 2.0 Flash | 15 | **10** | 1,000 |

**Recommendation**: Use **Gemini 2.0 Flash-Lite** for easiest 150 RPM setup.

## Cost Analysis (Optional: Paid Tier)

If you need >150 RPM for production, consider Tier 1 upgrade:

| Tier | RPM/Key | Cost | Keys Needed | Monthly Cost Est. |
|------|---------|------|-------------|-------------------|
| Free | 30 | $0 | 5 | $0 |
| **Tier 1** | **150** | Pay-as-you-go | **1** | ~$50-200 |

**Tier 1 Benefits**:
- Single key = 150 RPM
- 1,000 RPD per key
- No account management
- Official support

## References

- [Gemini API Rate Limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Project PRD](../PRD.md)
- [Architecture Spec](../specs/002-read-prd-md/spec.md)

## Example Report Template

```markdown
# Gemini API Proxy - Assignment Report

## System Overview
- **Goal**: Achieve 150 RPM throughput
- **Approach**: 5 free-tier keys with intelligent rotation
- **Model**: Gemini 2.0 Flash-Lite

## Architecture

[Insert diagram showing: Client → Proxy → Key Pool → Gemini API]

### Key Components
1. **Key Manager**: Coordinates key selection and health tracking
2. **Circuit Breaker**: Isolates failing keys (3-state pattern)
3. **Health Tracker**: Monitors success/failure rates
4. **Key Selector**: Weighted random distribution with cooldown

## Performance Results

| Metric | Target | Achieved |
|--------|--------|----------|
| Max RPM | 150 | 150 |
| Success Rate | >99% | 100% |
| Avg Latency | <1s | 0.45s |
| Circuit Opens | 0 | 0 |

## Load Test Results

[Insert ab test output screenshot]

## Metrics Analysis

[Insert Prometheus metrics graph]

## Lessons Learned

1. **Rate limit compliance**: Proactive cooldown prevents errors
2. **Horizontal scaling**: Linear throughput with key count
3. **Failure isolation**: Circuit breaker prevents cascade failures

## Conclusion

Successfully demonstrated 150 RPM throughput using distributed
system design patterns on free-tier infrastructure.
```
