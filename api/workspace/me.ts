import { requireDevice } from "../_lib/device";
import { json, route } from "../_lib/http";

/** Who is this device, and which workspace does it belong to? */
export const GET = route(async (request) => json(await requireDevice(request)));
