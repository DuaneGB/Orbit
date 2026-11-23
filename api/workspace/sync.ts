import { db } from "../_lib/db";
import { requireDevice } from "../_lib/device";
import { HttpError, json, readJson, route } from "../_lib/http";
import { parseSyncBatch, summarizeChanges } from "../_lib/items";
import { notifyWorkspace } from "../_lib/push";

/** Applies one device's changes in a single transaction and returns the new revision. */
export const POST = route(async (request) => {
  const session = await requireDevice(request);
  const { upserts, deletes } = parseSyncBatch(await readJson(request));
  if (upserts.length === 0 && deletes.length === 0) return json({ revision: null });

  const { data, error } = await db().rpc("apply_workspace_sync", {
    p_workspace_id: session.workspace.id,
    p_device_id: session.device.id,
    p_upserts: upserts,
    p_deletes: deletes,
  });
  if (error) {
    if (error.code === "P0001") throw new HttpError(401, "This device's access has ended.");
    console.error("Could not apply workspace sync.", error);
    throw new HttpError(500, "Shared changes could not be saved.");
  }

  await notifyWorkspace(session.workspace.id, session.device, summarizeChanges(upserts, deletes));
  return json({ revision: Number(data) });
});
