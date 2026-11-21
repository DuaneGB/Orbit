import { randomUUID } from "node:crypto";
import {
  cookieResponse,
  createInviteCode,
  createSecret,
  dashboardItems,
  hashSecret,
  jsonError,
  readJson,
  requireMutation,
  serverError,
  validDeviceName,
  withTransaction,
} from "./shared.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  const rejected = requireMutation(request);
  if (rejected) return rejected;
  const body = await readJson(request);
  if (body instanceof Response) return body;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const deviceName = validDeviceName(body.deviceName);
  const items = dashboardItems(body.initialData);
  if (name.length < 1 || name.length > 80) return jsonError("Workspace name must be between 1 and 80 characters.", 400);
  if (!deviceName) return jsonError("Device name must be between 1 and 60 characters.", 400);
  if (!items) return jsonError("The starting Orbit data is invalid.", 400);

  const workspaceId = randomUUID();
  const deviceId = randomUUID();
  const secret = createSecret();
  const inviteCode = createInviteCode();

  try {
    await withTransaction(async (client) => {
      await client.query("INSERT INTO workspaces (id, name) VALUES ($1, $2)", [workspaceId, name]);
      await client.query(
        `INSERT INTO workspace_devices (id, workspace_id, name, role, secret_hash)
         VALUES ($1, $2, $3, 'owner', $4)`,
        [deviceId, workspaceId, deviceName, hashSecret(secret)],
      );
      await client.query(
        `INSERT INTO workspace_items
            (workspace_id, entity_type, id, project_id, payload, updated_by_device_id)
         SELECT $1, item.entity_type, item.id, item.project_id, item.payload, $2
         FROM jsonb_to_recordset($3::jsonb) AS item(
           entity_type text, id text, project_id text, payload jsonb
         )`,
        [workspaceId, deviceId, JSON.stringify(items)],
      );
      await client.query(
        `INSERT INTO workspace_invites (workspace_id, created_by_device_id, code_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '24 hours')`,
        [workspaceId, deviceId, hashSecret(inviteCode)],
      );
    });
    return cookieResponse({
      workspace: { id: workspaceId, name },
      device: { id: deviceId, name: deviceName, role: "owner" },
      initialInviteCode: inviteCode,
    }, secret);
  } catch (error) {
    return serverError("Could not create a shared workspace.", error);
  }
}
