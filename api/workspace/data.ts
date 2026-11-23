import { check, db } from "../_lib/db";
import { requireDevice } from "../_lib/device";
import { json, route } from "../_lib/http";

/**
 * Returns every shared item plus the workspace revision.
 * Pass ?since=<revision> to get { unchanged: true } when nothing has changed,
 * which keeps frequent polling from several devices cheap.
 */
export const GET = route(async (request) => {
  const session = await requireDevice(request);
  const since = new URL(request.url).searchParams.get("since");

  const workspace = check(
    await db().from("workspaces").select("revision").eq("id", session.workspace.id).single(),
    "load the workspace",
  ) as { revision: number | string };
  const revision = Number(workspace.revision);
  if (since !== null && Number(since) === revision) return json({ revision, unchanged: true });

  const items: unknown[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const page = check(
      await db().from("workspace_items")
        .select("workspace_id,entity_type,id,project_id,payload,updated_by_device_id,updated_at")
        .eq("workspace_id", session.workspace.id)
        .order("entity_type")
        .order("id")
        .range(from, from + pageSize - 1),
      "load shared items",
    ) as unknown[];
    items.push(...page);
    if (page.length < pageSize) break;
  }
  return json({ revision, items });
});
