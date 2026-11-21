import {
  createInviteCode,
  getDatabase,
  getDevice,
  hashSecret,
  jsonError,
  requireMutation,
  serverError,
} from "./shared.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  const rejected = requireMutation(request);
  if (rejected) return rejected;
  try {
    const current = await getDevice(request);
    if (!current) return jsonError("This device is not connected to a workspace.", 401);
    if (current.role !== "owner") return jsonError("Only the workspace owner can create invite codes.", 403);

    const code = createInviteCode();
    await getDatabase().query(
      `INSERT INTO workspace_invites (workspace_id, created_by_device_id, code_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '24 hours')`,
      [current.workspaceId, current.deviceId, hashSecret(code)],
    );
    return Response.json({ code }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError("Could not create an invite code.", error);
  }
}
