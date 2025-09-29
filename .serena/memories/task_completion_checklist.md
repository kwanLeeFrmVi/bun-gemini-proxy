# Task Completion Checklist

## When a Task is Completed

### 1. Code Quality Checks

```bash
# Type checking - ensure no TypeScript errors
bun run tsc --noEmit

# Format check (if prettier is installed)
# bun run prettier --check .
```

### 2. Testing

```bash
# Run all tests
bun test

# Ensure new code has tests
# - Unit tests for business logic
# - Integration tests for API endpoints
# - Mock tests for external dependencies
```

### 3. Manual Testing

```bash
# Start the server
bun --hot index.ts

# Test basic functionality
curl http://localhost:4806/health

# Test the proxy endpoint (once implemented)
curl -X POST http://localhost:4806/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

### 4. Documentation Updates

- Update README.md if functionality changed
- Add JSDoc comments to new public APIs
- Update API documentation if endpoints changed
- Document any new environment variables
- Update configuration examples

### 5. Dependency Audit

```bash
# Check for dependency updates
bun update --dry-run

# Review bun.lock changes
git diff bun.lock
```

### 6. Git Commit

```bash
# Stage changes
git add .

# Check what's being committed
git status
git diff --cached

# Commit with descriptive message
git commit -m "feat: implement feature X"
# Use conventional commits:
# - feat: new feature
# - fix: bug fix
# - docs: documentation
# - style: formatting
# - refactor: code restructuring
# - test: adding tests
# - chore: maintenance
```

### 7. Performance Verification

- Check that proxy overhead is < 100ms
- Verify memory usage is stable
- Ensure no memory leaks in long-running processes
- Test with concurrent requests

### 8. Configuration & State

- Verify SQLite migrations work correctly
- Test configuration hot-reload
- Ensure graceful shutdown preserves state
- Check error recovery mechanisms

### 9. Security Review

- No API keys in code or logs
- Secrets properly masked in debug output
- Input validation in place
- Rate limiting functional

### 10. Final Checks Before Push

```bash
# Ensure working directory is clean
git status

# Run the full test suite one more time
bun test

# Start server and verify it runs
bun run index.ts

# Push to repository
git push origin <branch-name>
```

## Continuous Monitoring (Production)

- Check health endpoint regularly
- Monitor metrics endpoint
- Review logs for errors
- Verify key rotation is working
- Check circuit breaker behavior

## Notes

- Always test with both healthy and failing API keys
- Verify behavior under rate limits (429 responses)
- Test graceful degradation when all keys fail
- Ensure persistence works across restarts
