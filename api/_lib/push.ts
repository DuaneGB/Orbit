import * as webPush from "web-push";
import { db } from "./db";

const PUSH_WINDOW_SECONDS = 120;

function isPushSubscription(value: unknown): value is webPush.PushSubscription {
  if (typeof value !== "object" || value === null) return false;
  const subscription = value as Record<string, unknown>;
  if (typeof subscription.endpoint !== "string" || typeof subscription.keys !== "object" || subscription.keys === null) return false;
  const keys = subscription.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

export function validPushSubscription(value: unknown): webPush.PushSubscription | null {
  if (!isPushSubscription(value)) return null;
  try {
    const endpoint = new URL(value.endpoint);
    if (endpoint.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return value;
}

/**
 * Tells every other device in the workspace that something changed.
 * Sends at most one notification per workspace every two minutes, so a bulk
 * edit or restore produces one alert, not one per item. Never throws.
 */
export async function notifyWorkspace(workspaceId: string, actor: { id: string; name: string }, summary: string) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return;

  try {
    const claim = await db().rpc("claim_workspace_push", {
      p_workspace_id: workspaceId,
      p_window_seconds: PUSH_WINDOW_SECONDS,
    });
    if (claim.error || claim.data !== true) return;

    const { data: rows, error } = await db()
      .from("push_subscriptions")
      .select("endpoint,device_id,subscription")
      .eq("workspace_id", workspaceId)
      .neq("device_id", actor.id);
    if (error) throw error;

    webPush.setVapidDetails(subject, publicKey, privateKey);
    const payload = JSON.stringify({ title: `${actor.name} updated Orbit`, body: summary, url: "/" });

    await Promise.all((rows ?? []).map(async (row) => {
      if (!isPushSubscription(row.subscription)) return;
      try {
        await webPush.sendNotification(row.subscription, payload, { TTL: 60 * 60 });
      } catch (sendError) {
        const status = typeof sendError === "object" && sendError !== null && "statusCode" in sendError
          ? Number((sendError as { statusCode: unknown }).statusCode)
          : 0;
        if (status === 404 || status === 410) {
          await db().from("push_subscriptions").delete().eq("endpoint", row.endpoint);
        } else {
          console.error("Push delivery failed.", sendError);
        }
      }
    }));
  } catch (error) {
    console.error("Could not send workspace notifications.", error);
  }
}
