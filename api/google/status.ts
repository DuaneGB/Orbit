import { requireWorkspaceUser } from "./shared";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed." }, { status: 405 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const authorization = await requireWorkspaceUser(request, workspaceId);
  if (authorization instanceof Response) return authorization;

  const { data: connection, error } = await authorization.admin
    .from("google_calendar_connections")
    .select("connected_at,last_synced_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) {
    console.error("Could not check Google Calendar status.", error);
    return Response.json({ error: "Could not check Google Calendar status." }, { status: 500 });
  }
  return Response.json({
    connected: Boolean(connection),
    connectedAt: connection?.connected_at ?? null,
    lastSyncedAt: connection?.last_synced_at ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
