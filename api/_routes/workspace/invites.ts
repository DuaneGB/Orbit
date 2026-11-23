import { queryOne } from "../../_lib/db.js";
import { createInvite, requireDevice } from "../../_lib/device.js";
import { HttpError, json, route } from "../../_lib/http.js";

const MAX_OPEN_INVITES = 10;

/** Owners create one-time codes that expire after 24 hours. */
export const POST = route(async (request) => {
  const session = await requireDevice(request, { role: "owner" });

  const open = await queryOne<{ count: string }>(
    "check open invites",
    "select count(*) as count from workspace_invites where workspace_id = $1 and expires_at > now() and used_count < max_uses",
    [session.workspace.id],
  );
  if (Number(open?.count ?? 0) >= MAX_OPEN_INVITES) {
    throw new HttpError(429, `This workspace already has ${MAX_OPEN_INVITES} unused invite codes. Use or let some expire first.`);
  }

  const invite = await createInvite(session.workspace.id, session.device.id);
  return json(invite, { status: 201 });
});
