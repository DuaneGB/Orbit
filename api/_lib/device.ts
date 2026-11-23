import { createHash, randomBytes, randomInt } from "node:crypto";
import { query, queryOne, rawQuery } from "./db.js";
import { HttpError, readCookie } from "./http.js";

export const DEVICE_COOKIE = "orbit_device";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // browsers cap cookies at 400 days

export type DeviceRole = "owner" | "member";

export type DeviceSession = {
  workspace: { id: string; name: string };
  device: { id: string; name: string; role: DeviceRole };
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newDeviceToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256(token) };
}

// Crockford-style alphabet: no 0/O or 1/I/L, so codes read cleanly aloud.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** 12 characters ≈ 59 bits, shown as XXXX-XXXX-XXXX. */
export function newInviteCode(): string {
  let code = "";
  for (let index = 0; index < 12; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code.match(/.{4}/g)!.join("-");
}

export function normalizeInviteCode(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "Enter an invite code.");
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 12) throw new HttpError(400, "Invite codes have 12 letters and numbers.");
  return code.match(/.{4}/g)!.join("-");
}

export function deviceCookie(token: string): string {
  return `${DEVICE_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}

export function clearDeviceCookie(): string {
  return `${DEVICE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

type DeviceRow = {
  id: string;
  name: string;
  role: DeviceRole;
  workspace_id: string;
  workspace_name: string;
  last_seen_at: string;
};

/** Resolves the device cookie to an active device, or throws 401. */
export async function requireDevice(request: Request, options: { role?: DeviceRole } = {}): Promise<DeviceSession> {
  const token = readCookie(request, DEVICE_COOKIE);
  if (!token || token.length > 100) throw new HttpError(401, "This device is not connected to a workspace.");

  const row = await queryOne<DeviceRow>(
    "check this device's access",
    `select d.id, d.name, d.role, d.workspace_id, w.name as workspace_name, d.last_seen_at
       from workspace_devices d join workspaces w on w.id = d.workspace_id
      where d.token_hash = $1 and d.revoked_at is null`,
    [sha256(token)],
  );
  if (!row) throw new HttpError(401, "This device's access has ended. Join again with a new invite code.");
  if (options.role === "owner" && row.role !== "owner") {
    throw new HttpError(403, "Only a workspace owner can do that.");
  }

  // Record activity at most every five minutes to keep writes low.
  if (Date.now() - Date.parse(row.last_seen_at) > 5 * 60 * 1000) {
    try {
      await rawQuery("update workspace_devices set last_seen_at = now() where id = $1", [row.id]);
    } catch (error) {
      console.error("Could not record device activity.", error);
    }
  }

  return {
    workspace: { id: row.workspace_id, name: row.workspace_name },
    device: { id: row.id, name: row.name, role: row.role },
  };
}

export async function countActiveOwners(workspaceId: string): Promise<number> {
  const row = await queryOne<{ count: string }>(
    "check workspace owners",
    "select count(*) as count from workspace_devices where workspace_id = $1 and role = 'owner' and revoked_at is null",
    [workspaceId],
  );
  return Number(row?.count ?? 0);
}

export async function createInvite(workspaceId: string, deviceId: string): Promise<{ code: string; expiresAt: string }> {
  const code = newInviteCode();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await query(
    "create an invite code",
    `insert into workspace_invites (workspace_id, created_by_device_id, code_hash, expires_at, max_uses)
     values ($1, $2, $3, $4, 1)`,
    [workspaceId, deviceId, sha256(code), expiresAt],
  );
  return { code, expiresAt };
}
