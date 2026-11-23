import { check, db } from "../_lib/db";
import { requireDevice } from "../_lib/device";
import { HttpError, json, readJson, route } from "../_lib/http";
import { validPushSubscription } from "../_lib/push";

/** Saves this device's browser push subscription. */
export const POST = route(async (request) => {
  const session = await requireDevice(request);
  const subscription = validPushSubscription((await readJson(request)).subscription);
  if (!subscription) throw new HttpError(400, "That push subscription is not valid.");
  check(
    await db().from("push_subscriptions").upsert({
      endpoint: subscription.endpoint,
      workspace_id: session.workspace.id,
      device_id: session.device.id,
      subscription,
    }, { onConflict: "endpoint" }),
    "save the push subscription",
  );
  return json({ enabled: true });
});

export const DELETE = route(async (request) => {
  const session = await requireDevice(request);
  const { endpoint } = await readJson(request);
  if (typeof endpoint !== "string") throw new HttpError(400, "A push endpoint is required.");
  check(
    await db().from("push_subscriptions").delete().eq("endpoint", endpoint).eq("device_id", session.device.id),
    "remove the push subscription",
  );
  return json({ enabled: false });
});
