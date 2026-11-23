import { check, db } from "../../_lib/db.js";
import { createInvite, requireDevice } from "../../_lib/device.js";
import { HttpError, json, route } from "../../_lib/http.js";

const MAX_OPEN_INVITES = 10;

/** Owners create one-time codes that expire after 24 hours. */
export const POST = route(async (request) => {
  const session = await requireDevice(request, { role: "owner" });

  const open = await db()
    .from("workspace_invites")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", session.workspace.id)
    .gt("expires_at", new Date().toISOString())
    .lt("used_count", 1);
  if (open.error) check(open, "check open invites");
  if ((open.count ?? 0) >= MAX_OPEN_INVITES) {
    throw new HttpError(429, `This workspace already has ${MAX_OPEN_INVITES} unused invite codes. Use or let some expire first.`);
  }

  const invite = await createInvite(session.workspace.id, session.device.id);
  return json(invite, { status: 201 });
});
