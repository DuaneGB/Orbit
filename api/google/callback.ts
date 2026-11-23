import { db } from "../_lib/db";
import { decryptRefreshToken, encryptRefreshToken, verifyOAuthState } from "../_lib/google";
import { readCookie } from "../_lib/http";

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
    const { data: device, error: deviceError } = await db().from("workspace_devices")
      .select("id")
      .eq("id", state.deviceId)
      .eq("workspace_id", state.workspaceId)
      .eq("role", "owner")
      .is("revoked_at", null)
      .maybeSingle();
    if (deviceError || !device) return redirect(request, "error");

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
      const { data: existing, error: existingError } = await db()
        .from("google_calendar_connections")
        .select("encrypted_refresh_token")
        .eq("workspace_id", state.workspaceId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.encrypted_refresh_token) refreshToken = decryptRefreshToken(existing.encrypted_refresh_token);
    }
    if (!refreshToken) throw new Error("Google did not provide a refresh token. Revoke Orbit access in Google and reconnect.");

    const { error: saveError } = await db().from("google_calendar_connections").upsert({
      workspace_id: state.workspaceId,
      connected_by_device_id: state.deviceId,
      encrypted_refresh_token: encryptRefreshToken(refreshToken),
      calendar_id: "primary",
    }, { onConflict: "workspace_id" });
    if (saveError) throw saveError;
    return redirect(request, "connected");
  } catch (error) {
    console.error("Google Calendar connection could not be saved.", error);
    return redirect(request, "error");
  }
}
