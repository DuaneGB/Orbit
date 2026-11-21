import { getDevice, jsonError, serverError } from "./shared.js";

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET") return jsonError("Method not allowed.", 405);
  try {
    const device = await getDevice(request);
    if (!device) return jsonError("This device is not connected to a workspace.", 401);
    return Response.json({
      workspace: { id: device.workspaceId, name: device.workspaceName },
      device: { id: device.deviceId, name: device.deviceName, role: device.role },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return serverError("Could not check workspace access.", error);
  }
}
