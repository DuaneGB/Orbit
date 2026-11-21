import { createClient } from "@supabase/supabase-js";
import { decryptRefreshToken, encryptRefreshToken, verifyOAuthState } from "./shared";

type GoogleTokenResponse = {
  refresh_token?: string;
  access_token?: string;
  error?: string;
};

function readCookie(request: Request, name: string): string {
  const cookies = request.headers.get("cookie") ?? "";
  const entry = cookies.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

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

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
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
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!code || !clientId || !clientSecret || !redirectUri || !supabaseUrl || !serviceRoleKey) {
    return redirect(request, "error");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: membership, error: membershipError } = await admin.from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", state.workspaceId)
    .eq("user_id", state.userId)
    .maybeSingle();
  if (membershipError || !membership) return redirect(request, "error");

  try {
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
      const { data: existing, error: existingError } = await admin
        .from("google_calendar_connections")
        .select("encrypted_refresh_token")
        .eq("workspace_id", state.workspaceId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.encrypted_refresh_token) refreshToken = decryptRefreshToken(existing.encrypted_refresh_token);
    }
    if (!refreshToken) throw new Error("Google did not provide a refresh token. Revoke Orbit access in Google and reconnect.");

    const { error: saveError } = await admin.from("google_calendar_connections").upsert({
      workspace_id: state.workspaceId,
      connected_by: state.userId,
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
