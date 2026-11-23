import { check, db } from "../_lib/db";
import { clearDeviceCookie, countActiveOwners, requireDevice } from "../_lib/device";
import { HttpError, json, route } from "../_lib/http";

/** Disconnects the current device. The last owner can't leave while others remain. */
export const POST = route(async (request) => {
  const session = await requireDevice(request);
  if (session.device.role === "owner" && (await countActiveOwners(session.workspace.id)) <= 1) {
    const others = await db().from("workspace_devices")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", session.workspace.id)
      .is("revoked_at", null)
      .neq("id", session.device.id);
    if (others.error) check(others, "check connected devices");
    if ((others.count ?? 0) > 0) {
      throw new HttpError(409, "You're the only owner. Make another device an owner before removing this one.");
    }
  }
  check(
    await db().from("workspace_devices").update({ revoked_at: new Date().toISOString() }).eq("id", session.device.id),
    "remove this device",
  );
  await db().from("push_subscriptions").delete().eq("device_id", session.device.id);
  return json({ removed: true }, { headers: { "Set-Cookie": clearDeviceCookie() } });
});
