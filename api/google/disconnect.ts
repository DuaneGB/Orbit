import { requireWorkspaceUser, decryptRefreshToken } from "./shared";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405 });
  let workspaceId: string;
  try {
    const body = await request.json() as { workspaceId?: unknown };
    if (typeof body.workspaceId !== "string") return Response.json({ error: "A workspace is required." }, { status: 400 });
    workspaceId = body.workspaceId;
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const authorization = await requireWorkspaceUser(request, workspaceId);
  if (authorization instanceof Response) return authorization;
  const { data: connection, error: loadError } = await authorization.admin
    .from("google_calendar_connections")
    .select("encrypted_refresh_token")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (loadError) {
    console.error("Could not load Google Calendar connection for disconnect.", loadError);
    return Response.json({ error: "Could not disconnect Google Calendar." }, { status: 500 });
  }

  if (connection?.encrypted_refresh_token) {
    try {
      const refreshToken = decryptRefreshToken(connection.encrypted_refresh_token);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }),
      });
    } catch (revokeError) {
      console.error("Could not revoke the Google token; stored credentials will still be removed.", revokeError);
    }
  }

  const { error: mappingError } = await authorization.admin
    .from("google_calendar_mappings")
    .delete()
    .eq("workspace_id", workspaceId);
  if (mappingError) {
    console.error("Could not remove Google Calendar event mappings.", mappingError);
    return Response.json({ error: "Could not remove Google Calendar event mappings." }, { status: 500 });
  }
  const { error: deleteError } = await authorization.admin
    .from("google_calendar_connections")
    .delete()
    .eq("workspace_id", workspaceId);
  if (deleteError) {
    console.error("Could not remove Google Calendar credentials.", deleteError);
    return Response.json({ error: "Could not disconnect Google Calendar." }, { status: 500 });
  }
  return Response.json({ disconnected: true });
}
