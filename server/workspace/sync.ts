import {
  getDevice,
  isRecord,
  jsonError,
  readJson,
  requireMutation,
  serverError,
  validateWorkspaceItem,
  withTransaction,
} from "./shared.js";

type DeleteInput = { entity_type: string; id: string };

function validDelete(value: unknown): DeleteInput | null {
  if (!isRecord(value) || typeof value.entity_type !== "string" || typeof value.id !== "string") return null;
  const valid = validateWorkspaceItem({
    entity_type: value.entity_type,
    id: value.id,
    project_id: ["note", "sprint", "meeting", "project_link"].includes(value.entity_type) ? "project" : null,
    payload: {},
  });
  return valid ? { entity_type: valid.entity_type, id: valid.id } : null;
}

function itemKey(item: { entity_type: string; id: string }): string {
  return `${item.entity_type}:${item.id}`;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return jsonError("Method not allowed.", 405);
  const rejected = requireMutation(request);
  if (rejected) return rejected;
  const body = await readJson(request);
  if (body instanceof Response) return body;
  if (!Array.isArray(body.upserts) || !Array.isArray(body.deletes) || body.upserts.length + body.deletes.length > 1000) {
    return jsonError("The change set is invalid or too large.", 400);
  }
  const upserts = body.upserts.map(validateWorkspaceItem);
  const deletes = body.deletes.map(validDelete);
  if (upserts.some((item) => item === null) || deletes.some((item) => item === null)) {
    return jsonError("The change set contains an invalid item.", 400);
  }
  const validUpserts = upserts as NonNullable<typeof upserts[number]>[];
  const validDeletes = deletes as DeleteInput[];
  const keys = [...validUpserts, ...validDeletes].map(itemKey);
  if (new Set(keys).size !== keys.length) return jsonError("The change set contains duplicate items.", 400);

  try {
    const device = await getDevice(request);
    if (!device) return jsonError("This device is not connected to a workspace.", 401);
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO workspace_items
          (workspace_id, entity_type, id, project_id, payload, updated_by_device_id, updated_at)
        SELECT
          $1,
          item.entity_type,
          item.id,
          item.project_id,
          item.payload,
          $2,
          now()
        FROM jsonb_to_recordset($3::jsonb) AS item(
          entity_type text, id text, project_id text, payload jsonb
        )
        ON CONFLICT (workspace_id, entity_type, id) DO UPDATE
        SET project_id = excluded.project_id,
            payload = excluded.payload,
            updated_by_device_id = excluded.updated_by_device_id,
        updated_at = excluded.updated_at`,
        [device.workspaceId, device.deviceId, JSON.stringify(validUpserts)],
      );
      await client.query(
        `DELETE FROM workspace_items AS existing
        USING jsonb_to_recordset($1::jsonb) AS item(
          entity_type text, id text
        )
        WHERE existing.workspace_id = $2
          AND existing.entity_type = item.entity_type
          AND existing.id = item.id`,
        [JSON.stringify(validDeletes), device.workspaceId],
      );
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError("Could not save shared workspace changes.", error);
  }
}
