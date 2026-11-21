import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DashboardData } from "./project-types";
import {
  dashboardToWorkspaceItems,
  diffWorkspaceItems,
  isWorkspaceItem,
  mergeRemoteDashboard,
  type WorkspaceItem,
  type WorkspaceItemDraft,
} from "./data-sync";
import { apiRequest } from "./client-api";

type WorkspaceDataResponse = { items: unknown[] };

function toDrafts(items: WorkspaceItem[]): WorkspaceItemDraft[] {
  return items.map(({ entity_type, id, project_id, payload }) => ({
    entity_type,
    id,
    project_id,
    payload,
  }));
}

function applyDiff(
  baseline: WorkspaceItemDraft[],
  upserts: WorkspaceItemDraft[],
  deletes: Array<{ entity_type: WorkspaceItemDraft["entity_type"]; id: string }>,
): WorkspaceItemDraft[] {
  const next = new Map(baseline.map((item) => [`${item.entity_type}:${item.id}`, item]));
  for (const item of upserts) next.set(`${item.entity_type}:${item.id}`, item);
  for (const item of deletes) next.delete(`${item.entity_type}:${item.id}`);
  return [...next.values()];
}

export function useWorkspaceSync(
  workspaceId: string,
  dashboard: DashboardData,
  setDashboard: Dispatch<SetStateAction<DashboardData>>,
) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const baselineRef = useRef<WorkspaceItemDraft[] | null>(null);
  const currentDashboardRef = useRef(dashboard);
  const savingRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  currentDashboardRef.current = dashboard;

  useEffect(() => {
    let active = true;
    setReady(false);
    setError("");

    void apiRequest<WorkspaceDataResponse>("/api/workspace/data").then((response) => {
      if (!Array.isArray(response.items) || !response.items.every(isWorkspaceItem)) {
        throw new Error("The shared workspace contains invalid data.");
      }
      if (!active) return;
      const rows = response.items;
      baselineRef.current = toDrafts(rows);
      setDashboard(mergeRemoteDashboard(currentDashboardRef.current, [], rows));
      setReady(true);
    }).catch((loadError: unknown) => {
      if (!active) return;
      console.error("Could not load shared workspace data.", loadError);
      setError(loadError instanceof Error ? loadError.message : "Could not load shared workspace data.");
    });

    return () => { active = false; };
  }, [workspaceId, retryCount, setDashboard]);

  useEffect(() => {
    if (!ready) return;
    let active = true;
    let inFlight = false;
    const timer = window.setInterval(() => {
      if (inFlight || savingRef.current) return;
      inFlight = true;
      void apiRequest<WorkspaceDataResponse>("/api/workspace/data").then((response) => {
        if (!active || !Array.isArray(response.items) || !response.items.every(isWorkspaceItem)) return;
        const rows = response.items;
        const baseline = baselineRef.current ?? [];
        const merged = mergeRemoteDashboard(currentDashboardRef.current, baseline, rows);
        baselineRef.current = toDrafts(rows);
        currentDashboardRef.current = merged;
        setDashboard(merged);
        setError("");
      }).catch((pollError: unknown) => {
        if (!active) return;
        console.error("Could not refresh shared workspace updates.", pollError);
        setError(pollError instanceof Error ? pollError.message : "Could not refresh shared workspace updates.");
      }).finally(() => {
        inFlight = false;
      });
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ready, retryCount, setDashboard]);

  useEffect(() => {
    if (!ready) return;
    const currentRows = dashboardToWorkspaceItems(dashboard);
    queueRef.current = queueRef.current.then(async () => {
      const previousRows = baselineRef.current;
      if (!previousRows) return;
      const { upserts, deletes } = diffWorkspaceItems(previousRows, currentRows);
      if (upserts.length === 0 && deletes.length === 0) return;

      savingRef.current = true;
      try {
        await apiRequest("/api/workspace/sync", {
          method: "POST",
          body: JSON.stringify({ upserts, deletes }),
        });
        baselineRef.current = applyDiff(baselineRef.current ?? [], upserts, deletes);
        setError("");
      } finally {
        savingRef.current = false;
      }
    }).catch((saveError: unknown) => {
      console.error("Could not save shared workspace changes.", saveError);
      setError(saveError instanceof Error ? saveError.message : "Shared changes could not be saved.");
    });
  }, [dashboard, ready, retryCount]);

  return {
    ready,
    error,
    retry: () => {
      setError("");
      setRetryCount((count) => count + 1);
    },
  };
}
