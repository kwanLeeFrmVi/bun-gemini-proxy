export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers as HeadersInit);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(
  message: string,
  status: number,
  type = "proxy_error",
  extras?: Record<string, unknown>,
): Response {
  return jsonResponse(
    {
      error: {
        message,
        type,
        ...extras,
      },
    },
    { status },
  );
}
