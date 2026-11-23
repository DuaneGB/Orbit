import { requireDevice } from "../_lib/device";
import { createOAuthState } from "../_lib/google";
import { HttpError, json, route } from "../_lib/http";

/**
 * Starts Google Calendar authorization. Owner only: connecting a calendar
 * shares its events with every device in the workspace.
 */
export const POST = route(async (request) => {
  const session = await requireDevice(request, { role: "owner" });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) throw new HttpError(503, "Google Calendar is not configured on the server.");

  let state: string;
  try {
    state = createOAuthState(session.workspace.id, session.device.id);
  } catch (error) {
    console.error("Could not start Google Calendar authorization.", error);
    throw new HttpError(503, "Google Calendar is not configured on the server.");
  }
  const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleUrl.searchParams.set("client_id", clientId);
  googleUrl.searchParams.set("redirect_uri", redirectUri);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "https://www.googleapis.com/auth/calendar.events");
  googleUrl.searchParams.set("access_type", "offline");
  googleUrl.searchParams.set("prompt", "consent");
  googleUrl.searchParams.set("state", state);
  return json(
    { url: googleUrl.toString() },
    { headers: { "Set-Cookie": `orbit_google_state=${state}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } },
  );
});
