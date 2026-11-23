import { check, db } from "../_lib/db";
import { requireDevice } from "../_lib/device";
import { json, route } from "../_lib/http";

type ActivityRow = {
  id: number;
  entity_type: string;
  entity_id: string | null;
  label: string | null;
  action: string;
  created_at: string;
  device_id: string | null;
  workspace_devices: { name: string } | null;
};

/** The 40 most recent changes, newest first, with the device that made each one. */
export const GET = route(async (request) => {
  const session = await requireDevice(request);
  const rows = check(
    await db().from("activity_events")
      .select("id,entity_type,entity_id,label,action,created_at,device_id,workspace_devices(name)")
      .eq("workspace_id", session.workspace.id)
      .order("id", { ascending: false })
      .limit(40),
    "load recent activity",
  ) as unknown as ActivityRow[];
  return json({
    events: rows.map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      label: row.label,
      action: row.action,
      createdAt: row.created_at,
      deviceName: row.workspace_devices?.name ?? (row.device_id ? "A removed device" : "Orbit"),
      mine: row.device_id === session.device.id,
    })),
  });
});
