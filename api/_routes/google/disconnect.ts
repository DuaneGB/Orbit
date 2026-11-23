import { query, queryOne } from "../../_lib/db.js";
import { requireDevice } from "../../_lib/device.js";
import { decryptRefreshToken } from "../../_lib/google.js";
import { json, route } from "../../_lib/http.js";

/** Owner only. Revokes the Google token and forgets the event mappings; Orbit events stay. */
export const POST = route(async (request) => {
  const session = await requireDevice(request, { role: "owner" });
  const workspaceId = session.workspace.id;
  const connection = await queryOne<{ encrypted_refresh_token: string }>(
    "load the Google Calendar connection",
    "select encrypted_refresh_token from google_calendar_connections where workspace_id = $1",
    [workspaceId],
  );

  if (connection?.encrypted_refresh_token) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: decryptRefreshToken(connection.encrypted_refresh_token) }),
      });
    } catch (revokeError) {
      console.error("Could not revoke the Google token; stored credentials will still be removed.", revokeError);
    }
  }

  await query("remove Google event mappings", "delete from google_calendar_mappings where workspace_id = $1", [workspaceId]);
  await query("disconnect Google Calendar", "delete from google_calendar_connections where workspace_id = $1", [workspaceId]);
  return json({ disconnected: true });
});
