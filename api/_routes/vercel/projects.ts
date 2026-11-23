import { requireDevice } from "../../_lib/device.js";
import { HttpError, json, route } from "../../_lib/http.js";

type VercelDeployment = {
  id?: string;
  url?: string;
  alias?: unknown;
  readyState?: string;
  target?: string | null;
  createdAt?: number;
  meta?: Record<string, unknown>;
};

type VercelProject = {
  id: string;
  name: string;
  framework?: string | null;
  updatedAt?: number;
  createdAt?: number;
  link?: { type?: string; org?: string; repo?: string; productionBranch?: string } | null;
  targets?: { production?: VercelDeployment | null } | null;
  latestDeployments?: VercelDeployment[];
  alias?: unknown;
};

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

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toHttps(host: string): string {
  return host.startsWith("http") ? host : `https://${host}`;
}

/** Prefer a custom domain over *.vercel.app, and a stable alias over a per-deploy URL. */
function pickProductionUrl(project: VercelProject, production: VercelDeployment | undefined): string {
  const aliases = [...strings(production?.alias), ...strings(project.alias)];
  const custom = aliases.find((host) => !host.endsWith(".vercel.app"));
  const stable = aliases.find((host) => host.endsWith(".vercel.app"));
  return toHttps(custom ?? stable ?? `${project.name}.vercel.app`);
}

function status(readyState: string | undefined): HostedApp["status"] {
  switch (readyState) {
    case "READY": return "ready";
    case "BUILDING":
    case "INITIALIZING": return "building";
    case "QUEUED": return "queued";
    case "ERROR": return "error";
    case "CANCELED": return "canceled";
    default: return "unknown";
  }
}

function repository(link: VercelProject["link"]): HostedApp["repository"] {
  if (!link?.repo) return null;
  const name = link.org ? `${link.org}/${link.repo}` : link.repo;
  const hosts: Record<string, string> = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" };
  const host = link.type ? hosts[link.type] : undefined;
  return { provider: link.type ?? "git", name, url: host ? `https://${host}/${name}` : null };
}

function toHostedApp(project: VercelProject, teamSlug: string | undefined): HostedApp {
  const deployments = project.latestDeployments ?? [];
  const production = project.targets?.production ?? deployments.find((item) => item.target === "production");
  const latest = [...deployments].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0];
  const preview = deployments.find((item) => item.target !== "production" && item.url);
  const meta = (production ?? latest)?.meta ?? {};
  const deployedAt = (production ?? latest)?.createdAt;
  return {
    id: project.id,
    name: project.name,
    framework: project.framework ?? null,
    productionUrl: pickProductionUrl(project, production ?? undefined),
    previewUrl: preview?.url ? toHttps(preview.url) : null,
    // The newest deployment is what people care about: is something building or broken right now?
    status: status(latest?.readyState ?? production?.readyState),
    lastDeployedAt: deployedAt ? new Date(deployedAt).toISOString() : null,
    repository: repository(project.link),
    branch: typeof meta.githubCommitRef === "string" ? meta.githubCommitRef : project.link?.productionBranch ?? null,
    commitMessage: typeof meta.githubCommitMessage === "string" ? meta.githubCommitMessage.split("\n")[0].slice(0, 140) : null,
    dashboardUrl: `https://vercel.com/${teamSlug ?? "dashboard"}/${encodeURIComponent(project.name)}`,
  };
}

/**
 * Lists every project in the configured Vercel account or team, with its live
 * production link and latest deployment status. The token stays on the server.
 */
export const GET = route(async (request) => {
  await requireDevice(request);
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const teamSlug = process.env.VERCEL_TEAM_SLUG;
  if (!token) return json({ configured: false, apps: [] });

  const projects: VercelProject[] = [];
  let from: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL("https://api.vercel.com/v10/projects");
    url.searchParams.set("limit", "100");
    if (teamId) url.searchParams.set("teamId", teamId);
    if (from) url.searchParams.set("from", from);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(502, "Vercel rejected Orbit's token. Check VERCEL_TOKEN and VERCEL_TEAM_ID.");
    }
    if (!response.ok) throw new HttpError(502, `Vercel could not list projects (${response.status}).`);
    const body = await response.json() as VercelProject[] | { projects?: VercelProject[]; pagination?: { next?: number | string | null } };
    const batch = Array.isArray(body) ? body : body.projects ?? [];
    projects.push(...batch.filter((item) => typeof item?.id === "string" && typeof item?.name === "string"));
    const next = Array.isArray(body) ? null : body.pagination?.next;
    if (next === null || next === undefined || batch.length === 0) break;
    from = String(next);
  }

  const apps = projects
    .map((project) => toHostedApp(project, teamSlug))
    .sort((a, b) => (b.lastDeployedAt ?? "").localeCompare(a.lastDeployedAt ?? ""));
  return json(
    { configured: true, apps, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "private, max-age=30" } },
  );
});
