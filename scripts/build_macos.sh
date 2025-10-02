#!/bin/bash

# Set entry point and output dir
ENTRY_POINT="./index.ts"
OUTPUT_DIR="./bin"

# Create output directory if it doesn't exist
mkdir -p "$OUTPUT_DIR"

echo "Building macOS binaries..."

# macOS x64 (modern CPU)
bun build "$ENTRY_POINT" --compile --target=bun-darwin-x64-modern --minify --outfile="$OUTPUT_DIR/bun-gemini-proxy-macos-x64"

# macOS x64 (baseline for older CPUs)
bun build "$ENTRY_POINT" --compile --target=bun-darwin-x64-baseline --minify --outfile="$OUTPUT_DIR/bun-gemini-proxy-macos-x64-baseline"

# macOS arm64 (M1/M2+)
bun build "$ENTRY_POINT" --compile --target=bun-darwin-arm64 --minify --outfile="$OUTPUT_DIR/bun-gemini-proxy-macos-arm64"

echo "macOS builds complete. Run with: ./bin/bun-gemini-proxy-macos-*"
