import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "./client-api";
import { Icon } from "./Icon";
import type { EntityId, Project } from "./project-types";

export type HostedApp = {
  id: string;
  name: string;
  framework: string | null;
  productionUrl: string;
  previewUrl: string | null;
  status: "ready" | "building" | "error" | "queued" | "canceled" | "unknown";
  lastDeployedAt: string | null;
  repository: { provider: string; name: string; url: string | null } | null;
  branch: string | null;
  commitMessage: string | null;
  dashboardUrl: string;
};

type HostedAppsResponse = { configured: boolean; apps: HostedApp[]; fetchedAt?: string };

const STATUS_LABEL: Record<HostedApp["status"], string> = {
  ready: "Live",
  building: "Deploying",
  queued: "Queued",
  error: "Failed",
  canceled: "Canceled",
  unknown: "No deploys",
};

export function timeAgo(value: string | null): string {
  if (!value) return "never";
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function displayHost(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

/** Loads the Vercel project list when enabled; refreshes every minute while visible. */
export function useHostedApps(enabled: boolean) {
  const [data, setData] = useState<HostedAppsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiRequest<HostedAppsResponse>("/api/vercel/projects"));
      setError("");
    } catch (loadError) {
      console.error("Could not load hosted apps.", loadError);
      setError(loadError instanceof Error ? loadError.message : "Could not load hosted apps.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  return { data, loading, error, reload: load };
}

export function AppStatus({ status }: { status: HostedApp["status"] }) {
  return <span className={`app-status app-status-${status}`}><i />{STATUS_LABEL[status]}</span>;
}

export function AppCard({
  app,
  projects,
  linkedProjectId,
  onLink,
}: {
  app: HostedApp;
  projects?: Project[];
  linkedProjectId?: EntityId | null;
  onLink?: (projectId: EntityId | null) => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(app.productionUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (copyError) {
      console.error("Could not copy the link.", copyError);
    }
  }

  return (
    <article className="app-card">
      <div className="app-card-top">
        <span className="app-card-icon"><Icon name="globe" size={17} /></span>
        <div className="app-card-title">
          <strong>{app.name}</strong>
          <small>{app.framework ?? "Static"}{app.branch ? ` · ${app.branch}` : ""}</small>
        </div>
        <AppStatus status={app.status} />
      </div>
      <a className="app-card-link" href={app.productionUrl} rel="noreferrer" target="_blank">
        {displayHost(app.productionUrl)} <Icon name="arrow" size={13} />
      </a>
      {app.commitMessage && <p className="app-card-commit" title={app.commitMessage}>“{app.commitMessage}”</p>}
      <div className="app-card-meta">
        <span><Icon name="clock" size={13} /> Deployed {timeAgo(app.lastDeployedAt)}</span>
        {app.repository?.url
          ? <a href={app.repository.url} rel="noreferrer" target="_blank">{app.repository.name}</a>
          : app.repository && <span>{app.repository.name}</span>}
      </div>
      <div className="app-card-actions">
        <button className="text-button" onClick={() => void copy()} type="button">{copied ? "Copied" : "Copy link"}</button>
        {app.previewUrl && <a className="text-button" href={app.previewUrl} rel="noreferrer" target="_blank">Latest preview</a>}
        <a className="text-button" href={app.dashboardUrl} rel="noreferrer" target="_blank">Vercel</a>
        {projects && onLink && (
          <label className="app-card-project">
            <span className="visually-hidden">Orbit project for {app.name}</span>
            <select
              onChange={(event) => onLink(event.target.value ? projects.find((project) => String(project.id) === event.target.value)?.id ?? null : null)}
              value={linkedProjectId === null || linkedProjectId === undefined ? "" : String(linkedProjectId)}
            >
              <option value="">No Orbit project</option>
              {projects.map((project) => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
            </select>
          </label>
        )}
      </div>
    </article>
  );
}

type StatusFilter = "All" | "Live" | "Needs attention";

export default function AppsView({
  projects,
  hosted,
  onLinkApp,
}: {
  projects: Project[];
  hosted: ReturnType<typeof useHostedApps>;
  onLinkApp: (appId: string, projectId: EntityId | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("All");
  const apps = hosted.data?.apps ?? [];

  const linkedProject = useMemo(() => {
    const map = new Map<string, EntityId>();
    for (const project of projects) for (const appId of project.vercelProjectIds ?? []) map.set(appId, project.id);
    return map;
  }, [projects]);

  const visible = apps.filter((app) => {
    const text = `${app.name} ${app.productionUrl} ${app.repository?.name ?? ""} ${app.framework ?? ""}`.toLowerCase();
    const matches = text.includes(query.trim().toLowerCase());
    const status = filter === "All" ||
      (filter === "Live" && app.status === "ready") ||
      (filter === "Needs attention" && (app.status === "error" || app.status === "canceled" || app.status === "unknown"));
    return matches && status;
  });
  const failing = apps.filter((app) => app.status === "error").length;
  const building = apps.filter((app) => app.status === "building" || app.status === "queued").length;
  const unlinked = apps.filter((app) => !linkedProject.has(app.id)).length;

  return (
    <div className="apps-view">
      <section className="welcome-row">
        <div>
          <div className="date-line"><span className="date-dot" />Hosted on Vercel</div>
          <h1>Hosted apps<span className="heading-period">.</span></h1>
          <p className="welcome-description">Every deployment, its live link, and whether it's healthy, in one place for every device.</p>
        </div>
        <div className="welcome-actions">
          <button className="button button-secondary" disabled={hosted.loading} onClick={() => void hosted.reload()} type="button">
            <Icon name="refresh" size={16} /> {hosted.loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </section>

      {hosted.error && <p className="sync-warning" role="alert">{hosted.error}</p>}

      {hosted.data && !hosted.data.configured ? (
        <section className="space-panel apps-setup">
          <span className="panel-kicker">CONNECT VERCEL</span>
          <h2>List your Vercel projects here automatically</h2>
          <ol>
            <li>In Vercel, open <strong>Account Settings → Tokens</strong> and create a read-only token scoped to your team.</li>
            <li>In this Orbit project's Vercel settings, add environment variables <code>VERCEL_TOKEN</code>, <code>VERCEL_TEAM_ID</code> (for a team), and optionally <code>VERCEL_TEAM_SLUG</code>.</li>
            <li>Redeploy Orbit. Every project and its production link appears here, with live deploy status.</li>
          </ol>
          <p>Until then, add links by hand in any project's <strong>Links</strong> tab.</p>
        </section>
      ) : (
        <>
          <section className="stats-grid" aria-label="Hosting summary">
            <article className="stat-card stat-card-lavender">
              <div className="stat-top"><span>Hosted apps</span><span className="stat-icon"><Icon name="globe" size={18} /></span></div>
              <div className="stat-value">{apps.length}<span className="stat-unit"> projects</span></div>
              <div className="stat-note">{unlinked} not linked to an Orbit project</div>
            </article>
            <article className="stat-card stat-card-peach">
              <div className="stat-top"><span>Needs attention</span><span className="stat-icon"><Icon name="target" size={18} /></span></div>
              <div className="stat-value">{failing}<span className="stat-unit"> failed</span></div>
              <div className="stat-note">Latest deploy failed</div>
            </article>
            <article className="stat-card stat-card-mint">
              <div className="stat-top"><span>In progress</span><span className="stat-icon"><Icon name="clock" size={18} /></span></div>
              <div className="stat-value">{building}<span className="stat-unit"> deploying</span></div>
              <div className="stat-note">{hosted.data?.fetchedAt ? `Checked ${timeAgo(hosted.data.fetchedAt)}` : "Checking…"}</div>
            </article>
          </section>

          <section className="content-section">
            <div className="section-heading">
              <div><h2>All deployments</h2><p>Link each app to an Orbit project so it shows up in that project's space.</p></div>
              <div className="apps-controls">
                <label className="search-box apps-search">
                  <Icon name="search" size={16} />
                  <input aria-label="Search hosted apps" onChange={(event) => setQuery(event.target.value)} placeholder="Find an app…" value={query} />
                </label>
                <div className="task-filters" role="tablist" aria-label="Filter hosted apps">
                  {(["All", "Live", "Needs attention"] as const).map((item) => (
                    <button aria-selected={filter === item} className={filter === item ? "selected" : ""} key={item} onClick={() => setFilter(item)} role="tab" type="button">{item}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="app-grid">
              {visible.map((app) => (
                <AppCard
                  app={app}
                  key={app.id}
                  linkedProjectId={linkedProject.get(app.id) ?? null}
                  onLink={(projectId) => onLinkApp(app.id, projectId)}
                  projects={projects}
                />
              ))}
            </div>
            {!hosted.data && hosted.loading && <p className="empty-state">Loading your Vercel projects…</p>}
            {hosted.data && visible.length === 0 && <p className="empty-state">{apps.length === 0 ? "No Vercel projects found for this token." : "No apps match. Try another search or filter."}</p>}
          </section>
        </>
      )}
    </div>
  );
}
