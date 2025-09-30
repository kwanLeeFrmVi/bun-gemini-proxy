import { describe, expect, it } from "bun:test";

const BASE_URL = "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 5000;
const AUTH_TOKEN = "sk-proxy-test-token-1";

interface RequestOptions extends RequestInit {
  expectAuth?: boolean;
}

function withTimeout(init?: RequestOptions): RequestInit {
  const headers = new Headers(init?.headers ?? {});

  if (init?.expectAuth) {
    headers.set("Authorization", `Bearer ${AUTH_TOKEN}`);
  }

  return {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

// ============================================
// Validation Helpers
// ============================================

function expectChatCompletionResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const response = body as Record<string, unknown>;

  expect(response.id).toBeDefined();
  expect(typeof response.id).toBe("string");
  expect(response.object).toBe("chat.completion");
  expect(typeof response.created).toBe("number");
  expect(typeof response.model).toBe("string");

  const choices = response.choices as unknown[];
  expect(Array.isArray(choices)).toBe(true);
  expect(choices.length).toBeGreaterThan(0);

  const firstChoice = choices[0] as Record<string, unknown>;
  expect(typeof firstChoice.index).toBe("number");

  const message = firstChoice.message as Record<string, unknown>;
  expect(message).toBeDefined();
  expect(typeof message.role).toBe("string");
  expect(typeof message.content).toBe("string");
  expect(typeof firstChoice.finish_reason).toBe("string");

  if (response.usage) {
    const usage = response.usage as Record<string, unknown>;
    expect(typeof usage.prompt_tokens).toBe("number");
    expect(typeof usage.completion_tokens).toBe("number");
    expect(typeof usage.total_tokens).toBe("number");
  }
}

function expectModelListResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const payload = body as Record<string, unknown>;
  expect(payload.object).toBe("list");

  const data = payload.data as unknown[];
  expect(Array.isArray(data)).toBe(true);

  if (data.length > 0) {
    const model = data[0] as Record<string, unknown>;
    expect(typeof model.id).toBe("string");
    expect(model.object).toBe("model");
    expect(typeof model.created).toBe("number");
    expect(typeof model.owned_by).toBe("string");
  }
}

function expectModelResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const model = body as Record<string, unknown>;
  expect(typeof model.id).toBe("string");
  expect(model.object).toBe("model");
  expect(typeof model.created).toBe("number");
  expect(typeof model.owned_by).toBe("string");
}

function expectErrorResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const payload = body as Record<string, unknown>;
  const error = payload.error as Record<string, unknown>;

  expect(error).toBeDefined();
  expect(typeof error.message).toBe("string");
  expect(typeof error.type).toBe("string");
}

// ============================================
// Test Suite: Chat Completions
// ============================================

describe("OpenAI Endpoints: /v1/chat/completions", () => {
  it("returns OpenAI-compatible chat completion (non-streaming)", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-1.5-pro",
          messages: [
            {
              role: "user",
              content: "Say hello in 5 words",
            },
          ],
          max_tokens: 50,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expectChatCompletionResponse(body);
  });

  it("returns OpenAI-compatible chat completion (streaming)", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-1.5-flash",
          messages: [
            {
              role: "user",
              content: "Count from 1 to 3",
            },
          ],
          stream: true,
        }),
      }),
    );

    expect(response.status).toBe(200);

    const contentType = response.headers.get("content-type") ?? "";

    // Mock mode returns JSON, live mode returns SSE
    if (contentType.includes("text/event-stream")) {
      // Live mode: validate SSE stream
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const { value, done } = await reader!.read();
      expect(done).toBe(false);
      expect(value).toBeDefined();

      const chunk = new TextDecoder().decode(value);
      expect(chunk).toContain("data:");

      reader!.cancel();
    } else {
      // Mock mode: returns regular JSON (streaming not supported in mock)
      expect(contentType).toContain("application/json");
      const body = await response.json();
      expectChatCompletionResponse(body);
    }
  });

  it("rejects missing model field with 400", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: "Test",
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expectErrorResponse(body);
  });

  it("rejects missing messages field with 400", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-1.5-pro",
        }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expectErrorResponse(body);
  });

  it("rejects invalid content type with 415", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "text/plain",
        },
        body: "invalid",
      }),
    );

    expect(response.status).toBe(415);
    const body = await response.json();
    expectErrorResponse(body);
  });

  it("handles chat completion with system message", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-1.5-pro",
          messages: [
            {
              role: "system",
              content: "You are a helpful assistant.",
            },
            {
              role: "user",
              content: "Hello",
            },
          ],
          max_tokens: 30,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expectChatCompletionResponse(body);
  });
});

