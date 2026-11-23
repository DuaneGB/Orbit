export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

/** Wraps a route so thrown HttpErrors become JSON responses and anything else becomes a 500. */
export function route(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") requireSameOriginWrite(request);
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
      console.error("Unhandled Orbit API error.", error);
      return json({ error: "Something went wrong on the server." }, { status: 500 });
    }
  };
}

/**
 * Writes must carry the custom header the Orbit client sets. Browsers will not
 * send a custom header cross-site without a CORS preflight, which this API never
 * approves, so this blocks cross-site request forgery against the device cookie.
 */
function requireSameOriginWrite(request: Request) {
  if (request.headers.get("x-orbit-request") !== "1") {
    throw new HttpError(403, "This request must come from the Orbit app.");
  }
}

const MAX_BODY_BYTES = 2_000_000;

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new HttpError(413, "That request is too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "That request is too large.");
  try {
    const value = JSON.parse(text || "{}") as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as T;
  } catch {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
}

export function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new HttpError(400, `${field} is required.`);
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < 1 || text.length > max) {
    throw new HttpError(400, `${field} must be between 1 and ${max} characters.`);
  }
  return text;
}

export function readCookie(request: Request, name: string): string {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}
