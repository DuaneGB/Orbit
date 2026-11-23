type ApiOptions = Omit<RequestInit, "headers"> & { headers?: HeadersInit };

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const method = options.method ?? "GET";
  if (method !== "GET") {
    headers.set("Content-Type", "application/json");
    headers.set("x-orbit-request", "1");
  }
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok) {
    const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
      ? result.error
      : `Orbit request failed (${response.status}).`;
    if (response.status === 401) window.dispatchEvent(new Event("orbit:device-expired"));
    throw new ApiRequestError(message, response.status);
  }
  return result as T;
}
