import { timingSafeEqual } from "node:crypto";
import { isDashboardData, normalizeDashboardData } from "../../../src/data-validation.js";
import { dashboardToWorkspaceItems } from "../../../src/data-sync.js";
import { jsonb, queryOne, rawQuery } from "../../_lib/db.js";
import { createInvite, deviceCookie, newDeviceToken } from "../../_lib/device.js";
import { cleanText, HttpError, json, readJson, route } from "../../_lib/http.js";
import { MAX_ITEMS_PER_SYNC } from "../../_lib/items.js";

function setupKeyMatches(received: unknown, expected: string): boolean {
  if (typeof received !== "string") return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Creates a workspace with this device as its first owner.
 * If ORBIT_SETUP_KEY is set, creating a workspace requires it, so strangers
 * who find the URL cannot fill the database with workspaces.
 */
export const POST = route(async (request) => {
  const body = await readJson(request);
  const setupKey = process.env.ORBIT_SETUP_KEY;
  if (setupKey && !setupKeyMatches(body.setupKey, setupKey)) {
    throw new HttpError(403, "Enter this Orbit's setup key to create a workspace.");
  }
  const name = cleanText(body.name, "Workspace name", 80);
  const deviceName = cleanText(body.deviceName, "Device name", 60);

  // Workspace and its first owner device are created in one statement, so a
  // failure can't leave an ownerless workspace behind.
  const { token, hash } = newDeviceToken();
  const created = await queryOne<{ workspace_id: string; workspace_name: string; id: string; name: string; role: "owner" }>(
    "create the workspace",
    `with w as (insert into workspaces (name) values ($1) returning id, name),
          d as (insert into workspace_devices (workspace_id, name, role, token_hash)
                select id, $2, 'owner', $3 from w returning id, name, role)
     select w.id as workspace_id, w.name as workspace_name, d.id, d.name, d.role from w, d`,
    [name, deviceName, hash],
  );
  if (!created) throw new HttpError(500, "Could not create the workspace.");
  const workspace = { id: created.workspace_id, name: created.workspace_name };
  const device = { id: created.id, name: created.name, role: created.role };

  // Bring this browser's existing projects into the new workspace, if it has any.
  if (body.initialData !== undefined && isDashboardData(body.initialData)) {
    const items = dashboardToWorkspaceItems(normalizeDashboardData(body.initialData)).slice(0, MAX_ITEMS_PER_SYNC);
    if (items.length > 0) {
      try {
        await rawQuery("select apply_workspace_sync($1, $2, $3::jsonb, '[]'::jsonb)", [workspace.id, device.id, jsonb(items)]);
      } catch (error) {
        console.error("Could not import this browser's data into the new workspace.", error);
      }
    }
  }

  const invite = await createInvite(workspace.id, device.id);
  return json(
    { workspace, device, initialInviteCode: invite.code },
    { status: 201, headers: { "Set-Cookie": deviceCookie(token) } },
  );
});
