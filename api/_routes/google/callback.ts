import { rawQuery } from "../../_lib/db.js";
import { decryptRefreshToken, encryptRefreshToken, verifyOAuthState } from "../../_lib/google.js";
import { readCookie } from "../../_lib/http.js";

type GoogleTokenResponse = {
  refresh_token?: string;
  access_token?: string;
  error?: string;
};

function redirect(request: Request, outcome: "connected" | "error"): Response {
  const destination = new URL("/", request.url);
  destination.searchParams.set("google", outcome);
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.toString(),
      "Set-Cookie": "orbit_google_state=; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const stateParam = url.searchParams.get("state") ?? "";
  const cookieState = readCookie(request, "orbit_google_state");
  if (!stateParam || stateParam !== cookieState) return redirect(request, "error");

  let state;
  try {
    state = verifyOAuthState(stateParam);
  } catch (error) {
    console.error("Google OAuth state validation is not configured.", error);
    return redirect(request, "error");
  }
  if (!state) return redirect(request, "error");
  const code = url.searchParams.get("code");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!code || !clientId || !clientSecret || !redirectUri) return redirect(request, "error");

  try {
    // The device that started the flow must still be an active owner.
    const [device] = await rawQuery(
      "select id from orbit.workspace_devices where id = $1 and workspace_id = $2 and role = 'owner' and revoked_at is null",
      [state.deviceId, state.workspaceId],
    );
    if (!device) return redirect(request, "error");

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenResponse.json() as GoogleTokenResponse;
    if (!tokenResponse.ok) {
      console.error("Google token exchange failed.", tokens.error ?? tokenResponse.status);
      return redirect(request, "error");
    }

    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const [existing] = await rawQuery<{ encrypted_refresh_token: string }>(
        "select encrypted_refresh_token from orbit.google_calendar_connections where workspace_id = $1",
        [state.workspaceId],
      );
      if (existing?.encrypted_refresh_token) refreshToken = decryptRefreshToken(existing.encrypted_refresh_token);
    }
    if (!refreshToken) throw new Error("Google did not provide a refresh token. Revoke Orbit access in Google and reconnect.");

    await rawQuery(
      `insert into orbit.google_calendar_connections (workspace_id, connected_by_device_id, encrypted_refresh_token, calendar_id)
       values ($1, $2, $3, 'primary')
       on conflict (workspace_id) do update
         set connected_by_device_id = excluded.connected_by_device_id,
             encrypted_refresh_token = excluded.encrypted_refresh_token,
             calendar_id = excluded.calendar_id,
             connected_at = now()`,
      [state.workspaceId, state.deviceId, encryptRefreshToken(refreshToken)],
    );
    return redirect(request, "connected");
  } catch (error) {
    console.error("Google Calendar connection could not be saved.", error);
    return redirect(request, "error");
  }
}
