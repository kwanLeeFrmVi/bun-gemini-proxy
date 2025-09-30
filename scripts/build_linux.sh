#!/bin/bash

# Set entry point and output dir
ENTRY_POINT="./index.ts"
OUTPUT_DIR="./bin"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

echo "Building Linux binaries..."

# Linux x64 glibc (modern CPU)
bun build "$ENTRY_POINT" --compile --target=bun-linux-x64-modern --minify --outfile="$OUTPUT_DIR/bun-gemini-proxy-linux-x64-glibc"

# Linux x64 glibc (baseline for older CPUs)
bun build "$ENTRY_POINT" --compile --target=bun-linux-x64-baseline --minify --outfile="$OUTPUT_DIR/bun-gemini-proxy-linux-x64-glibc-baseline"

# Linux x64 musl (static, for Alpine/etc.)
bun build "$ENTRY_POINT" --compile --target=bun-linux-x64-musl --minify --outfile="$OUTPUT_DIR/bun-gemini-proxy-linux-x64-musl"

# Linux arm64 glibc (modern)
bun build "$ENTRY_POINT" --compile --target=bun-linux-arm64 --minify --outfile="$OUTPUT_DIR/bun-gemini-proxy-linux-arm64-glibc"

# Linux arm64 musl
bun build "$ENTRY_POINT" --compile --target=bun-linux-arm64-musl --minify --outfile="$OUTPUT_DIR/bun-gemini-proxy-linux-arm64-musl"

echo "Linux builds complete. Run with: ./bin/bun-gemini-proxy-linux-* (ensure executable: chmod +x ./bin/bun-gemini-proxy-linux-*)"
