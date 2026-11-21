type ApiOptions = Omit<RequestInit, "headers"> & { headers?: HeadersInit };

const LOCAL_WORKSPACE_KEY = "orbit-local-workspace-v1";

type LocalWorkspaceState = {
  workspace: { id: string; name: string };
  currentDevice: { id: string; name: string; role: "owner" | "member" };
  devices: Array<{ id: string; name: string; role: "owner" | "member"; createdAt: string }>;
  inviteCode: string;
  items: Array<Record<string, unknown>>;
};

function randomId(): string {
  return crypto.randomUUID();
}

function readLocalWorkspace(): LocalWorkspaceState | null {
  const raw = localStorage.getItem(LOCAL_WORKSPACE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as LocalWorkspaceState;
  } catch {
    localStorage.removeItem(LOCAL_WORKSPACE_KEY);
    return null;
  }
}

function saveLocalWorkspace(state: LocalWorkspaceState): void {
  localStorage.setItem(LOCAL_WORKSPACE_KEY, JSON.stringify(state));
}

function localWorkspaceResult<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

async function devApiRequest<T>(path: string, options: ApiOptions): Promise<T | null> {
  if (!import.meta.env.DEV || !path.startsWith("/api/workspace/")) return null;

  const method = options.method ?? "GET";
  let body: Record<string, unknown> = {};
  if (typeof options.body === "string") {
    try {
      body = JSON.parse(options.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  let state = readLocalWorkspace();

  if (path === "/api/workspace/me") {
    if (!state) throw new ApiRequestError("No workspace access is configured for this device.", 401);
    return localWorkspaceResult({
      workspace: state.workspace,
      device: state.currentDevice,
    } as T);
  }

  if (path === "/api/workspace/create" && method === "POST") {
    const now = new Date().toISOString();
    const workspaceId = randomId();
    const deviceId = randomId();
    const inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const drafts = Array.isArray(body.initialData)
      ? []
      : body.initialData && typeof body.initialData === "object"
        ? dashboardDrafts(body.initialData)
        : [];
    const items = drafts.map((item) => ({
      workspace_id: workspaceId,
      entity_type: item.entity_type,
      id: item.id,
      project_id: item.project_id,
      payload: item.payload,
      updated_by_device_id: deviceId,
      updated_at: now,
    }));
    state = {
      workspace: { id: workspaceId, name: String(body.name ?? "").trim() || "My workspace" },
      currentDevice: { id: deviceId, name: String(body.deviceName ?? "").trim() || "This device", role: "owner" },
      devices: [{ id: deviceId, name: String(body.deviceName ?? "").trim() || "This device", role: "owner", createdAt: now }],
      inviteCode,
      items,
    };
    saveLocalWorkspace(state);
    return localWorkspaceResult({
      workspace: state.workspace,
      device: state.currentDevice,
      initialInviteCode: inviteCode,
    } as T);
  }

  if (path === "/api/workspace/join" && method === "POST") {
    if (!state) throw new ApiRequestError("No local workspace is available.", 404);
    if (String(body.inviteCode ?? "").trim().toUpperCase() !== state.inviteCode) {
      throw new ApiRequestError("That invite code is invalid or has already been used.", 400);
    }
    const now = new Date().toISOString();
    const deviceId = randomId();
    const device = { id: deviceId, name: String(body.deviceName ?? "").trim() || "This device", role: "member" as const };
    state.currentDevice = device;
    state.devices.push({ ...device, createdAt: now });
    state.inviteCode = "";
    saveLocalWorkspace(state);
    return localWorkspaceResult({ workspace: state.workspace, device: state.currentDevice } as T);
  }

  if (path === "/api/workspace/data") {
    if (!state) throw new ApiRequestError("No workspace access is configured for this device.", 401);
    return localWorkspaceResult({ items: state.items } as T);
  }

  if (path === "/api/workspace/sync" && method === "POST") {
    if (!state) throw new ApiRequestError("No workspace access is configured for this device.", 401);
    const now = new Date().toISOString();
    const upserts = Array.isArray(body.upserts) ? body.upserts as Array<Record<string, unknown>> : [];
    const deletes = Array.isArray(body.deletes) ? body.deletes as Array<Record<string, unknown>> : [];
    for (const item of upserts) {
      const index = state.items.findIndex((row) =>
        row.entity_type === item.entity_type && row.id === item.id);
      const fullItem = {
        workspace_id: state.workspace.id,
        entity_type: item.entity_type,
        id: item.id,
        project_id: item.project_id ?? null,
        payload: item.payload,
        updated_by_device_id: state.currentDevice.id,
        updated_at: now,
      };
      if (index >= 0) state.items[index] = fullItem;
      else state.items.push(fullItem);
    }
    for (const item of deletes) {
      state.items = state.items.filter((row) =>
        !(row.entity_type === item.entity_type && row.id === item.id));
    }
    saveLocalWorkspace(state);
    return localWorkspaceResult({ items: state.items } as T);
  }

  if (path === "/api/workspace/devices" && method === "GET") {
    if (!state) throw new ApiRequestError("No workspace access is configured for this device.", 401);
    return localWorkspaceResult({ devices: state.devices } as T);
  }

  if (path === "/api/workspace/devices" && method === "DELETE") {
    if (!state) throw new ApiRequestError("No workspace access is configured for this device.", 401);
    const deviceId = String(body.deviceId ?? "");
    state.devices = state.devices.filter((device) => device.id !== deviceId);
    if (state.currentDevice.id === deviceId) state = null;
    if (state) saveLocalWorkspace(state);
    else localStorage.removeItem(LOCAL_WORKSPACE_KEY);
    return localWorkspaceResult({ ok: true } as T);
  }

  if (path === "/api/workspace/invites" && method === "POST") {
    if (!state) throw new ApiRequestError("No workspace access is configured for this device.", 401);
    state.inviteCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    saveLocalWorkspace(state);
    return localWorkspaceResult({ code: state.inviteCode } as T);
  }

  if (path === "/api/workspace/rename" && method === "POST") {
    if (!state) throw new ApiRequestError("No workspace access is configured for this device.", 401);
    if (state.currentDevice.role !== "owner") throw new ApiRequestError("Only the workspace owner can rename it.", 403);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 80) {
      throw new ApiRequestError("Workspace name must be between 1 and 80 characters.", 400);
    }
    state.workspace.name = name;
    saveLocalWorkspace(state);
    return localWorkspaceResult({ name } as T);
  }

  if (path === "/api/workspace/forget-device" && method === "POST") {
    localStorage.removeItem(LOCAL_WORKSPACE_KEY);
    return localWorkspaceResult({ ok: true } as T);
  }

  if (path === "/api/workspace/push") {
    return localWorkspaceResult({ ok: true } as T);
  }

  throw new ApiRequestError(`Local Orbit does not support ${method} ${path}.`, 404);
}

function dashboardDrafts(initialData: unknown): Array<{ entity_type: string; id: string; project_id: string | null; payload: unknown }> {
  const data = initialData as {
    projects?: Array<{ id: string | number }>;
    tasks?: Array<{ id: string | number }>;
    calendarEvents?: Array<{ id: string | number }>;
    projectSpaces?: Record<string, { notes?: Array<{ id: string | number }>; sprints?: Array<{ id: string | number }>; meetings?: Array<{ id: string | number }>; links?: Array<{ id: string | number }> }>;
  };
  const drafts: Array<{ entity_type: string; id: string; project_id: string | null; payload: unknown }> = [];
  for (const project of data.projects ?? []) drafts.push({ entity_type: "project", id: String(project.id), project_id: null, payload: project });
  for (const task of data.tasks ?? []) drafts.push({ entity_type: "task", id: String(task.id), project_id: null, payload: task });
  for (const event of data.calendarEvents ?? []) drafts.push({ entity_type: "calendar_event", id: String(event.id), project_id: null, payload: event });
  for (const [projectId, space] of Object.entries(data.projectSpaces ?? {})) {
    for (const note of space.notes ?? []) drafts.push({ entity_type: "note", id: String(note.id), project_id: projectId, payload: note });
    for (const sprint of space.sprints ?? []) drafts.push({ entity_type: "sprint", id: String(sprint.id), project_id: projectId, payload: sprint });
    for (const meeting of space.meetings ?? []) drafts.push({ entity_type: "meeting", id: String(meeting.id), project_id: projectId, payload: meeting });
    for (const link of space.links ?? []) drafts.push({ entity_type: "project_link", id: String(link.id), project_id: projectId, payload: link });
  }
  return drafts;
}

export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const devResult = await devApiRequest<T>(path, options);
  if (devResult !== null) return devResult;

  const headers = new Headers(options.headers);
  const method = options.method ?? "GET";
  if (method !== "GET") {
    headers.set("Content-Type", "application/json");
    headers.set("x-orbit-request", "1");
  }
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    result = null;
  }
  if (!response.ok) {
    const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
      ? result.error
      : `Orbit request failed (${response.status}).`;
    if (response.status === 401) window.dispatchEvent(new Event("orbit:device-expired"));
    throw new ApiRequestError(message, response.status);
  }
  return result as T;
}
