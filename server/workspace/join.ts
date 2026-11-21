import { randomUUID } from "node:crypto";
import {
  cookieResponse,
  createSecret,
  getDatabase,
  hashSecret,
  jsonError,
  readJson,
  requireMutation,
  serverError,
  validDeviceName,
} from "./shared.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  const rejected = requireMutation(request);
  if (rejected) return rejected;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  const deviceName = validDeviceName(body.deviceName);
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode.trim().toUpperCase() : "";
  if (!deviceName) return jsonError("Device name must be between 1 and 60 characters.", 400);
  if (!/^[0-9A-F]{18}$/.test(inviteCode)) return jsonError("Invite code is invalid or expired.", 400);

  const deviceId = randomUUID();
  const secret = createSecret();
  try {
    const { rows } = await getDatabase().query(
      `WITH consumed AS (
        UPDATE workspace_invites
        SET consumed_at = now()
        WHERE code_hash = $1
          AND consumed_at IS NULL
          AND expires_at > now()
        RETURNING workspace_id
      ),
      added_device AS (
        INSERT INTO workspace_devices (id, workspace_id, name, role, secret_hash)
        SELECT $2, workspace_id, $3, 'member', $4
        FROM consumed
        RETURNING id, workspace_id
      )
      SELECT w.id AS "workspaceId", w.name AS "workspaceName", d.id AS "deviceId"
      FROM added_device d
      JOIN workspaces w ON w.id = d.workspace_id`,
      [hashSecret(inviteCode), deviceId, deviceName, hashSecret(secret)],
    );
    const joined = rows[0] as { workspaceId: string; workspaceName: string; deviceId: string } | undefined;
    if (!joined) return jsonError("Invite code is invalid or expired.", 400);
    return cookieResponse({
      workspace: { id: joined.workspaceId, name: joined.workspaceName },
      device: { id: joined.deviceId, name: deviceName, role: "member" },
    }, secret);
  } catch (error) {
    return serverError("Could not join the shared workspace.", error);
  }
}
