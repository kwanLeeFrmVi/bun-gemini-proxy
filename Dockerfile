# Alpine-based minimal Dockerfile (even smaller)
# Uses musl binary for Alpine Linux
FROM docker.io/oven/bun:1 AS builder
WORKDIR /build

# Copy source files
COPY package.json ./
COPY src ./src
COPY index.ts ./

# Install dependencies and build musl binary for Alpine
RUN bun install && \
    bun build ./index.ts --compile --target=bun-linux-x64-musl --minify --outfile=bun-gemini-proxy

# Stage 2: Alpine minimal runtime
FROM docker.io/alpine:3.19
WORKDIR /app

# Install minimal runtime dependencies
RUN apk add --no-cache ca-certificates curl libgcc libstdc++

# Copy the standalone binary from builder
COPY --from=builder /build/bun-gemini-proxy /app/bun-gemini-proxy
RUN chmod +x /app/bun-gemini-proxy

# Copy example config files
COPY proxy.example.yaml keys.example.yaml ./

# Create directories
RUN mkdir -p /app/.runtime /app/config

# Create non-root user
RUN adduser -D -u 1000 -s /bin/false appuser && \
    chown -R appuser:appuser /app

# Expose default port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Run as non-root
USER appuser

# Run binary
ENTRYPOINT ["/app/bun-gemini-proxy"]
