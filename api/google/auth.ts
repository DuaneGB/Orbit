import { createOAuthState, requireWorkspaceUser } from "./shared";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  let workspaceId: string;
  try {
    const body = await request.json() as { workspaceId?: unknown };
    if (typeof body.workspaceId !== "string") {
      return Response.json({ error: "A workspace is required." }, { status: 400 });
    }
    workspaceId = body.workspaceId;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const authorization = await requireWorkspaceUser(request, workspaceId);
  if (authorization instanceof Response) return authorization;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return Response.json({ error: "Google Calendar OAuth is not configured on the server." }, { status: 503 });
  }

  try {
    const state = createOAuthState(workspaceId, authorization.user.id);
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.searchParams.set("client_id", clientId);
    googleUrl.searchParams.set("redirect_uri", redirectUri);
    googleUrl.searchParams.set("response_type", "code");
    googleUrl.searchParams.set("scope", "openid email profile https://www.googleapis.com/auth/calendar.events");
    googleUrl.searchParams.set("access_type", "offline");
    googleUrl.searchParams.set("prompt", "consent");
    googleUrl.searchParams.set("state", state);
    return Response.json(
      { url: googleUrl.toString() },
      {
        headers: {
          "Set-Cookie": `orbit_google_state=${state}; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Could not start Google Calendar authorization.", error);
    return Response.json({ error: "Could not start Google Calendar authorization." }, { status: 503 });
  }
}
