import type { DashboardData, EntityId, ProjectSpace } from "./project-types";
import {
  isCalendarEvent,
  isProject,
  isProjectLink,
  isProjectMeeting,
  isProjectNote,
  isProjectSprint,
  isTask,
} from "./data-validation";

export const WORKSPACE_ENTITY_TYPES = [
  "project",
  "task",
  "note",
  "sprint",
  "meeting",
  "project_link",
  "calendar_event",
] as const;

export type WorkspaceEntityType = (typeof WORKSPACE_ENTITY_TYPES)[number];

export type WorkspaceItem = {
  workspace_id: string;
  entity_type: WorkspaceEntityType;
  id: string;
  project_id: string | null;
  payload: unknown;
  updated_by_device_id: string | null;
  updated_at: string;
};

export type WorkspaceItemDraft = Pick<WorkspaceItem, "entity_type" | "id" | "project_id" | "payload">;
export type WorkspaceItemDelete = Pick<WorkspaceItem, "entity_type" | "id">;

function emptyProjectSpace(): ProjectSpace {
  return { notes: [], sprints: [], meetings: [], links: [] };
}

function toItem<T extends { id: EntityId }>(
  entityType: WorkspaceEntityType,
  item: T,
  projectId: EntityId | null = null,
): WorkspaceItemDraft {
  return {
    entity_type: entityType,
    id: String(item.id),
    project_id: projectId === null ? null : String(projectId),
    payload: item,
  };
}

export function dashboardToWorkspaceItems(data: DashboardData): WorkspaceItemDraft[] {
  const items: WorkspaceItemDraft[] = [
    ...data.projects.map((project) => toItem("project", project)),
    ...data.tasks.map((task) => toItem("task", task)),
    ...data.calendarEvents.map((event) => toItem("calendar_event", event)),
  ];
  for (const project of data.projects) {
    const space = data.projectSpaces[String(project.id)] ?? emptyProjectSpace();
    items.push(
      ...space.notes.map((note) => toItem("note", note, project.id)),
      ...space.sprints.map((sprint) => toItem("sprint", sprint, project.id)),
      ...space.meetings.map((meeting) => toItem("meeting", meeting, project.id)),
      ...(space.links ?? []).map((link) => toItem("project_link", link, project.id)),
    );
  }
  return items;
}

function emptyDashboardData(): DashboardData {
  return { projects: [], tasks: [], projectSpaces: {}, calendarEvents: [] };
}

/** Checks the shape and payload of one item, whether a client sent it or the server stored it. */
export function isWorkspaceItemDraft(value: unknown): value is WorkspaceItemDraft {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || (item.project_id !== null && typeof item.project_id !== "string")) {
    return false;
  }
  if (typeof item.payload !== "object" || item.payload === null) return false;
  if (String((item.payload as { id?: unknown }).id) !== item.id) return false;
  switch (item.entity_type) {
    case "project": return item.project_id === null && isProject(item.payload);
    case "task": return item.project_id === null && isTask(item.payload);
    case "calendar_event": return item.project_id === null && isCalendarEvent(item.payload);
    case "note": return item.project_id !== null && isProjectNote(item.payload);
    case "sprint": return item.project_id !== null && isProjectSprint(item.payload);
    case "meeting": return item.project_id !== null && isProjectMeeting(item.payload);
    case "project_link": return item.project_id !== null && isProjectLink(item.payload);
    default: return false;
  }
}

export function isWorkspaceItem(value: unknown): value is WorkspaceItem {
  if (!isWorkspaceItemDraft(value)) return false;
  const item = value as unknown as Record<string, unknown>;
  return (
    typeof item.workspace_id === "string" &&
    typeof item.updated_at === "string" &&
    (item.updated_by_device_id === null || typeof item.updated_by_device_id === "string")
  );
}

