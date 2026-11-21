import type {
  CalendarEvent,
  DashboardData,
  EntityId,
  Project,
  ProjectLink,
  ProjectMeeting,
  ProjectNote,
  ProjectSpace,
  ProjectSprint,
  Task,
} from "./project-types";

export function isEntityId(value: unknown): value is EntityId {
  return typeof value === "string" || typeof value === "number";
}

export function isProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) return false;
  const project = value as Record<string, unknown>;
  return (
    isEntityId(project.id) &&
    typeof project.name === "string" &&
    typeof project.description === "string" &&
    typeof project.due === "string" &&
    typeof project.progress === "number" &&
    typeof project.tasks === "number" &&
    typeof project.color === "string" &&
    typeof project.symbol === "string"
  );
}

export function isTask(value: unknown): value is Task {
  if (typeof value !== "object" || value === null) return false;
  const task = value as Record<string, unknown>;
  return (
    isEntityId(task.id) &&
    typeof task.title === "string" &&
    typeof task.project === "string" &&
    typeof task.due === "string" &&
    (task.priority === "High" || task.priority === "Medium" || task.priority === "Low") &&
    typeof task.done === "boolean" &&
    typeof task.initials === "string"
  );
}

export function isProjectSpace(value: unknown): value is ProjectSpace {
  if (typeof value !== "object" || value === null) return false;
  const space = value as Record<string, unknown>;
  return (
    Array.isArray(space.notes) &&
    space.notes.every(isProjectNote) &&
    Array.isArray(space.sprints) &&
    space.sprints.every(isProjectSprint) &&
    Array.isArray(space.meetings) &&
    space.meetings.every(isProjectMeeting) &&
    (space.links === undefined || (Array.isArray(space.links) && space.links.every(isProjectLink)))
  );
}

export function isProjectLink(value: unknown): value is ProjectLink {
  if (typeof value !== "object" || value === null) return false;
  const link = value as Record<string, unknown>;
  if (!isEntityId(link.id) || typeof link.label !== "string" || typeof link.url !== "string") return false;
  try {
    const url = new URL(link.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  } catch {
    return false;
  }
  return typeof link.addedAt === "string";
}

export function isProjectNote(value: unknown): value is ProjectNote {
  if (typeof value !== "object" || value === null) return false;
  const note = value as Record<string, unknown>;
  return (
    isEntityId(note.id) &&
    typeof note.title === "string" &&
    typeof note.body === "string" &&
    typeof note.updatedAt === "string"
  );
}

export function isProjectSprint(value: unknown): value is ProjectSprint {
  if (typeof value !== "object" || value === null) return false;
  const sprint = value as Record<string, unknown>;
  return (
    isEntityId(sprint.id) &&
    typeof sprint.name === "string" &&
    typeof sprint.goal === "string" &&
    typeof sprint.startDate === "string" &&
    typeof sprint.endDate === "string" &&
    (sprint.status === "Planning" || sprint.status === "Active" || sprint.status === "Completed")
  );
}

export function isProjectMeeting(value: unknown): value is ProjectMeeting {
  if (typeof value !== "object" || value === null) return false;
  const meeting = value as Record<string, unknown>;
  return (
    isEntityId(meeting.id) &&
    typeof meeting.title === "string" &&
    typeof meeting.date === "string" &&
    typeof meeting.time === "string" &&
    typeof meeting.attendees === "string" &&
    typeof meeting.notes === "string"
  );
}

export function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Record<string, unknown>;
  const reminder = event.reminderMinutesBefore;
  return (
    isEntityId(event.id) &&
    typeof event.title === "string" &&
    typeof event.date === "string" &&
    typeof event.time === "string" &&
    typeof event.project === "string" &&
    typeof event.notes === "string" &&
    (reminder === undefined || reminder === null ||
      (typeof reminder === "number" && [0, 5, 15, 30, 60, 1440].includes(reminder)))
  );
}

export function isDashboardData(value: unknown): value is DashboardData {
  if (typeof value !== "object" || value === null) return false;
  const data = value as Record<string, unknown>;
  if (
    !Array.isArray(data.projects) ||
    !data.projects.every(isProject) ||
    !Array.isArray(data.tasks) ||
    !data.tasks.every(isTask) ||
    !Array.isArray(data.calendarEvents) ||
    !data.calendarEvents.every(isCalendarEvent) ||
    typeof data.projectSpaces !== "object" ||
    data.projectSpaces === null ||
    Array.isArray(data.projectSpaces)
  ) {
    return false;
  }
  const projectSpaces = data.projectSpaces as Record<string, unknown>;
  return data.projects.every((project) => isProjectSpace(projectSpaces[String(project.id)]));
}

export function normalizeDashboardData(data: DashboardData): DashboardData {
  return {
    ...data,
    projectSpaces: Object.fromEntries(
      Object.entries(data.projectSpaces).map(([id, space]) => [id, { ...space, links: space.links ?? [] }]),
    ),
  };
}
