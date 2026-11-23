import type { WorkspaceEntityType, WorkspaceItemDelete, WorkspaceItemDraft } from "../../src/data-sync";
import { isWorkspaceItemDraft, WORKSPACE_ENTITY_TYPES } from "../../src/data-sync";
import { HttpError } from "./http";

export const MAX_ITEMS_PER_SYNC = 2000;
const MAX_PAYLOAD_CHARS = 20_000;

/** Validates a client sync batch with the same rules the client uses to read data. */
export function parseSyncBatch(body: Record<string, unknown>): { upserts: WorkspaceItemDraft[]; deletes: WorkspaceItemDelete[] } {
  const { upserts, deletes } = body;
  if (!Array.isArray(upserts) || !Array.isArray(deletes)) {
    throw new HttpError(400, "A sync needs upserts and deletes lists.");
  }
  if (upserts.length + deletes.length > MAX_ITEMS_PER_SYNC) {
    throw new HttpError(413, `Send at most ${MAX_ITEMS_PER_SYNC} changes at a time.`);
  }
  for (const item of upserts) {
    if (!isWorkspaceItemDraft(item)) throw new HttpError(400, "A change in this sync has an invalid format.");
    if (item.id.length > 100) throw new HttpError(400, "An item ID is too long.");
    if (JSON.stringify(item.payload).length > MAX_PAYLOAD_CHARS) throw new HttpError(413, `“${item.id}” is too large to save.`);
  }
  for (const item of deletes) {
    if (
      typeof item !== "object" || item === null ||
      !WORKSPACE_ENTITY_TYPES.includes((item as { entity_type: WorkspaceEntityType }).entity_type) ||
      typeof (item as { id: unknown }).id !== "string"
    ) {
      throw new HttpError(400, "A deletion in this sync has an invalid format.");
    }
  }
  return {
    upserts: upserts.map(({ entity_type, id, project_id, payload }: WorkspaceItemDraft) => ({ entity_type, id, project_id, payload })),
    deletes: deletes.map(({ entity_type, id }: WorkspaceItemDelete) => ({ entity_type, id })),
  };
}

const NOUNS: Record<WorkspaceEntityType, string> = {
  project: "project",
  task: "task",
  note: "note",
  sprint: "sprint",
  meeting: "meeting",
  project_link: "link",
  calendar_event: "event",
};

/** "Updated 3 tasks and 1 note" style summary for notifications. */
export function summarizeChanges(upserts: WorkspaceItemDraft[], deletes: WorkspaceItemDelete[]): string {
  const counts = new Map<string, number>();
  for (const item of [...upserts, ...deletes]) counts.set(item.entity_type, (counts.get(item.entity_type) ?? 0) + 1);
  const parts = [...counts.entries()].map(([type, count]) => {
    const noun = NOUNS[type as WorkspaceEntityType];
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  });
  if (parts.length === 0) return "Open Orbit to see what changed.";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `Changed ${list}.`;
}
