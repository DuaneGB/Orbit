import {
  clearCookieResponse,
  getDatabase,
  getDevice,
  jsonError,
  requireMutation,
  serverError,
} from "./shared.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  const rejected = requireMutation(request);
  if (rejected) return rejected;
  try {
    const device = await getDevice(request);
    if (!device) return clearCookieResponse({ ok: true });
    await getDatabase().query(
      `UPDATE workspace_devices
       SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [device.deviceId],
    );
    return clearCookieResponse({ ok: true });
  } catch (error) {
    return serverError("Could not remove this device from the workspace.", error);
  }
}
