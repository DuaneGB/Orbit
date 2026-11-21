export type EntityId = string | number;

export type Project = {
  id: EntityId;
  name: string;
  description: string;
  due: string;
  progress: number;
  tasks: number;
  color: string;
  symbol: string;
};

export type Task = {
  id: EntityId;
  title: string;
  project: string;
  due: string;
  priority: "High" | "Medium" | "Low";
  done: boolean;
  initials: string;
};

export type ProjectNote = {
  id: EntityId;
  title: string;
  body: string;
  updatedAt: string;
};

export type SprintStatus = "Planning" | "Active" | "Completed";

export type ProjectSprint = {
  id: EntityId;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
};

export type ProjectMeeting = {
  id: EntityId;
  title: string;
  date: string;
  time: string;
  attendees: string;
  notes: string;
};

export type ProjectSpace = {
  notes: ProjectNote[];
  sprints: ProjectSprint[];
  meetings: ProjectMeeting[];
  links: ProjectLink[];
};

export type ProjectLink = {
  id: EntityId;
  label: string;
  url: string;
  addedAt: string;
};

export type CalendarEvent = {
  id: EntityId;
  title: string;
  date: string;
  time: string;
  project: string;
  notes: string;
  reminderMinutesBefore?: number | null;
};

export type DashboardData = {
  projects: Project[];
  tasks: Task[];
  projectSpaces: Record<string, ProjectSpace>;
  calendarEvents: CalendarEvent[];
};

export type ProjectTab = "Overview" | "Tasks" | "Notes" | "Sprints" | "Meetings" | "Links";
