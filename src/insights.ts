import type { DashboardData, Project, Task } from "./project-types";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_MS = 24 * 60 * 60 * 1000;

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Turns a stored due value into YYYY-MM-DD, or null if it isn't a date.
 * New data is stored as YYYY-MM-DD; older data may say "Today", "Tomorrow",
 * or "Nov 28", which is still understood.
 */
export function isoDate(due: string): string | null {
  const value = due.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return localDateKey(fromKey(value)) === value ? value : null; // rejects Feb 30 etc.
  const today = new Date();
  if (/^today$/i.test(value)) return localDateKey(today);
  if (/^tomorrow$/i.test(value)) return localDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const match = value.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3] ?? today.getFullYear());
  const parsed = new Date(year, month, day);
  if (parsed.getMonth() !== month || parsed.getDate() !== day) return null;
  return localDateKey(parsed);
}

function daysFromToday(key: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((fromKey(key).getTime() - today.getTime()) / DAY_MS);
}

export type DueTone = "overdue" | "today" | "soon" | "later" | "none";

export function dueTone(due: string): DueTone {
  const key = isoDate(due);
  if (!key) return "none";
  const days = daysFromToday(key);
  return days < 0 ? "overdue" : days === 0 ? "today" : days <= 3 ? "soon" : "later";
}

export function shortDate(key: string): string {
  const date = fromKey(key);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }).format(date);
}

export function dueLabel(due: string): string {
  const key = isoDate(due);
  if (!key) return due || "No date";
  const days = daysFromToday(key);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return shortDate(key);
}

/**
 * Business rule: once a project has tasks, its progress is the share of tasks
 * done, so it can't drift from reality. A project with no tasks yet uses the
 * manual "pulse" slider.
 */
export function projectProgress(project: Project, tasks: Task[]): { value: number; derived: boolean; done: number; total: number } {
  const own = tasks.filter((task) => task.project === project.name);
  const done = own.filter((task) => task.done).length;
  if (own.length === 0) return { value: Math.max(0, Math.min(100, Math.round(project.progress))), derived: false, done, total: 0 };
  return { value: Math.round((done / own.length) * 100), derived: true, done, total: own.length };
}

/** Tasks completed on each day of the current Monday-to-Sunday week. */
export function weeklyCompletions(tasks: Task[]): { counts: number[]; total: number; today: number } {
  const now = new Date();
  const today = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - today);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const task of tasks) {
    if (!task.done || !task.completedAt) continue;
    const completed = new Date(task.completedAt);
    const index = Math.floor((new Date(completed.getFullYear(), completed.getMonth(), completed.getDate()).getTime() - monday.getTime()) / DAY_MS);
    if (index >= 0 && index < 7) counts[index] += 1;
  }
  return { counts, total: counts.reduce((sum, count) => sum + count, 0), today };
}

export type Milestone = { title: string; date: string; dateLabel: string; countdown: string };

/** The soonest upcoming dated thing: a project deadline, sprint end, meeting, or event. */
export function nextMilestone(data: DashboardData): Milestone | null {
  const candidates: { title: string; date: string }[] = [];
  for (const project of data.projects) {
    const due = isoDate(project.due);
    if (due) candidates.push({ title: `${project.name} due`, date: due });
    const space = data.projectSpaces[String(project.id)];
    for (const sprint of space?.sprints ?? []) {
      if (sprint.status !== "Completed" && sprint.endDate) candidates.push({ title: `${sprint.name} ends`, date: sprint.endDate });
    }
    for (const meeting of space?.meetings ?? []) candidates.push({ title: meeting.title, date: meeting.date });
  }
  for (const event of data.calendarEvents) candidates.push({ title: event.title, date: event.date });

  const upcoming = candidates
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && daysFromToday(item.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!upcoming) return null;
  const days = daysFromToday(upcoming.date);
  return {
    ...upcoming,
    dateLabel: shortDate(upcoming.date),
    countdown: days === 0 ? "today" : days === 1 ? "tomorrow" : `${days} days to go`,
  };
}
