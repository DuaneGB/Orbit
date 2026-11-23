import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DashboardData } from "./project-types";
import {
  dashboardToWorkspaceItems,
  diffWorkspaceItems,
  isWorkspaceItem,
  mergeRemoteDashboard,
  workspaceItemsToDashboard,
  type WorkspaceItem,
  type WorkspaceItemDelete,
  type WorkspaceItemDraft,
} from "./data-sync";
import { apiRequest } from "./client-api";

type WorkspaceDataResponse =
  | { revision: number; unchanged: true }
  | { revision: number; items: unknown[] };

export type SyncStatus = "loading" | "synced" | "saving" | "offline" | "error";

const POLL_MS = 4000;
const SAVE_DEBOUNCE_MS = 400;

function toDrafts(items: WorkspaceItem[]): WorkspaceItemDraft[] {
  return items.map(({ entity_type, id, project_id, payload }) => ({ entity_type, id, project_id, payload }));
}

function applyDiff(baseline: WorkspaceItemDraft[], upserts: WorkspaceItemDraft[], deletes: WorkspaceItemDelete[]): WorkspaceItemDraft[] {
  const next = new Map(baseline.map((item) => [`${item.entity_type}:${item.id}`, item]));
  for (const item of upserts) next.set(`${item.entity_type}:${item.id}`, item);
  for (const item of deletes) next.delete(`${item.entity_type}:${item.id}`);
  return [...next.values()];
}

function readItems(response: { items: unknown[] }): WorkspaceItem[] {
  if (!Array.isArray(response.items) || !response.items.every(isWorkspaceItem)) {
    throw new Error("The shared workspace contains data this version of Orbit can't read. Refresh the page.");
  }
  return response.items;
}

function message(error: unknown, fallback: string): string {
  if (!navigator.onLine) return "You're offline. Changes will sync when you reconnect.";
  return error instanceof Error ? error.message : fallback;
}

/**
 * Keeps this device's copy of the workspace in step with the server.
 *
 * - First load takes the server's data as the truth.
 * - Local edits are batched (debounced) and sent as a diff against the last
 *   known server state (the baseline).
 * - Every few seconds, and whenever the tab regains focus, the device asks
 *   "has the revision changed?" and only downloads data when it has. Remote
 *   changes are merged item by item; unsaved local edits are kept.
 */
export function useWorkspaceSync(
  workspaceId: string,
  dashboard: DashboardData,
  setDashboard: Dispatch<SetStateAction<DashboardData>>,
) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const baselineRef = useRef<WorkspaceItemDraft[] | null>(null);
  const revisionRef = useRef<number | null>(null);
  const currentRef = useRef(dashboard);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const saveTimerRef = useRef<number | undefined>(undefined);
  currentRef.current = dashboard;

  const fail = useCallback((failure: unknown, fallback: string) => {
    console.error(fallback, failure);
    setError(message(failure, fallback));
    setStatus(navigator.onLine ? "error" : "offline");
  }, []);

  // Initial load.
  useEffect(() => {
    let active = true;
    setReady(false);
    setError("");
    setStatus("loading");
    apiRequest<WorkspaceDataResponse>("/api/workspace/data").then((response) => {
      if (!active) return;
      if ("unchanged" in response) throw new Error("Unexpected sync response.");
      const rows = readItems(response);
      baselineRef.current = toDrafts(rows);
      revisionRef.current = response.revision;
      const loaded = workspaceItemsToDashboard(rows);
      currentRef.current = loaded;
      setDashboard(loaded);
      setReady(true);
      setStatus("synced");
      setLastSyncedAt(new Date());
    }).catch((loadError: unknown) => {
      if (active) fail(loadError, "Could not load the shared workspace.");
    });
    return () => { active = false; };
  }, [workspaceId, retryCount, setDashboard, fail]);

  const flush = useCallback(() => {
    queueRef.current = queueRef.current.then(async () => {
      const previous = baselineRef.current;
      if (!previous) return;
      const { upserts, deletes } = diffWorkspaceItems(previous, dashboardToWorkspaceItems(currentRef.current));
      if (upserts.length === 0 && deletes.length === 0) {
        dirtyRef.current = false;
        return;
      }
      savingRef.current = true;
      setStatus("saving");
      try {
        await apiRequest("/api/workspace/sync", { method: "POST", body: JSON.stringify({ upserts, deletes }) });
        baselineRef.current = applyDiff(baselineRef.current ?? [], upserts, deletes);
        // Clear the flag only if nothing new was typed while this save was in flight.
        dirtyRef.current = diffWorkspaceItems(baselineRef.current, dashboardToWorkspaceItems(currentRef.current)).upserts.length > 0;
        setError("");
        setStatus("synced");
        setLastSyncedAt(new Date());
      } finally {
        savingRef.current = false;
      }
    }).catch((saveError: unknown) => fail(saveError, "Shared changes could not be saved. Orbit will keep trying."));
  }, [fail]);

  // Save local edits, debounced so dragging a slider sends one request, not fifty.
  useEffect(() => {
    if (!ready) return;
    dirtyRef.current = true;
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(saveTimerRef.current);
  }, [dashboard, ready, flush]);

  const poll = useCallback(async () => {
    if (savingRef.current || document.visibilityState === "hidden") return;
    if (dirtyRef.current) {
      flush(); // retry a failed or pending save before pulling
      return;
    }
    const since = revisionRef.current === null ? "" : `?since=${revisionRef.current}`;
    try {
      const response = await apiRequest<WorkspaceDataResponse>(`/api/workspace/data${since}`);
      if (!("unchanged" in response)) {
        const rows = readItems(response);
        const merged = mergeRemoteDashboard(currentRef.current, baselineRef.current ?? [], toDrafts(rows));
        baselineRef.current = toDrafts(rows);
        currentRef.current = merged;
        setDashboard(merged);
      }
      revisionRef.current = response.revision;
      setError("");
      setStatus("synced");
      setLastSyncedAt(new Date());
    } catch (pollError) {
      fail(pollError, "Could not get the latest updates.");
    }
  }, [flush, setDashboard, fail]);

  // Poll while visible; check immediately on focus or reconnect.
  useEffect(() => {
    if (!ready) return;
    let inFlight = false;
    const tick = () => {
      if (inFlight) return;
      inFlight = true;
      void poll().finally(() => { inFlight = false; });
    };
    const timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    const onOffline = () => setStatus("offline");
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    window.addEventListener("online", tick);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", tick);
      window.removeEventListener("offline", onOffline);
    };
  }, [ready, poll]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || savingRef.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return {
    ready,
    error,
    status,
    lastSyncedAt,
    retry: () => {
      setError("");
      setRetryCount((count) => count + 1);
    },
    refresh: () => void poll(),
  };
}
