import { queryOne } from "../../_lib/db.js";
import { requireDevice } from "../../_lib/device.js";
import { json, route } from "../../_lib/http.js";

export const GET = route(async (request) => {
  const session = await requireDevice(request);
  const connection = await queryOne<{ connected_at: string; last_synced_at: string | null }>(
    "check Google Calendar status",
    "select connected_at, last_synced_at from google_calendar_connections where workspace_id = $1",
    [session.workspace.id],
  );
  return json({
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REDIRECT_URI),
    connected: Boolean(connection),
    connectedAt: connection?.connected_at ?? null,
    lastSyncedAt: connection?.last_synced_at ?? null,
  });
});
