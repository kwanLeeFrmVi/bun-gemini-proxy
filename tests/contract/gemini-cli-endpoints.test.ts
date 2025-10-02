import { describe, test, expect } from "bun:test";

/**
 * Contract tests for Gemini CLI OpenAI-compatible endpoints
 *
 * These tests verify that the /gemini-cli/v1/* endpoints conform to OpenAI API spec
 *
 * NOTE: These tests expect the server to be running at http://localhost:8000
 * Start the server with: bun run start
 */

describe("Gemini CLI OpenAI Compatibility", () => {
  const baseUrl = "http://localhost:8000";

  describe("GET /gemini-cli/v1/models", () => {
    test("should return list of available models", async () => {
      const response = await fetch(`${baseUrl}/gemini-cli/v1/models`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty("object", "list");
      expect(body).toHaveProperty("data");
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);

      const model = body.data[0];
      expect(model).toHaveProperty("id");
      expect(model).toHaveProperty("object", "model");
      expect(model).toHaveProperty("created");
      expect(model).toHaveProperty("owned_by");
    });
  });

  describe("GET /gemini-cli/v1/health", () => {
    test("should return health status", async () => {
      const response = await fetch(`${baseUrl}/gemini-cli/v1/health`);
      expect([200, 503]).toContain(response.status);

      const body = await response.json();
      expect(body).toHaveProperty("status");
      expect(["healthy", "unhealthy"]).toContain(body.status);
    });
  });

  describe("POST /gemini-cli/v1/chat/completions", () => {
    test(
      "should handle basic chat completion",
      async () => {
        const response = await fetch(`${baseUrl}/gemini-cli/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages: [{ role: "user", content: "Say 'test' and nothing else" }],
            stream: false,
          }),
        });

        expect(response.status).toBe(200);

        const body = await response.json();
        expect(body).toHaveProperty("id");
        expect(body).toHaveProperty("object", "chat.completion");
        expect(body).toHaveProperty("created");
        expect(body).toHaveProperty("model");
        expect(body).toHaveProperty("choices");
        expect(Array.isArray(body.choices)).toBe(true);
        expect(body.choices.length).toBeGreaterThan(0);

        const choice = body.choices[0];
        expect(choice).toHaveProperty("index", 0);
        expect(choice).toHaveProperty("message");
        expect(choice.message).toHaveProperty("role", "assistant");
        expect(choice.message).toHaveProperty("content");
        expect(typeof choice.message.content).toBe("string");
        expect(choice).toHaveProperty("finish_reason");

        expect(body).toHaveProperty("usage");
        expect(body.usage).toHaveProperty("prompt_tokens");
        expect(body.usage).toHaveProperty("completion_tokens");
        expect(body.usage).toHaveProperty("total_tokens");
      },
      { timeout: 30000 },
    );

    test(
      "should handle multi-message conversation",
      async () => {
        const response = await fetch(`${baseUrl}/gemini-cli/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages: [
              { role: "system", content: "You are a helpful assistant" },
              { role: "user", content: "What is 2+2?" },
              { role: "assistant", content: "4" },
              { role: "user", content: "What about 3+3?" },
            ],
            stream: false,
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.choices[0].message.content).toBeTruthy();
      },
      { timeout: 30000 },
    );

    test("should reject streaming requests", async () => {
      const response = await fetch(`${baseUrl}/gemini-cli/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [{ role: "user", content: "Hello" }],
          stream: true,
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(body.error.message).toContain("Streaming is not supported");
    });

    test("should reject missing required fields", async () => {
      const response = await fetch(`${baseUrl}/gemini-cli/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          // Missing messages field
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
    });

    test("should reject unsupported models", async () => {
      const response = await fetch(`${baseUrl}/gemini-cli/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
          stream: false,
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toHaveProperty("error");
      expect(body.error.message).toContain("not supported");
    });

    test(
      "should handle model with models/ prefix",
      async () => {
        const response = await fetch(`${baseUrl}/gemini-cli/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "models/gemini-2.5-flash",
            messages: [{ role: "user", content: "Say OK" }],
            stream: false,
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.model).toBe("gemini-2.5-flash");
      },
      { timeout: 30000 },
    );
  });

  describe("404 handling", () => {
    test("should return 404 for unknown endpoints", async () => {
      const response = await fetch(`${baseUrl}/gemini-cli/v1/unknown`);
      expect(response.status).toBe(404);
    });
  });
});
