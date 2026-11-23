import { useEffect, useRef, useState } from "react";
import { apiRequest } from "./client-api";
import { timeAgo } from "./AppsView";
import { Icon } from "./Icon";

type ActivityEvent = {
  id: number;
  entityType: string;
  label: string | null;
  action: "created" | "updated" | "deleted";
  createdAt: string;
  deviceName: string;
  mine: boolean;
};

const NOUN: Record<string, string> = {
  project: "project",
  task: "task",
  note: "note",
  sprint: "sprint",
  meeting: "meeting",
  project_link: "link",
  calendar_event: "event",
};

const SEEN_KEY = "orbit-activity-seen";

function readSeen(): number {
  try {
    return Number(window.localStorage.getItem(SEEN_KEY) ?? 0);
  } catch {
    return 0;
  }
}

/** Bell button with a dropdown of recent changes made by any device. */
export function ActivityBell({ revisionHint }: { revisionHint: unknown }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [error, setError] = useState("");
  const [seen, setSeen] = useState(readSeen);
  const panelRef = useRef<HTMLDivElement>(null);

  // Reload whenever the shared data changes (revisionHint is the dashboard object).
  // Debounced so a burst of edits causes one request.
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      apiRequest<{ events: ActivityEvent[] }>("/api/workspace/activity").then((response) => {
        if (active) { setEvents(response.events); setError(""); }
      }).catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load activity.");
      });
    }, 1500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [revisionHint]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const unread = events.filter((event) => !event.mine && event.id > seen).length;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && events[0]) {
      setSeen(events[0].id);
      try { window.localStorage.setItem(SEEN_KEY, String(events[0].id)); } catch { /* storage unavailable */ }
    }
  }

  return (
    <div className="activity-anchor" ref={panelRef}>
      <button aria-expanded={open} aria-label={unread ? `${unread} new updates` : "Recent activity"} className="icon-button notification-button" onClick={toggle} type="button">
        <Icon name="bell" size={19} />{unread > 0 && <span />}
      </button>
      {open && (
        <div className="activity-panel" role="dialog" aria-label="Recent activity">
          <div className="activity-heading"><strong>Recent activity</strong><small>All devices</small></div>
          {error && <p className="push-message push-message-error">{error}</p>}
          {events.length === 0 && !error && <p className="empty-state">No changes yet.</p>}
          <ul>
            {events.map((event) => (
              <li className={!event.mine && event.id > seen ? "activity-unread" : ""} key={event.id}>
                <span className={`activity-dot activity-${event.action}`} />
                <span>
                  <strong>{event.mine ? "You" : event.deviceName}</strong> {event.action} {NOUN[event.entityType] ?? "item"}
                  {event.label && <> “{event.label}”</>}
                  <small>{timeAgo(event.createdAt)}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
