import { requireDevice } from "../../_lib/device.js";
import { json, route } from "../../_lib/http.js";

/** Who is this device, and which workspace does it belong to? */
export const GET = route(async (request) => json(await requireDevice(request)));
