import { query, queryOne, rawQuery } from "../../_lib/db.js";
import { clearDeviceCookie, countActiveOwners, requireDevice } from "../../_lib/device.js";
import { HttpError, json, route } from "../../_lib/http.js";

/** Disconnects the current device. The last owner can't leave while others remain. */
export const POST = route(async (request) => {
  const session = await requireDevice(request);
  if (session.device.role === "owner" && (await countActiveOwners(session.workspace.id)) <= 1) {
    const others = await queryOne<{ count: string }>(
      "check connected devices",
      "select count(*) as count from orbit.workspace_devices where workspace_id = $1 and revoked_at is null and id <> $2",
      [session.workspace.id, session.device.id],
    );
    if (Number(others?.count ?? 0) > 0) {
      throw new HttpError(409, "You're the only owner. Make another device an owner before removing this one.");
    }
  }
  await query("remove this device", "update orbit.workspace_devices set revoked_at = now() where id = $1", [session.device.id]);
  try {
    await rawQuery("delete from orbit.push_subscriptions where device_id = $1", [session.device.id]);
  } catch (error) {
    console.error("Could not remove this device's push subscriptions.", error);
  }
  return json({ removed: true }, { headers: { "Set-Cookie": clearDeviceCookie() } });
});
