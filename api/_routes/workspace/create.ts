import { timingSafeEqual } from "node:crypto";
import { isDashboardData, normalizeDashboardData } from "../../../src/data-validation.js";
import { dashboardToWorkspaceItems } from "../../../src/data-sync.js";
import { check, db } from "../../_lib/db.js";
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

  const workspace = check(
    await db().from("workspaces").insert({ name }).select("id,name").single(),
    "create the workspace",
  ) as { id: string; name: string };

  const { token, hash } = newDeviceToken();
  const device = check(
    await db().from("workspace_devices")
      .insert({ workspace_id: workspace.id, name: deviceName, role: "owner", token_hash: hash })
      .select("id,name,role")
      .single(),
    "register this device",
  ) as { id: string; name: string; role: "owner" };

  // Bring this browser's existing projects into the new workspace, if it has any.
  if (body.initialData !== undefined && isDashboardData(body.initialData)) {
    const items = dashboardToWorkspaceItems(normalizeDashboardData(body.initialData)).slice(0, MAX_ITEMS_PER_SYNC);
    if (items.length > 0) {
      const { error } = await db().rpc("apply_workspace_sync", {
        p_workspace_id: workspace.id,
        p_device_id: device.id,
        p_upserts: items,
        p_deletes: [],
      });
      if (error) console.error("Could not import this browser's data into the new workspace.", error);
    }
  }

  const invite = await createInvite(workspace.id, device.id);
  return json(
    { workspace, device, initialInviteCode: invite.code },
    { status: 201, headers: { "Set-Cookie": deviceCookie(token) } },
  );
});
