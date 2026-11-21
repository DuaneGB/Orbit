import {
  getDatabase,
  getDevice,
  jsonError,
  readJson,
  requireMutation,
  serverError,
} from "./shared.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  const rejected = requireMutation(request);
  if (rejected) return rejected;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 80) {
    return jsonError("Workspace name must be between 1 and 80 characters.", 400);
  }

  try {
    const device = await getDevice(request);
    if (!device) return jsonError("This device is not connected to a workspace.", 401);
    if (device.role !== "owner") return jsonError("Only the workspace owner can rename it.", 403);
    const { rows } = await getDatabase().query(
      `UPDATE workspaces
       SET name = $1
       WHERE id = $2
       RETURNING name`,
      [name, device.workspaceId],
    );
    if (rows.length === 0) return jsonError("The workspace could not be found.", 404);
    return Response.json({ name }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError("Could not rename the workspace.", error);
  }
}
