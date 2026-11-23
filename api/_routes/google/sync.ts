import { randomBytes } from "node:crypto";
import type { CalendarEvent } from "../../../src/project-types.js";
import { isCalendarEvent } from "../../../src/data-validation.js";
import { db } from "../../_lib/db.js";
import { requireDevice } from "../../_lib/device.js";
import { decryptRefreshToken } from "../../_lib/google.js";
import { HttpError, json, readJson, route } from "../../_lib/http.js";

// Only events in this window sync, so a connected calendar doesn't pour years
// of personal history into a shared workspace.
const SYNC_DAYS_BACK = 30;
const SYNC_DAYS_AHEAD = 365;

type GoogleEvent = {
  id: string;
  etag?: string;
  updated?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
};

type GoogleEventPage = { items?: GoogleEvent[]; nextPageToken?: string };
type GoogleTokenResponse = { access_token?: string; error?: string };
type LocalEventRow = {
  id: string;
  payload: unknown;
  updated_at: string;
};
type MappingRow = {
  orbit_event_id: string;
  google_event_id: string;
  google_etag: string | null;
  synced_orbit_updated_at: string;
  synced_google_updated_at: string;
};

function isGoogleEvent(value: unknown): value is GoogleEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === "string" && (event.status === undefined || typeof event.status === "string");
}

