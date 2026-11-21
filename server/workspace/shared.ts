import { attachDatabasePool } from "@vercel/functions";
import { Pool, type PoolClient } from "pg";
import { createHash, randomBytes } from "node:crypto";

export type DeviceContext = {
  workspaceId: string;
  workspaceName: string;
  deviceId: string;
  deviceName: string;
  role: "owner" | "member";
};

let database: Pool | undefined;

export function getDatabase(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");
  if (!database) {
    database = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 10_000,
    });
    attachDatabasePool(database);
  }
  return database;
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getDatabase().connect();
  let started = false;
  try {
    await client.query("BEGIN");
    started = true;
    const result = await work(client);
    await client.query("COMMIT");
    started = false;
    return result;
  } catch (error) {
    if (started) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Could not roll back a workspace database transaction.", rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function serverError(context: string, error: unknown): Response {
  console.error(context, error);
  if (error instanceof Error && error.message === "DATABASE_URL is not configured.") {
    return jsonError("Shared workspace storage is not configured on the server.", 503);
  }
  return jsonError("The shared workspace request could not be completed.", 500);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireMutation(request: Request): Response | null {
  if (request.headers.get("x-orbit-request") !== "1") {
    return jsonError("This request could not be verified.", 403);
  }
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return jsonError("Cross-origin requests are not allowed.", 403);
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  if (
    originUrl.host.toLowerCase() !== host.toLowerCase() ||
    (process.env.NODE_ENV === "production" && originUrl.protocol !== "https:")
  ) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  return null;
}

export async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_000_000) return jsonError("Request body is too large.", 413);
  try {
    const body: unknown = await request.json();
    return isRecord(body) ? body : jsonError("Request body must be a JSON object.", 400);
  } catch {
    return jsonError("Request body must be valid JSON.", 400);
  }
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function createInviteCode(): string {
  return randomBytes(9).toString("hex").toUpperCase();
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(cookie.slice(separator + 1).trim());
  }
  return null;
}

export function deviceCookie(secret: string | null): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const expiry = secret ? "; Max-Age=315360000" : "; Max-Age=0";
  return `orbit_device=${secret ? encodeURIComponent(secret) : ""}; Path=/; HttpOnly; SameSite=Lax${secure}${expiry}`;
}

export async function getDevice(request: Request): Promise<DeviceContext | null> {
  const secret = readCookie(request, "orbit_device");
  if (!secret || secret.length > 200) return null;
  const { rows } = await getDatabase().query(
    `WITH active_device AS (
      UPDATE workspace_devices
      SET last_seen_at = now()
      WHERE secret_hash = $1 AND revoked_at IS NULL
      RETURNING id, name, role, workspace_id
    )
    SELECT
      d.id AS "deviceId",
      d.name AS "deviceName",
      d.role,
      w.id AS "workspaceId",
      w.name AS "workspaceName"
    FROM active_device d
    JOIN workspaces w ON w.id = d.workspace_id
    LIMIT 1`,
    [hashSecret(secret)],
  );
  const device = rows[0] as DeviceContext | undefined;
  return device ?? null;
}

export function cookieResponse(data: unknown, secret: string): Response {
  return Response.json(data, {
    headers: {
      "Set-Cookie": deviceCookie(secret),
      "Cache-Control": "no-store",
    },
  });
}

export function clearCookieResponse(data: unknown): Response {
  return Response.json(data, {
    headers: {
      "Set-Cookie": deviceCookie(null),
      "Cache-Control": "no-store",
    },
  });
}

export function validDeviceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 60 ? name : null;
}

export const ENTITY_TYPES = [
  "project",
  "task",
  "note",
  "sprint",
  "meeting",
  "project_link",
  "calendar_event",
] as const;

export type WorkspaceItemInput = {
  entity_type: typeof ENTITY_TYPES[number];
  id: string;
  project_id: string | null;
  payload: Record<string, unknown>;
};

export function validateWorkspaceItem(value: unknown): WorkspaceItemInput | null {
  if (!isRecord(value) || !ENTITY_TYPES.includes(value.entity_type as typeof ENTITY_TYPES[number])) return null;
  if (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 100) return null;
  if (!isRecord(value.payload)) return null;
  const requiresProject = ["note", "sprint", "meeting", "project_link"].includes(value.entity_type as string);
  const projectId = value.project_id;
  if (
    (requiresProject && (typeof projectId !== "string" || projectId.length < 1 || projectId.length > 100)) ||
    (!requiresProject && projectId !== null && projectId !== undefined)
  ) return null;
  return {
    entity_type: value.entity_type as WorkspaceItemInput["entity_type"],
    id: value.id,
    project_id: typeof projectId === "string" ? projectId : null,
    payload: value.payload,
  };
}

export function dashboardItems(value: unknown): WorkspaceItemInput[] | null {
  if (!isRecord(value)) return null;
  const items: unknown[] = [];
  const add = (entityType: string, item: unknown, projectId: string | null = null) => {
    if (!isRecord(item) || (typeof item.id !== "string" && typeof item.id !== "number")) return false;
    items.push({ entity_type: entityType, id: String(item.id), project_id: projectId, payload: item });
    return true;
  };
  for (const project of Array.isArray(value.projects) ? value.projects : []) {
    if (!add("project", project)) return null;
  }
  for (const task of Array.isArray(value.tasks) ? value.tasks : []) {
    if (!add("task", task)) return null;
  }
  for (const event of Array.isArray(value.calendarEvents) ? value.calendarEvents : []) {
    if (!add("calendar_event", event)) return null;
  }
  const spaces = isRecord(value.projectSpaces) ? value.projectSpaces : {};
  for (const [projectId, space] of Object.entries(spaces)) {
    if (!isRecord(space)) return null;
    for (const [key, entityType] of [["notes", "note"], ["sprints", "sprint"], ["meetings", "meeting"], ["links", "project_link"]] as const) {
      const entries = space[key] === undefined ? [] : space[key];
      if (!Array.isArray(entries)) return null;
      for (const item of entries) if (!add(entityType, item, projectId)) return null;
    }
  }
  if (items.length > 1000) return null;
  const validated = items.map(validateWorkspaceItem);
  return validated.every((item) => item !== null) ? validated as WorkspaceItemInput[] : null;
}
