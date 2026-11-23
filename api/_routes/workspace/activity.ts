import { query } from "../../_lib/db.js";
import { requireDevice } from "../../_lib/device.js";
import { json, route } from "../../_lib/http.js";

type ActivityRow = {
  id: string;
  entity_type: string;
  label: string | null;
  action: string;
  created_at: string;
  device_id: string | null;
  device_name: string | null;
};

/** The 40 most recent changes, newest first, with the device that made each one. */
export const GET = route(async (request) => {
  const session = await requireDevice(request);
  const rows = await query<ActivityRow>(
    "load recent activity",
    `select a.id, a.entity_type, a.label, a.action, a.created_at, a.device_id, d.name as device_name
       from orbit.activity_events a left join orbit.workspace_devices d on d.id = a.device_id
      where a.workspace_id = $1
      order by a.id desc
      limit 40`,
    [session.workspace.id],
  );
  return json({
    events: rows.map((row) => ({
      id: Number(row.id),
      entityType: row.entity_type,
      label: row.label,
      action: row.action,
      createdAt: row.created_at,
      deviceName: row.device_name ?? (row.device_id ? "A removed device" : "Orbit"),
      mine: row.device_id === session.device.id,
    })),
  });
});
