import { test } from "node:test";
import assert from "node:assert/strict";


const sync = await import("../src/data-sync.ts");
const insights = await import("../src/insights.ts");
const items = await import("../api/_lib/items.ts");
const device = await import("../api/_lib/device.ts");

const project = (id: string, name: string, extra = {}) => ({ id, name, description: "", due: "No date", progress: 40, tasks: 0, color: "mint", symbol: "✳", ...extra });
const task = (id: string, title: string, projectName: string, extra = {}) => ({ id, title, project: projectName, due: "No date", priority: "Medium", done: false, initials: "AB", ...extra });
const data = (projects: unknown[], tasks: unknown[]) => ({
  projects,
  tasks,
  calendarEvents: [],
  projectSpaces: Object.fromEntries((projects as { id: string }[]).map((p) => [p.id, { notes: [], sprints: [], meetings: [], links: [] }])),
});

test("merge keeps unsaved local edits and takes remote edits elsewhere", () => {
  const base = data([project("p1", "Alpha")], [task("t1", "One", "Alpha"), task("t2", "Two", "Alpha")]);
  const baseline = sync.dashboardToWorkspaceItems(base);
  const local = data([project("p1", "Alpha")], [task("t1", "One (local edit)", "Alpha"), task("t2", "Two", "Alpha")]);
  const remote = sync.dashboardToWorkspaceItems(data([project("p1", "Alpha")], [task("t1", "One", "Alpha"), task("t2", "Two (remote edit)", "Alpha"), task("t3", "Three (remote new)", "Alpha")]));
  const merged = sync.mergeRemoteDashboard(local, baseline, remote);
  const titles = merged.tasks.map((t: { title: string }) => t.title).sort();
  assert.deepEqual(titles, ["One (local edit)", "Three (remote new)", "Two (remote edit)"]);
});

test("merge applies remote deletes of untouched items", () => {
  const base = data([project("p1", "Alpha")], [task("t1", "One", "Alpha")]);
  const baseline = sync.dashboardToWorkspaceItems(base);
  const remote = sync.dashboardToWorkspaceItems(data([project("p1", "Alpha")], []));
  assert.equal(sync.mergeRemoteDashboard(base, baseline, remote).tasks.length, 0);
});

test("diff sends only changed items", () => {
  const before = sync.dashboardToWorkspaceItems(data([project("p1", "Alpha")], [task("t1", "One", "Alpha")]));
  const after = sync.dashboardToWorkspaceItems(data([project("p1", "Alpha")], [task("t1", "One", "Alpha", { done: true, completedAt: "2026-11-23T10:00:00Z" })]));
  const { upserts, deletes } = sync.diffWorkspaceItems(before, after);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].id, "t1");
  assert.equal(deletes.length, 0);
});

test("server rejects malformed or mismatched sync items", () => {
  const good = { entity_type: "task", id: "t1", project_id: null, payload: task("t1", "One", "Alpha") };
  assert.equal(items.parseSyncBatch({ upserts: [good], deletes: [] }).upserts.length, 1);
  assert.throws(() => items.parseSyncBatch({ upserts: [{ ...good, id: "other" }], deletes: [] }), /invalid format/);
  assert.throws(() => items.parseSyncBatch({ upserts: [{ ...good, payload: { id: "t1" } }], deletes: [] }), /invalid format/);
  assert.throws(() => items.parseSyncBatch({ upserts: [], deletes: [{ entity_type: "users", id: "x" }] }), /invalid format/);
  const badLink = { entity_type: "project_link", id: "l1", project_id: "p1", payload: { id: "l1", label: "x", url: "javascript:alert(1)", addedAt: "" } };
  assert.throws(() => items.parseSyncBatch({ upserts: [badLink], deletes: [] }), /invalid format/);
  assert.equal(items.summarizeChanges([good, good], [{ entity_type: "note", id: "n" }]), "Changed 2 tasks and 1 note.");
});

test("invite codes normalize however they're typed", () => {
  const code = device.newInviteCode();
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(device.normalizeInviteCode(code.toLowerCase().replace(/-/g, " ")), code);
  assert.throws(() => device.normalizeInviteCode("short"));
});

test("due dates: ISO and legacy text both parse; tones are right", () => {
  const today = insights.localDateKey(new Date());
  const yesterday = insights.localDateKey(new Date(Date.now() - 86_400_000));
  assert.equal(insights.isoDate("Today"), today);
  assert.equal(insights.isoDate("2026-02-30"), null);
  assert.equal(insights.isoDate("2026-02-28"), "2026-02-28");
  assert.equal(insights.isoDate("Nov 28, 2026"), "2026-11-28");
  assert.equal(insights.isoDate("No date"), null);
  assert.equal(insights.dueTone(today), "today");
  assert.equal(insights.dueTone(yesterday), "overdue");
  assert.equal(insights.dueLabel(yesterday), "Yesterday");
  assert.equal(insights.dueLabel("No date"), "No date");
});

test("progress is derived from tasks once a project has any", () => {
  const p = project("p1", "Alpha", { progress: 90 });
  assert.deepEqual(insights.projectProgress(p, []), { value: 90, derived: false, done: 0, total: 0 });
  const tasks = [task("t1", "a", "Alpha", { done: true }), task("t2", "b", "Alpha"), task("t3", "c", "Alpha"), task("t4", "d", "Other", { done: true })];
  assert.equal(insights.projectProgress(p, tasks).value, 33);
});

test("weekly completions count only this week's completed tasks", () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const result = insights.weeklyCompletions([
    task("a", "a", "x", { done: true, completedAt: now }),
    task("b", "b", "x", { done: true, completedAt: old }),
    task("c", "c", "x", { done: false, completedAt: now }),
  ]);
  assert.equal(result.total, 1);
  assert.equal(result.counts[result.today], 1);
});

test("next milestone ignores the past and finished sprints", () => {
  const future = insights.localDateKey(new Date(Date.now() + 5 * 86_400_000));
  const later = insights.localDateKey(new Date(Date.now() + 9 * 86_400_000));
  const d = data([project("p1", "Alpha", { due: later })], []);
  d.projectSpaces.p1.sprints.push(
    { id: "s0", name: "Old sprint", goal: "", startDate: "2020-01-01", endDate: future, status: "Completed" },
    { id: "s1", name: "Past", goal: "", startDate: "2020-01-01", endDate: "2020-01-14", status: "Active" },
  );
  const m = insights.nextMilestone(d);
  assert.equal(m?.title, "Alpha due");
  assert.equal(m?.countdown, "9 days to go");
});