export function workspaceItemsToDashboard(items: WorkspaceItemDraft[]): DashboardData {
  const data = emptyDashboardData();
  for (const item of items) {
    if (item.entity_type === "project") {
      if (!isProject(item.payload)) throw new Error(`Invalid project record ${item.id}.`);
      data.projects.push(item.payload);
      data.projectSpaces[String(item.payload.id)] ??= emptyProjectSpace();
    } else if (item.entity_type === "task") {
      if (!isTask(item.payload)) throw new Error(`Invalid task record ${item.id}.`);
      data.tasks.push(item.payload);
    } else if (item.entity_type === "calendar_event") {
      if (!isCalendarEvent(item.payload)) throw new Error(`Invalid calendar event record ${item.id}.`);
      data.calendarEvents.push(item.payload);
    } else {
      if (item.project_id === null) throw new Error(`Missing project for ${item.entity_type} record ${item.id}.`);
      const space = data.projectSpaces[item.project_id] ?? emptyProjectSpace();
      if (item.entity_type === "note" && isProjectNote(item.payload)) space.notes.push(item.payload);
      else if (item.entity_type === "sprint" && isProjectSprint(item.payload)) space.sprints.push(item.payload);
      else if (item.entity_type === "meeting" && isProjectMeeting(item.payload)) space.meetings.push(item.payload);
      else if (item.entity_type === "project_link" && isProjectLink(item.payload)) space.links.push(item.payload);
      else throw new Error(`Invalid ${item.entity_type} record ${item.id}.`);
      data.projectSpaces[item.project_id] = space;
    }
  }
  data.calendarEvents.sort((a, b) => a.date.localeCompare(b.date));
  return data;
}

export function workspaceItemKey(item: Pick<WorkspaceItemDraft, "entity_type" | "id">): string {
  return `${item.entity_type}:${item.id}`;
}

function sameItem(left: WorkspaceItemDraft | undefined, right: WorkspaceItemDraft | undefined): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined &&
      left.project_id === right.project_id &&
      JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

export function diffWorkspaceItems(
  previous: WorkspaceItemDraft[],
  current: WorkspaceItemDraft[],
): { upserts: WorkspaceItemDraft[]; deletes: WorkspaceItemDelete[] } {
  const previousByKey = new Map(previous.map((item) => [workspaceItemKey(item), item]));
  const currentByKey = new Map(current.map((item) => [workspaceItemKey(item), item]));
  return {
    upserts: current.filter((item) => !sameItem(previousByKey.get(workspaceItemKey(item)), item)),
    deletes: previous
      .filter((item) => !currentByKey.has(workspaceItemKey(item)))
      .map(({ entity_type, id }) => ({ entity_type, id })),
  };
}

/**
 * Three-way merge per item: keep local edits that haven't synced yet and take
 * remote edits for everything else. If both sides changed the same item, the
 * local edit wins and goes out on the next save (last writer wins per item).
 */
export function mergeRemoteDashboard(
  current: DashboardData,
  baseline: WorkspaceItemDraft[],
  incoming: WorkspaceItemDraft[],
): DashboardData {
  const currentByKey = new Map(dashboardToWorkspaceItems(current).map((item) => [workspaceItemKey(item), item]));
  const baselineByKey = new Map(baseline.map((item) => [workspaceItemKey(item), item]));
  const incomingByKey = new Map(incoming.map((item) => [workspaceItemKey(item), item]));
  const merged = new Map<string, WorkspaceItemDraft>();
  const keys = new Set([...currentByKey.keys(), ...baselineByKey.keys(), ...incomingByKey.keys()]);

  for (const key of keys) {
    const localItem = currentByKey.get(key);
    const previousItem = baselineByKey.get(key);
    const remoteItem = incomingByKey.get(key);
    const localChanged = !sameItem(previousItem, localItem);
    const remoteChanged = !sameItem(previousItem, remoteItem);
    const selected = remoteChanged && !localChanged ? remoteItem : localItem;
    if (selected) merged.set(key, selected);
  }
  return workspaceItemsToDashboard([...merged.values()]);
}
