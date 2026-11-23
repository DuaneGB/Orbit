// Single entry point for every /api/* route.
//
// Vercel's Hobby plan allows at most 12 functions per deployment, so the route
// modules live in api/_routes (underscore folders are not deployed as
// functions) and vercel.json rewrites /api/<path> to this file. Client URLs are
// unchanged.

import * as googleAuth from "./_routes/google/auth.js";
import * as googleCallback from "./_routes/google/callback.js";
import * as googleDisconnect from "./_routes/google/disconnect.js";
import * as googleStatus from "./_routes/google/status.js";
import * as googleSync from "./_routes/google/sync.js";
import * as vercelProjects from "./_routes/vercel/projects.js";
import * as workspaceActivity from "./_routes/workspace/activity.js";
import * as workspaceCreate from "./_routes/workspace/create.js";
import * as workspaceData from "./_routes/workspace/data.js";
import * as workspaceDevices from "./_routes/workspace/devices.js";
import * as workspaceForgetDevice from "./_routes/workspace/forget-device.js";
import * as workspaceInvites from "./_routes/workspace/invites.js";
import * as workspaceJoin from "./_routes/workspace/join.js";
import * as workspaceMe from "./_routes/workspace/me.js";
import * as workspacePush from "./_routes/workspace/push.js";
import * as workspaceSync from "./_routes/workspace/sync.js";

type Handler = (request: Request) => Promise<Response>;
type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", Handler>>;

const routes: Record<string, RouteModule> = {
  "google/auth": googleAuth,
  "google/callback": googleCallback,
  "google/disconnect": googleDisconnect,
  "google/status": googleStatus,
  "google/sync": googleSync,
  "vercel/projects": vercelProjects,
  "workspace/activity": workspaceActivity,
  "workspace/create": workspaceCreate,
  "workspace/data": workspaceData,
  "workspace/devices": workspaceDevices,
  "workspace/forget-device": workspaceForgetDevice,
  "workspace/invites": workspaceInvites,
  "workspace/join": workspaceJoin,
  "workspace/me": workspaceMe,
  "workspace/push": workspacePush,
  "workspace/sync": workspaceSync,
};

function routeName(request: Request): string {
  const url = new URL(request.url);
  // The rewrite passes the original path as ?route=; fall back to the path
  // itself in case the platform hands us the pre-rewrite URL.
  const fromQuery = url.searchParams.get("route");
  const raw = fromQuery ?? url.pathname.replace(/^\/api\//, "");
  return raw.replace(/^\/+|\/+$/g, "");
}

function notFound(status: number, message: string, extra?: Record<string, string>) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

async function dispatch(request: Request): Promise<Response> {
  const module = routes[routeName(request)];
  if (!module) return notFound(404, "Not found.");
  const handler = module[request.method as keyof RouteModule];
  if (!handler) {
    const allow = Object.keys(module).filter((key) => /^[A-Z]+$/.test(key)).join(", ");
    return notFound(405, "Method not allowed.", { allow });
  }
  return handler(request);
}

export const GET = dispatch;
export const POST = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
