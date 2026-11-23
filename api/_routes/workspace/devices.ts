import { query, rawQuery } from "../../_lib/db.js";
import { countActiveOwners, requireDevice } from "../../_lib/device.js";
import { HttpError, json, readJson, route } from "../../_lib/http.js";

type DeviceRow = { id: string; name: string; role: "owner" | "member"; created_at: string; last_seen_at: string };

/** Everyone in the workspace can see which devices are connected. */
export const GET = route(async (request) => {
  const session = await requireDevice(request);
  const rows = await query<DeviceRow>(
    "load devices",
    `select id, name, role, created_at, last_seen_at from workspace_devices
      where workspace_id = $1 and revoked_at is null
      order by created_at`,
    [session.workspace.id],
  );
  return json({
    devices: rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    })),
  });
});

function deviceIdFrom(body: Record<string, unknown>): string {
  if (typeof body.deviceId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.deviceId)) {
    throw new HttpError(400, "Choose a device.");
  }
  return body.deviceId;
}

/** Owners revoke another device's access immediately. */
export const DELETE = route(async (request) => {
  const session = await requireDevice(request, { role: "owner" });
  const deviceId = deviceIdFrom(await readJson(request));
  if (deviceId === session.device.id) throw new HttpError(400, "Use “Remove this device” to disconnect yourself.");

  const revoked = await query(
    "revoke the device",
    `update workspace_devices set revoked_at = now()
      where id = $1 and workspace_id = $2 and revoked_at is null
      returning id`,
    [deviceId, session.workspace.id],
  );
  if (revoked.length === 0) throw new HttpError(404, "That device is not connected to this workspace.");
  try {
    await rawQuery("delete from push_subscriptions where device_id = $1", [deviceId]);
  } catch (error) {
    console.error("Could not remove the revoked device's push subscriptions.", error);
  }
  return json({ revoked: true });
});

/** Owners promote or demote devices. A workspace always keeps at least one owner. */
export const PATCH = route(async (request) => {
  const session = await requireDevice(request, { role: "owner" });
  const body = await readJson(request);
  const deviceId = deviceIdFrom(body);
  if (body.role !== "owner" && body.role !== "member") throw new HttpError(400, "Choose owner or member.");
  if (body.role === "member" && deviceId === session.device.id && (await countActiveOwners(session.workspace.id)) <= 1) {
    throw new HttpError(409, "Make another device an owner before stepping down.");
  }
  const updated = await query(
    "change the device's role",
    `update workspace_devices set role = $1
      where id = $2 and workspace_id = $3 and revoked_at is null
      returning id`,
    [body.role, deviceId, session.workspace.id],
  );
  if (updated.length === 0) throw new HttpError(404, "That device is not connected to this workspace.");
  return json({ updated: true });
});
