import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import * as webPush from "web-push";

type ActivityWebhook = {
  type?: string;
  table?: string;
  record?: {
    workspace_id?: string;
    actor_id?: string | null;
    action?: string;
  };
};

function isPushSubscription(value: unknown): value is webPush.PushSubscription {
  if (typeof value !== "object" || value === null) return false;
  const subscription = value as Record<string, unknown>;
  if (typeof subscription.endpoint !== "string" || typeof subscription.keys !== "object" || subscription.keys === null) return false;
  const keys = subscription.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && typeof keys.auth === "string";
}

function secretMatches(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  const webhookSecret = process.env.PUSH_WEBHOOK_SECRET;
  if (!webhookSecret) return Response.json({ error: "Push webhook is not configured." }, { status: 503 });
  if (!secretMatches(request.headers.get("x-orbit-webhook-secret") ?? "", webhookSecret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return Response.json({ error: "Push delivery is not configured." }, { status: 503 });
  }

  let webhook: ActivityWebhook;
  try {
    webhook = await request.json() as ActivityWebhook;
  } catch {
    return Response.json({ error: "Webhook payload must be valid JSON." }, { status: 400 });
  }
  const activity = webhook.record;
  if (webhook.type !== "INSERT" || webhook.table !== "activity_events" || !activity?.workspace_id) {
    return Response.json({ delivered: 0 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: rows, error: queryError } = await admin
    .from("push_subscriptions")
    .select("endpoint,user_id,subscription")
    .eq("workspace_id", activity.workspace_id);
  if (queryError) {
    console.error("Could not load push subscriptions.", queryError);
    return Response.json({ error: "Could not load push subscriptions." }, { status: 500 });
  }

  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const payload = JSON.stringify({
    title: "Orbit workspace update",
    body: `A teammate ${activity.action ?? "updated"} the shared workspace.`,
    url: "/",
  });
  let delivered = 0;
  const failures: string[] = [];

  await Promise.all((rows ?? []).filter((row) => row.user_id !== activity.actor_id).map(async (row) => {
    if (!isPushSubscription(row.subscription)) {
      failures.push(`Invalid subscription for ${row.endpoint}.`);
      return;
    }
    try {
      await webPush.sendNotification(row.subscription, payload);
      delivered += 1;
    } catch (sendError) {
      const statusCode = typeof sendError === "object" && sendError !== null && "statusCode" in sendError
        ? Number(sendError.statusCode)
        : 0;
      if (statusCode === 404 || statusCode === 410) {
        const { error: deleteError } = await admin.from("push_subscriptions").delete().eq("endpoint", row.endpoint);
        if (deleteError) failures.push(`Could not remove expired subscription ${row.endpoint}.`);
      } else {
        console.error("Push delivery failed.", sendError);
        failures.push(`Push delivery failed for ${row.endpoint}.`);
      }
    }
  }));

  if (failures.length > 0) {
    console.error("Some Orbit push notifications failed.", failures);
    return Response.json({ delivered, failures: failures.length }, { status: 502 });
  }
  return Response.json({ delivered });
}
