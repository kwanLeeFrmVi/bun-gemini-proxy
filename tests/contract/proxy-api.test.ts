import { describe, expect, it } from "bun:test";

const BASE_URL = "http://localhost:4806";
const REQUEST_TIMEOUT_MS = 2000;

function withTimeout(init?: RequestInit): RequestInit {
  return {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

function expectChatCompletionResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const response = body as Record<string, unknown>;

  expect(response.id, "response.id").toBeDefined();
  expect(typeof response.id).toBe("string");

  expect(response.object).toBe("chat.completion");
  expect(typeof response.created).toBe("number");
  expect(typeof response.model).toBe("string");

  const choices = response.choices as unknown;
  expect(Array.isArray(choices)).toBe(true);
  expect((choices as unknown[]).length).toBeGreaterThan(0);

  const firstChoice = (choices as unknown[])[0] as Record<string, unknown>;
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

function expectErrorResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const payload = body as Record<string, unknown>;
  const error = payload.error as Record<string, unknown>;
  expect(error).toBeDefined();
  expect(typeof error.message).toBe("string");
  expect(typeof error.type).toBe("string");
  if (error.code !== undefined) {
    expect(typeof error.code).toBe("string");
  }
  if (error.param !== undefined) {
    expect(typeof error.param).toBe("string");
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

describe("Proxy API contract: /v1/chat/completions", () => {
  it("returns OpenAI-compatible chat completion payload", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-pro",
          messages: [
            {
              role: "user",
              content: "Hello, how are you?",
            },
          ],
          max_tokens: 32,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expectChatCompletionResponse(body);
  });

  it("rejects invalid payloads with OpenAI error schema", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/chat/completions`,
      withTimeout({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          // Missing required model field to trigger validation error
          messages: [
            {
              role: "user",
              content: "This should fail",
            },
          ],
        }),
      }),
    );

    expect([400, 422]).toContain(response.status);
    const body = await response.json();
    expectErrorResponse(body);
  });
});

describe("Proxy API contract: /v1/models", () => {
  it("returns list of models in OpenAI-compatible schema", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/models`,
      withTimeout({
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expectModelListResponse(body);
  });
});
