import { describe, expect, it } from "bun:test";

const BASE_URL = "http://localhost:4806";
const ADMIN_TOKEN = process.env.PROXY_ADMIN_TOKEN ?? "test-admin-token";
const REQUEST_TIMEOUT_MS = 2000;

function withTimeout(init?: RequestInit): RequestInit {
  return {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

function withAdminAuth(init?: RequestInit, token: string = ADMIN_TOKEN): RequestInit {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);

  return withTimeout({
    ...init,
    headers,
  });
}

function expectErrorResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const payload = body as Record<string, unknown>;
  const error = payload.error as Record<string, unknown> | undefined;

  expect(error, "error body").toBeDefined();
  expect(typeof error?.message).toBe("string");
  expect(typeof error?.type).toBe("string");
  if (error?.code !== undefined) {
    expect(typeof error.code).toBe("string");
  }
}

function expectHealthStatusResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const payload = body as Record<string, unknown>;
  expect(typeof payload.status).toBe("string");
  expect(["healthy", "degraded", "unhealthy"]).toContain(payload.status as string);
  expect(typeof payload.timestamp).toBe("string");
  expect(typeof payload.uptime).toBe("number");

  const keys = payload.keys as Record<string, unknown> | undefined;
  expect(keys, "keys summary").toBeDefined();
  if (!keys) {
    return;
  }

  expect(typeof keys.total).toBe("number");
  expect(typeof keys.healthy).toBe("number");
  expect(typeof keys.unhealthy).toBe("number");
  expect(typeof keys.disabled).toBe("number");
}

function expectKeyStatus(entry: unknown) {
  expect(entry).toBeDefined();
  expect(typeof entry).toBe("object");

  const key = entry as Record<string, unknown>;
  expect(typeof key.id).toBe("string");
  expect(typeof key.name).toBe("string");
  expect(typeof key.status).toBe("string");
  expect(["active", "disabled", "circuit_open", "circuit_half_open"]).toContain(
    key.status as string,
  );
  expect(typeof key.health_score).toBe("number");
  expect(key.health_score as number).toBeGreaterThanOrEqual(0);
  expect(key.health_score as number).toBeLessThanOrEqual(1);
  if (key.last_used !== null) {
    expect(typeof key.last_used).toBe("string");
  }
  if (key.failure_count !== undefined) {
    expect(typeof key.failure_count).toBe("number");
  }
  if (key.next_retry !== undefined && key.next_retry !== null) {
    expect(typeof key.next_retry).toBe("string");
  }
}

function expectKeysStatusResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const payload = body as Record<string, unknown>;
  const keys = payload.keys as unknown[] | undefined;
  expect(Array.isArray(keys)).toBe(true);

  keys?.forEach(expectKeyStatus);
}

function expectKeyOperationResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const payload = body as Record<string, unknown>;
  expect(typeof payload.success).toBe("boolean");
  expect(typeof payload.message).toBe("string");
  expect(typeof payload.key_id).toBe("string");
}

function expectConfigReloadResponse(body: unknown) {
  expect(body).toBeDefined();
  expect(typeof body).toBe("object");

  const payload = body as Record<string, unknown>;
  expect(typeof payload.success).toBe("boolean");
  expect(typeof payload.timestamp).toBe("string");

  const changes = payload.changes as Record<string, unknown> | undefined;
  expect(changes, "changes object").toBeDefined();
  if (!changes) {
    return;
  }

  if (changes.keys_added !== undefined) {
    expect(typeof changes.keys_added).toBe("number");
  }
  if (changes.keys_removed !== undefined) {
    expect(typeof changes.keys_removed).toBe("number");
  }
  if (changes.keys_updated !== undefined) {
    expect(typeof changes.keys_updated).toBe("number");
  }
}

describe("Admin API contract: /admin/health", () => {
  it("requires bearer authentication", async () => {
    const response = await fetch(`${BASE_URL}/admin/health`, withTimeout());

    expect(response.status).toBe(401);
    expectErrorResponse(await response.json());
  });

  it("returns system health summary", async () => {
    const response = await fetch(
      `${BASE_URL}/admin/health`,
      withAdminAuth({
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    expectHealthStatusResponse(await response.json());
  });
});

describe("Admin API contract: /admin/keys", () => {
  it("requires bearer authentication", async () => {
    const response = await fetch(`${BASE_URL}/admin/keys`, withTimeout());

    expect(response.status).toBe(401);
    expectErrorResponse(await response.json());
  });

  it("lists API key diagnostics", async () => {
    const response = await fetch(
      `${BASE_URL}/admin/keys`,
      withAdminAuth({
        method: "GET",
      }),
    );

    expect(response.status).toBe(200);
    expectKeysStatusResponse(await response.json());
  });
});

describe("Admin API contract: /admin/keys/{keyId}/enable", () => {
  it("requires bearer authentication", async () => {
    const response = await fetch(
      `${BASE_URL}/admin/keys/test-key/enable`,
      withTimeout({ method: "POST" }),
    );

    expect(response.status).toBe(401);
    expectErrorResponse(await response.json());
  });

  it("enables keys and returns operation result", async () => {
    const response = await fetch(
      `${BASE_URL}/admin/keys/test-key/enable`,
      withAdminAuth({ method: "POST" }),
    );

    const status = response.status;
    expect([200, 404]).toContain(status);

    const body = await response.json();
    if (status === 200) {
      expectKeyOperationResponse(body);
    } else {
      expectErrorResponse(body);
    }
  });
});

describe("Admin API contract: /admin/keys/{keyId}/disable", () => {
  it("requires bearer authentication", async () => {
    const response = await fetch(
      `${BASE_URL}/admin/keys/test-key/disable`,
      withTimeout({ method: "POST" }),
    );

    expect(response.status).toBe(401);
    expectErrorResponse(await response.json());
  });

  it("disables keys and returns operation result", async () => {
    const response = await fetch(
      `${BASE_URL}/admin/keys/test-key/disable`,
      withAdminAuth({ method: "POST" }),
    );

    const status = response.status;
    expect([200, 404]).toContain(status);

    const body = await response.json();
    if (status === 200) {
      expectKeyOperationResponse(body);
    } else {
      expectErrorResponse(body);
    }
  });
});

describe("Admin API contract: /admin/metrics", () => {
  it("requires bearer authentication", async () => {
    const response = await fetch(`${BASE_URL}/admin/metrics`, withTimeout());

    expect(response.status).toBe(401);
    const body = await response.json();
    expectErrorResponse(body);
  });

  it("returns Prometheus metrics payload", async () => {
    const response = await fetch(`${BASE_URL}/admin/metrics`, withAdminAuth({ method: "GET" }));

    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type");
    expect(contentType).toBeTruthy();
    expect(contentType?.includes("text/plain")).toBe(true);

    const text = await response.text();
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("Admin API contract: /admin/config/reload", () => {
  it("requires bearer authentication", async () => {
    const response = await fetch(
      `${BASE_URL}/admin/config/reload`,
      withTimeout({ method: "POST" }),
    );

    expect(response.status).toBe(401);
    expectErrorResponse(await response.json());
  });

  it("reloads configuration or reports validation errors", async () => {
    const response = await fetch(
      `${BASE_URL}/admin/config/reload`,
      withAdminAuth({ method: "POST" }),
    );

    const status = response.status;
    expect([200, 400]).toContain(status);

    const body = await response.json();
    if (status === 200) {
      expectConfigReloadResponse(body);
    } else {
      expectErrorResponse(body);
    }
  });
});