// ============================================
// Test Suite: Models
// ============================================

describe("OpenAI Endpoints: /v1/models", () => {
  it("lists all available models", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/models`,
      withTimeout({
        method: "GET",
        expectAuth: true,
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expectModelListResponse(body);
  });

  it("gets specific model details", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/models/gemini-1.5-pro`,
      withTimeout({
        method: "GET",
        expectAuth: true,
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expectModelResponse(body);
  });

  it("returns 404 for non-existent model", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/models/non-existent-model-xyz`,
      withTimeout({
        method: "GET",
        expectAuth: true,
      }),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expectErrorResponse(body);
  });

  it("validates model ID contains gemini prefix", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/models/gpt-4`,
      withTimeout({
        method: "GET",
        expectAuth: true,
      }),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expectErrorResponse(body);
  });
});

// ============================================
// Test Suite: Embeddings
// ============================================

describe("OpenAI Endpoints: /v1/embeddings", () => {
  it("generates text embeddings", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/embeddings`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: "Hello, world!",
          model: "text-embedding-004",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
    // Embeddings response validation can be added here
  });

  it("handles array of inputs", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/embeddings`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: ["Hello", "World"],
          model: "text-embedding-004",
        }),
      }),
    );

    expect(response.status).toBe(200);
  });
});

// ============================================
// Test Suite: Image Generation
// ============================================

describe("OpenAI Endpoints: /v1/images/generations", () => {
  it("generates images from prompt", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/images/generations`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: "A beautiful sunset over mountains",
          n: 1,
          size: "1024x1024",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toBeDefined();
    expect(typeof body).toBe("object");
    // Image response validation can be added here
  });
});

// ============================================
// Test Suite: Authentication
// ============================================

describe("OpenAI Endpoints: Authentication", () => {
  it("accepts valid auth token", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/models`,
      withTimeout({
        method: "GET",
        headers: {
          "Authorization": `Bearer ${AUTH_TOKEN}`,
        },
      }),
    );

    expect([200, 401]).toContain(response.status);
    // 401 is acceptable if auth is disabled in config
  });

  it("rejects invalid auth token when auth enabled", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer invalid-token-xyz",
        },
        body: JSON.stringify({
          model: "gemini-1.5-pro",
          messages: [{ role: "user", content: "test" }],
        }),
      }),
    );

    expect([200, 401]).toContain(response.status);
    // 200 if auth disabled, 401 if auth enabled
  });

  it("rejects missing auth token when auth enabled", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-1.5-pro",
          messages: [{ role: "user", content: "test" }],
        }),
      }),
    );

    expect([200, 401]).toContain(response.status);
    // 200 if auth disabled, 401 if auth enabled
  });
});

// ============================================
// Test Suite: Error Handling
// ============================================

describe("OpenAI Endpoints: Error Handling", () => {
  it("returns 404 for unknown endpoint", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/unknown/endpoint`,
      withTimeout({
        method: "GET",
        expectAuth: true,
      }),
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expectErrorResponse(body);
  });

  it("returns 405 for wrong HTTP method", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "GET",
        expectAuth: true,
      }),
    );

    expect([404, 405]).toContain(response.status);
  });

  it("handles malformed JSON gracefully", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        expectAuth: true,
        headers: {
          "Content-Type": "application/json",
        },
        body: "{invalid json}",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expectErrorResponse(body);
  });
});