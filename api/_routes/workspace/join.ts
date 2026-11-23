import { pgCode, queryOne, rawQuery } from "../../_lib/db.js";
import { deviceCookie, newDeviceToken, normalizeInviteCode, sha256 } from "../../_lib/device.js";
import { cleanText, HttpError, json, readJson, route } from "../../_lib/http.js";

/** Redeems a one-time invite code and gives this device its own access key. */
export const POST = route(async (request) => {
  const body = await readJson(request);
  const code = normalizeInviteCode(body.inviteCode);
  const deviceName = cleanText(body.deviceName, "Device name", 60);
  const { token, hash } = newDeviceToken();

  let joined: { workspace_id: string; device_id: string } | undefined;
  try {
    [joined] = await rawQuery<{ workspace_id: string; device_id: string }>(
      "select workspace_id, device_id from orbit.redeem_workspace_invite($1, $2, $3)",
      [sha256(code), deviceName, hash],
    );
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (pgCode(error) === "P0001") throw new HttpError(400, "That invite code is invalid, used, or expired. Ask for a new one.");
    console.error("Could not redeem invite.", error);
    throw new HttpError(500, "Could not join the workspace.");
  }
  if (!joined) throw new HttpError(500, "Could not join the workspace.");

  const workspace = await queryOne<{ id: string; name: string }>(
    "load the workspace",
    "select id, name from orbit.workspaces where id = $1",
    [joined.workspace_id],
  );
  if (!workspace) throw new HttpError(500, "Could not load the workspace.");

  return json(
    { workspace, device: { id: joined.device_id, name: deviceName, role: "member" } },
    { status: 201, headers: { "Set-Cookie": deviceCookie(token) } },
  );
});
