import { query, queryOne } from "../../_lib/db.js";
import { requireDevice } from "../../_lib/device.js";
import { json, route } from "../../_lib/http.js";

/**
 * Returns every shared item plus the workspace revision.
 * Pass ?since=<revision> to get { unchanged: true } when nothing has changed,
 * which keeps frequent polling from several devices cheap.
 */
export const GET = route(async (request) => {
  const session = await requireDevice(request);
  const since = new URL(request.url).searchParams.get("since");

  const workspace = await queryOne<{ revision: string }>(
    "load the workspace",
    "select revision from workspaces where id = $1",
    [session.workspace.id],
  );
  const revision = Number(workspace?.revision ?? 0);
  if (since !== null && Number(since) === revision) return json({ revision, unchanged: true });

  const items = await query(
    "load shared items",
    `select workspace_id, entity_type, id, project_id, payload, updated_by_device_id, updated_at
       from workspace_items
      where workspace_id = $1
      order by entity_type, id`,
    [session.workspace.id],
  );
  return json({ revision, items });
});
