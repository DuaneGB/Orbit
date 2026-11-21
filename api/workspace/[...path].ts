import create from "../../server/workspace/create.js";
import data from "../../server/workspace/data.js";
import devices from "../../server/workspace/devices.js";
import forgetDevice from "../../server/workspace/forget-device.js";
import invites from "../../server/workspace/invites.js";
import join from "../../server/workspace/join.js";
import me from "../../server/workspace/me.js";
import rename from "../../server/workspace/rename.js";
import sync from "../../server/workspace/sync.js";
import { jsonError } from "../../server/workspace/shared.js";

const routes: Record<string, (request: Request) => Promise<Response>> = {
  create,
  data,
  devices,
  "forget-device": forgetDevice,
  invites,
  join,
  me,
  rename,
  sync,
};

function handler(request: Request): Promise<Response> {
  const endpoint = request.url.split("?", 1)[0].split("/").filter(Boolean).pop() ?? "";
  const route = routes[endpoint];
  return route ? route(request) : Promise.resolve(jsonError("Workspace endpoint not found.", 404));
}

export function GET(request: Request): Promise<Response> {
  return handler(request);
}

export function POST(request: Request): Promise<Response> {
  return handler(request);
}

export function DELETE(request: Request): Promise<Response> {
  return handler(request);
}
