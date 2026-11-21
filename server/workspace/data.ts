import { getDatabase, getDevice, jsonError, serverError } from "./shared.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return jsonError("Method not allowed.", 405);
  try {
    const device = await getDevice(request);
    if (!device) return jsonError("This device is not connected to a workspace.", 401);
    const { rows: items } = await getDatabase().query(
      `SELECT
        workspace_id,
        entity_type,
        id,
        project_id,
        payload,
        updated_by_device_id,
        updated_at
      FROM workspace_items
      WHERE workspace_id = $1
      ORDER BY entity_type, id`,
      [device.workspaceId],
    );
    return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError("Could not load shared workspace data.", error);
  }
}
