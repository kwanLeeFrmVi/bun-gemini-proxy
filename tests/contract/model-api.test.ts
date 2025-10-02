import { describe, expect, it } from "bun:test";

const BASE_URL = "http://localhost:4806";
const REQUEST_TIMEOUT_MS = 2000;

function withTimeout(init?: RequestInit): RequestInit {
  return {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
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

function expectModelDetailResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const model = body as Record<string, unknown>;
  expect(typeof model.id).toBe("string");
  expect(model.object).toBe("model");
  expect(typeof model.created).toBe("number");
  expect(typeof model.owned_by).toBe("string");
}

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

  it("returns model details in OpenAI-compatible schema", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/models/gemini-1.5-pro`,
      withTimeout({
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expectModelDetailResponse(body);
  });

  it("returns 404 for a nonexistent model", async () => {
    const response = await fetch(
      `${BASE_URL}/v1/models/nonexistent-model`,
      withTimeout({
        method: "GET",
      }),
    );

    expect(response.status).toBe(404);
  });
});
