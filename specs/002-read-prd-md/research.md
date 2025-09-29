# Research Findings: Gemini Proxy Server

**Generated**: 2025-09-29
**Feature**: Gemini Proxy Server

## Technology Decisions

### Bun Runtime Selection
**Decision**: Use Bun as the TypeScript runtime for the proxy server
**Rationale**:
- Native HTTP server with `Bun.serve()` provides excellent performance for proxy use cases
- Built-in SQLite support via `bun:sqlite` eliminates external dependencies
- Native file watching capabilities for YAML configuration hot reload
- Fast startup time crucial for proxy server restarts
- TypeScript support without additional compilation steps

**Alternatives considered**:
- Node.js + Express: More mature ecosystem but slower performance and additional dependencies
- Deno: Good TypeScript support but less mature HTTP server capabilities
- Go: Excellent performance but team prefers TypeScript for maintenance

### HTTP Proxy Implementation
**Decision**: Use Bun.serve() with custom request forwarding logic
**Rationale**:
- Direct control over request/response streaming without buffering large payloads
- Easy header manipulation for API key injection and OpenAI compatibility
- Built-in support for async request handling enables high concurrency
- Simple integration with circuit breaker and health monitoring

**Alternatives considered**:
- http-proxy-middleware: Additional dependency, less control over error handling
- Custom TCP proxy: Overkill for HTTP-specific requirements

### State Persistence Strategy
**Decision**: SQLite with bun:sqlite for operational state
**Rationale**:
- Zero-configuration database perfect for single-server deployments
- ACID compliance ensures data integrity during concurrent operations
- Fast read/write performance for health scores and metrics
- Built-in backup and recovery capabilities
- No external database dependencies

**Alternatives considered**:
- JSON files: Simpler but risk of corruption under concurrent access
- Redis: Additional infrastructure overhead for simple use case
- PostgreSQL: Overkill for operational metrics storage

### Configuration Management
**Decision**: YAML files with file system watching
**Rationale**:
- Human-readable format for API key configuration
- Bun's built-in file watching enables hot reload without restart
- Easy version control and GitOps integration
- Simple validation with TypeScript interfaces

**Alternatives considered**:
- Environment variables: Less flexible for multiple keys with metadata
- JSON: Less human-readable, more error-prone editing
- TOML: Less familiar to ops teams

### Health Monitoring Algorithm
**Decision**: Simple success/failure ratio over fixed time window
**Rationale**:
- Predictable behavior for ops teams
- Easy to tune and understand
- Computationally efficient for real-time calculations
- Clear threshold-based decision making

**Alternatives considered**:
- Exponential decay: More complex, harder to tune
- Sliding window: More memory intensive
- Machine learning: Overkill for simple health metrics

### Circuit Breaker Pattern
**Decision**: Threshold-based circuit breaker with 3 consecutive failures trigger
**Rationale**:
- Fast detection of unhealthy keys minimizes failed requests
- Conservative threshold prevents false positives from transient errors
- Clear state transitions (closed → open → half-open → closed)
- Automatic recovery testing after cooldown period

**Alternatives considered**:
- Time-based windows: Less responsive to immediate failures
- Higher thresholds: More failed requests before detection
- Manual intervention: Reduces automation benefits

## Integration Patterns

### OpenAI SDK Compatibility
**Research Finding**: Gemini API uses different base URL but compatible request/response schemas
**Implementation Approach**:
- Preserve all OpenAI request paths under `/v1/*`
- Map to Gemini endpoints by replacing base URL only
- Maintain response format compatibility for SDKs
- Handle Gemini-specific error codes appropriately

### Prometheus Metrics Integration
**Research Finding**: Standard metrics libraries work well with Bun
**Implementation Approach**:
- Use `prom-client` library for standard Prometheus format
- Expose metrics endpoint on separate admin port
- Track per-key metrics: success rate, latency, error counts
- Include proxy-level metrics: active connections, queue depth

### Graceful Shutdown Pattern
**Research Finding**: Bun supports signal handling for clean shutdowns
**Implementation Approach**:
- Listen for SIGTERM/SIGINT signals
- Stop accepting new requests
- Allow in-flight requests to complete (with timeout)
- Save final state to SQLite before exit
- Close all resources cleanly

## Performance Considerations

### Latency Optimization
**Research Finding**: Bun's async I/O model suits proxy workloads
**Implementation Approach**:
- Use streaming for request/response bodies to minimize memory usage
- Implement connection pooling for upstream Gemini API
- Cache healthy key selections to reduce lookup overhead
- Minimize serialization/deserialization in hot path

### Concurrency Handling
**Research Finding**: Bun handles thousands of concurrent connections efficiently
**Implementation Approach**:
- Use async/await throughout for non-blocking operations
- Implement request queuing during key rotation
- Use atomic operations for health score updates
- Separate read/write paths for configuration access

## Security Considerations

### API Key Protection
**Research Finding**: In-memory key storage with masked logging required
**Implementation Approach**:
- Load keys into memory at startup, watch for file changes
- Never log full API keys, use first 8 characters only
- Implement secure key rotation without service interruption
- Use bearer token authentication for admin endpoints

### Request Validation
**Research Finding**: Payload size limits prevent abuse
**Implementation Approach**:
- Validate content-length headers before processing
- Implement configurable payload size limits (default 10MB)
- Rate limiting per client IP if needed
- Input sanitization for admin endpoint parameters

## Next Steps

All technical unknowns have been resolved. Ready to proceed to Phase 1 design artifacts generation.