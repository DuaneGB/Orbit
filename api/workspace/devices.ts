import { check, db } from "../_lib/db";
import { countActiveOwners, requireDevice } from "../_lib/device";
import { HttpError, json, readJson, route } from "../_lib/http";

type DeviceRow = { id: string; name: string; role: "owner" | "member"; created_at: string; last_seen_at: string };

/** Everyone in the workspace can see which devices are connected. */
export const GET = route(async (request) => {
  const session = await requireDevice(request);
  const rows = check(
    await db().from("workspace_devices")
      .select("id,name,role,created_at,last_seen_at")
      .eq("workspace_id", session.workspace.id)
      .is("revoked_at", null)
      .order("created_at"),
    "load devices",
  ) as DeviceRow[];
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

  const revoked = check(
    await db().from("workspace_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", deviceId)
      .eq("workspace_id", session.workspace.id)
      .is("revoked_at", null)
      .select("id"),
    "revoke the device",
  ) as { id: string }[];
  if (revoked.length === 0) throw new HttpError(404, "That device is not connected to this workspace.");
  await db().from("push_subscriptions").delete().eq("device_id", deviceId);
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
  const updated = check(
    await db().from("workspace_devices")
      .update({ role: body.role })
      .eq("id", deviceId)
      .eq("workspace_id", session.workspace.id)
      .is("revoked_at", null)
      .select("id"),
    "change the device's role",
  ) as { id: string }[];
  if (updated.length === 0) throw new HttpError(404, "That device is not connected to this workspace.");
  return json({ updated: true });
});
