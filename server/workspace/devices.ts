import {
  getDatabase,
  getDevice,
  jsonError,
  readJson,
  requireMutation,
  serverError,
} from "./shared.js";

type DeviceRow = {
  id: string;
  name: string;
  role: "owner" | "member";
  createdAt: string;
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "DELETE") return jsonError("Method not allowed.", 405);
  if (request.method === "DELETE") {
    const rejected = requireMutation(request);
    if (rejected) return rejected;
  }

  try {
    const current = await getDevice(request);
    if (!current) return jsonError("This device is not connected to a workspace.", 401);
    if (current.role !== "owner") return jsonError("Only the workspace owner can manage devices.", 403);

    if (request.method === "GET") {
      const { rows } = await getDatabase().query(
        `SELECT id, name, role, created_at AS "createdAt"
        FROM workspace_devices
        WHERE workspace_id = $1 AND revoked_at IS NULL
        ORDER BY created_at`,
        [current.workspaceId],
      );
      return Response.json({ devices: rows as DeviceRow[] }, { headers: { "Cache-Control": "no-store" } });
    }

    const body = await readJson(request);
    if (body instanceof Response) return body;
    const deviceId = body.deviceId;
    if (typeof deviceId !== "string" || !/^[0-9a-f-]{36}$/i.test(deviceId)) {
      return jsonError("A valid device is required.", 400);
    }
    if (deviceId === current.deviceId) return jsonError("Use Remove this device to disconnect the current device.", 400);
    const { rows } = await getDatabase().query(
      `UPDATE workspace_devices
       SET revoked_at = now()
       WHERE id = $1
         AND workspace_id = $2
         AND revoked_at IS NULL
       RETURNING id`,
      [deviceId, current.workspaceId],
    );
    if (rows.length === 0) return jsonError("That active device could not be found.", 404);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError("Could not manage workspace devices.", error);
  }
}
