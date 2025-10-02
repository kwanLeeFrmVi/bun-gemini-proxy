import { describe, it, expect } from "bun:test";

const BASE_URL = "http://localhost:4806";
const CONCURRENT_REQUESTS = 25;
const TOTAL_REQUESTS = 250;
const REQUEST_TIMEOUT_MS = 15000;

describe("Proxy API performance: /v1/chat/completions", () => {
  it(
    `should handle ${TOTAL_REQUESTS} requests with ${CONCURRENT_REQUESTS} concurrent workers`,
    async () => {
      const requests: Promise<void>[] = [];
      let completed = 0;
      let successful = 0;
      let failed = 0;
      const latencies: number[] = [];

      const body = JSON.stringify({
        model: "gemini-pro",
        messages: [{ role: "user", content: "What is the capital of France?" }],
      });

      const headers = { "Content-Type": "application/json" };

      const makeRequest = async () => {
        const start = Date.now();
        try {
          const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
            method: "POST",
            headers,
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          if (response.ok) {
            successful++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        } finally {
          completed++;
          latencies.push(Date.now() - start);
        }
      };

      console.log(`\nStarting load test with ${TOTAL_REQUESTS} requests...`);

      const workers = Array(CONCURRENT_REQUESTS)
        .fill(0)
        .map(async () => {
          while (requests.length < TOTAL_REQUESTS) {
            requests.push(makeRequest());
            await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay between requests
          }
        });

      await Promise.all(workers);

      // Wait for all requests to complete
      while (completed < TOTAL_REQUESTS) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)] ?? 0;
      const successRate = (successful / TOTAL_REQUESTS) * 100;

      console.log(`\nLoad Test Results:`);
      console.log(`  - Total Requests: ${TOTAL_REQUESTS}`);
      console.log(`  - Concurrent Requests: ${CONCURRENT_REQUESTS}`);
      console.log(`  - Successful: ${successful}`);
      console.log(`  - Failed: ${failed}`);
      console.log(`  - Success Rate: ${successRate.toFixed(2)}%`);
      console.log(`  - Average Latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`  - 95th Percentile Latency: ${p95Latency.toFixed(2)}ms`);

      expect(successRate).toBeGreaterThan(95);
      expect(p95Latency).toBeLessThan(5000);
    },
    { timeout: 30000 },
  );
});