function dateTimeInZone(value: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function addOneDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function addOneHour(date: string, time: string): { date: string; time: string } {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day, hour, minute + 60));
  return {
    date: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`,
    time: `${String(next.getUTCHours()).padStart(2, "0")}:${String(next.getUTCMinutes()).padStart(2, "0")}`,
  };
}

function toGoogleEvent(event: CalendarEvent, timeZone: string): Record<string, unknown> {
  const privateProperties = {
    orbitEventId: String(event.id),
    orbitProject: event.project,
    orbitNotes: event.notes,
  };
  if (!event.time) {
    return {
      summary: event.title,
      description: event.notes,
      start: { date: event.date },
      end: { date: addOneDay(event.date) },
      extendedProperties: { private: privateProperties },
    };
  }
  const end = addOneHour(event.date, event.time);
  return {
    summary: event.title,
    description: event.notes,
    start: { dateTime: `${event.date}T${event.time}:00`, timeZone },
    end: { dateTime: `${end.date}T${end.time}:00`, timeZone },
    extendedProperties: { private: privateProperties },
  };
}

function fromGoogleEvent(event: GoogleEvent, id: string, timeZone: string): CalendarEvent | null {
  const start = event.start;
  if (!start || (!start.date && !start.dateTime)) return null;
  const dateAndTime = start.dateTime
    ? dateTimeInZone(start.dateTime, timeZone)
    : { date: start.date!, time: "" };
  return {
    id,
    title: event.summary?.trim() || "Google Calendar event",
    date: dateAndTime.date,
    time: dateAndTime.time,
    project: event.extendedProperties?.private?.orbitProject || "Google Calendar",
    notes: event.extendedProperties?.private?.orbitNotes ?? event.description ?? "",
  };
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function googleRequest(
  url: string,
  accessToken: string,
  method = "GET",
  body?: Record<string, unknown>,
): Promise<GoogleEvent | GoogleEventPage> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as GoogleEvent | GoogleEventPage | { error?: { message?: string } };
  if (!response.ok) {
    const message = "error" in result && result.error && typeof result.error === "object"
      ? result.error.message
      : undefined;
    throw new Error(`Google Calendar request failed (${response.status})${message ? `: ${message}` : "."}`);
  }
  return result as GoogleEvent | GoogleEventPage;
}

async function listGoogleEvents(accessToken: string, calendarId: string): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  const day = 24 * 60 * 60 * 1000;
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("maxResults", "2500");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("singleEvents", "false");
    url.searchParams.set("timeMin", new Date(Date.now() - SYNC_DAYS_BACK * day).toISOString());
    url.searchParams.set("timeMax", new Date(Date.now() + SYNC_DAYS_AHEAD * day).toISOString());
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = await googleRequest(url.toString(), accessToken) as GoogleEventPage;
    if (page.items) {
      for (const event of page.items) {
        if (isGoogleEvent(event)) events.push(event);
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return events;
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Calendar is not configured on the server.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const result = await response.json() as GoogleTokenResponse;
  if (!response.ok || !result.access_token) {
    throw new Error(result.error === "invalid_grant"
      ? "Google authorization expired. Disconnect and reconnect Google Calendar."
      : "Could not refresh Google Calendar authorization.");
  }
  return result.access_token;
}

function googleEventUrl(calendarId: string, eventId: string): string {
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
}

export const POST = route(async (request) => {
  const session = await requireDevice(request);
  const workspaceId = session.workspace.id;
  const body = await readJson<{ timeZone?: unknown }>(request);
  const timeZone = typeof body.timeZone === "string" ? body.timeZone : "";
  try {
    new Intl.DateTimeFormat("en", { timeZone });
  } catch {
    throw new HttpError(400, "A valid timezone is required.");
  }

  const admin = db();
  const user = { id: session.device.id };
  const { data: connection, error: connectionError } = await admin
    .from("google_calendar_connections")
    .select("encrypted_refresh_token,calendar_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (connectionError) {
    console.error("Could not load Google Calendar connection.", connectionError);
    throw new HttpError(500, "Could not load Google Calendar connection.");
  }
  if (!connection) throw new HttpError(409, "Connect Google Calendar before syncing.");

  try {
    const accessToken = await refreshAccessToken(decryptRefreshToken(connection.encrypted_refresh_token));
    const googleEvents = await listGoogleEvents(accessToken, connection.calendar_id);
    const { data: localRows, error: localError } = await admin.from("workspace_items")
      .select("id,payload,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", "calendar_event");
    if (localError) throw localError;
    const { data: mappingRows, error: mappingError } = await admin.from("google_calendar_mappings")
      .select("orbit_event_id,google_event_id,google_etag,synced_orbit_updated_at,synced_google_updated_at")
      .eq("workspace_id", workspaceId);
    if (mappingError) throw mappingError;

    const localById = new Map<string, LocalEventRow>();
    for (const row of localRows ?? []) {
      if (isCalendarEvent(row.payload)) localById.set(row.id, row);
    }
    const mappings = (mappingRows ?? []) as MappingRow[];
    const mappingByOrbit = new Map(mappings.map((mapping) => [mapping.orbit_event_id, mapping]));
    const googleById = new Map(googleEvents.map((event) => [event.id, event]));
    const mappedGoogleIds = new Set(mappings.map((mapping) => mapping.google_event_id));
    const report = { sentToGoogle: 0, receivedFromGoogle: 0, resolvedConflicts: 0, removed: 0 };
    const now = new Date().toISOString();

    for (const mapping of mappings) {
      const local = localById.get(mapping.orbit_event_id);
      const remote = googleById.get(mapping.google_event_id);
      if (!local) {
        if (remote && remote.status !== "cancelled") {
          const deleteResponse = await fetch(googleEventUrl(connection.calendar_id, remote.id), {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!deleteResponse.ok && deleteResponse.status !== 404 && deleteResponse.status !== 410) {
            throw new Error(`Could not remove deleted Orbit event from Google (${deleteResponse.status}).`);
          }
        }
        const { error: deleteMappingError } = await admin.from("google_calendar_mappings")
          .delete().eq("workspace_id", workspaceId).eq("orbit_event_id", mapping.orbit_event_id);
        if (deleteMappingError) throw deleteMappingError;
        report.removed += 1;
        continue;
      }
      if (!remote || remote.status === "cancelled") {
        const { error: deleteLocalError } = await admin.from("workspace_items")
          .delete().eq("workspace_id", workspaceId).eq("entity_type", "calendar_event").eq("id", mapping.orbit_event_id);
        if (deleteLocalError) throw deleteLocalError;
        const { error: deleteMappingError } = await admin.from("google_calendar_mappings")
          .delete().eq("workspace_id", workspaceId).eq("orbit_event_id", mapping.orbit_event_id);
        if (deleteMappingError) throw deleteMappingError;
        report.removed += 1;
        continue;
      }

      const localEvent = local.payload as CalendarEvent;
      const localChanged = timestamp(local.updated_at) > timestamp(mapping.synced_orbit_updated_at);
      const googleChanged = timestamp(remote.updated) > timestamp(mapping.synced_google_updated_at);
      const googleIsNewer = googleChanged &&
        (!localChanged || timestamp(remote.updated) > timestamp(local.updated_at));
      if (googleIsNewer) {
        const updated = fromGoogleEvent(remote, localEvent.id.toString(), timeZone);
        if (!updated) continue;
        const { error: updateLocalError } = await admin.from("workspace_items").update({
          payload: updated,
          updated_by_device_id: user.id,
          updated_at: now,
        }).eq("workspace_id", workspaceId).eq("entity_type", "calendar_event").eq("id", mapping.orbit_event_id);
        if (updateLocalError) throw updateLocalError;
        const { error: updateMappingError } = await admin.from("google_calendar_mappings").update({
          google_etag: remote.etag ?? null,
          synced_orbit_updated_at: now,
          synced_google_updated_at: remote.updated ?? now,
        }).eq("workspace_id", workspaceId).eq("orbit_event_id", mapping.orbit_event_id);
        if (updateMappingError) throw updateMappingError;
        if (localChanged) report.resolvedConflicts += 1;
        report.receivedFromGoogle += 1;
      } else if (localChanged) {
        const response = await googleRequest(
          googleEventUrl(connection.calendar_id, remote.id),
          accessToken,
          "PATCH",
          toGoogleEvent(localEvent, timeZone),
        ) as GoogleEvent;
        const { error: updateMappingError } = await admin.from("google_calendar_mappings").update({
          google_etag: response.etag ?? null,
          synced_orbit_updated_at: local.updated_at,
          synced_google_updated_at: response.updated ?? now,
        }).eq("workspace_id", workspaceId).eq("orbit_event_id", mapping.orbit_event_id);
        if (updateMappingError) throw updateMappingError;
        report.sentToGoogle += 1;
      }
    }

    for (const local of localById.values()) {
      if (mappingByOrbit.has(local.id)) continue;
      const event = local.payload as CalendarEvent;
      const googleId = randomBytes(16).toString("hex");
      const created = await googleRequest(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.calendar_id)}/events`,
        accessToken,
        "POST",
        { id: googleId, ...toGoogleEvent(event, timeZone) },
      ) as GoogleEvent;
      const syncedGoogleAt = created.updated ?? now;
      const { error: insertMappingError } = await admin.from("google_calendar_mappings").insert({
        workspace_id: workspaceId,
        orbit_event_id: local.id,
        google_event_id: created.id,
        google_etag: created.etag ?? null,
        synced_orbit_updated_at: local.updated_at,
        synced_google_updated_at: syncedGoogleAt,
      });
      if (insertMappingError) throw insertMappingError;
      mappedGoogleIds.add(created.id);
      report.sentToGoogle += 1;
    }

    for (const remote of googleEvents) {
      if (remote.status === "cancelled" || mappedGoogleIds.has(remote.id)) continue;
      const orbitId = remote.extendedProperties?.private?.orbitEventId;
      const existingLocal = orbitId ? localById.get(orbitId) : undefined;
      const event = fromGoogleEvent(remote, orbitId ?? crypto.randomUUID(), timeZone);
      if (!event) continue;
      if (existingLocal) {
        const { error: linkError } = await admin.from("google_calendar_mappings").insert({
          workspace_id: workspaceId,
          orbit_event_id: existingLocal.id,
          google_event_id: remote.id,
          google_etag: remote.etag ?? null,
          synced_orbit_updated_at: existingLocal.updated_at,
          synced_google_updated_at: remote.updated ?? now,
        });
        if (linkError) throw linkError;
      } else {
        const { error: insertError } = await admin.from("workspace_items").insert({
          workspace_id: workspaceId,
          entity_type: "calendar_event",
          id: String(event.id),
          project_id: null,
          payload: event,
          updated_by_device_id: user.id,
          updated_at: now,
        });
        if (insertError) throw insertError;
        const { error: insertMappingError } = await admin.from("google_calendar_mappings").insert({
          workspace_id: workspaceId,
          orbit_event_id: String(event.id),
          google_event_id: remote.id,
          google_etag: remote.etag ?? null,
          synced_orbit_updated_at: now,
          synced_google_updated_at: remote.updated ?? now,
        });
        if (insertMappingError) throw insertMappingError;
        report.receivedFromGoogle += 1;
      }
      mappedGoogleIds.add(remote.id);
    }

    const { error: updateConnectionError } = await admin.from("google_calendar_connections")
      .update({ last_synced_at: now }).eq("workspace_id", workspaceId);
    if (updateConnectionError) throw updateConnectionError;
    return json(report);
  } catch (syncError) {
    console.error("Google Calendar sync failed.", syncError);
    throw new HttpError(502, syncError instanceof Error && syncError.message.startsWith("Google")
      ? syncError.message
      : "Google Calendar sync failed. Try again in a minute.");
  }
});
