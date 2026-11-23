import { jsonb, query } from "../../_lib/db.js";
import { requireDevice } from "../../_lib/device.js";
import { HttpError, json, readJson, route } from "../../_lib/http.js";
import { validPushSubscription } from "../../_lib/push.js";

/** Saves this device's browser push subscription. */
export const POST = route(async (request) => {
  const session = await requireDevice(request);
  const subscription = validPushSubscription((await readJson(request)).subscription);
  if (!subscription) throw new HttpError(400, "That push subscription is not valid.");
  await query(
    "save the push subscription",
    `insert into orbit.push_subscriptions (endpoint, workspace_id, device_id, subscription)
     values ($1, $2, $3, $4::jsonb)
     on conflict (endpoint) do update
       set workspace_id = excluded.workspace_id,
           device_id = excluded.device_id,
           subscription = excluded.subscription`,
    [subscription.endpoint, session.workspace.id, session.device.id, jsonb(subscription)],
  );
  return json({ enabled: true });
});

export const DELETE = route(async (request) => {
  const session = await requireDevice(request);
  const { endpoint } = await readJson(request);
  if (typeof endpoint !== "string") throw new HttpError(400, "A push endpoint is required.");
  await query(
    "remove the push subscription",
    "delete from orbit.push_subscriptions where endpoint = $1 and device_id = $2",
    [endpoint, session.device.id],
  );
  return json({ enabled: false });
});
