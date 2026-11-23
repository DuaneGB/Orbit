import { check, db } from "../_lib/db";
import { requireDevice } from "../_lib/device";
import { decryptRefreshToken } from "../_lib/google";
import { json, route } from "../_lib/http";

/** Owner only. Revokes the Google token and forgets the event mappings; Orbit events stay. */
export const POST = route(async (request) => {
  const session = await requireDevice(request, { role: "owner" });
  const workspaceId = session.workspace.id;
  const connection = check(
    await db().from("google_calendar_connections")
      .select("encrypted_refresh_token")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    "load the Google Calendar connection",
  ) as { encrypted_refresh_token: string } | null;

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

  check(await db().from("google_calendar_mappings").delete().eq("workspace_id", workspaceId), "remove Google event mappings");
  check(await db().from("google_calendar_connections").delete().eq("workspace_id", workspaceId), "disconnect Google Calendar");
  return json({ disconnected: true });
});
