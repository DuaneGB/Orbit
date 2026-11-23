import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type SetStateAction } from "react";
import { Icon, type IconName } from "./Icon";
import CalendarView from "./CalendarView";
import ProjectWorkspace from "./ProjectWorkspace";
import AppsView, { useHostedApps } from "./AppsView";
import { ActivityBell } from "./ActivityPanel";
import type { CalendarEvent, DashboardData, EntityId, Project, ProjectSpace, Task } from "./project-types";
import { isDashboardData, normalizeDashboardData } from "./data-validation";
import { CollaborationGate, WorkspaceSettings, type CollaborationContext } from "./Collaboration";
import { useWorkspaceSync, type SyncStatus } from "./useWorkspaceSync";
import { dueLabel, dueTone, isoDate, nextMilestone, projectProgress, weeklyCompletions } from "./insights";

type ViewName = "Overview" | "Projects" | "My tasks" | "Calendar" | "Apps" | "Workspace";

/** Where Orbit kept data before shared workspaces. Offered for import when creating one. */
const LEGACY_STORAGE_KEY = "orbit-dashboard-v1";
const BACKUP_FORMAT = "orbit-dashboard-backup";

function emptyProjectSpace(): ProjectSpace {
  return { notes: [], sprints: [], meetings: [], links: [] };
}

function emptyDashboard(): DashboardData {
  return { projects: [], tasks: [], projectSpaces: {}, calendarEvents: [] };
}

function parseBackup(value: unknown): DashboardData | null {
  if (typeof value !== "object" || value === null) return null;
  const backup = value as Record<string, unknown>;
  return backup.format === BACKUP_FORMAT && backup.version === 1 && isDashboardData(backup.data)
    ? normalizeDashboardData(backup.data)
    : null;
}

function loadLegacyData(): DashboardData | null {
  try {
    const saved = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = { calendarEvents: [], projectSpaces: {}, ...parsed } as Record<string, unknown>;
    const spaces = candidate.projectSpaces as Record<string, unknown>;
    if (Array.isArray(candidate.projects)) {
      for (const project of candidate.projects as Project[]) spaces[String(project.id)] ??= emptyProjectSpace();
    }
    return isDashboardData(candidate) ? normalizeDashboardData(candidate) : null;
  } catch (error) {
    console.error("Could not read Orbit data saved in this browser.", error);
    return null;
  }
}

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "OR").slice(0, 2)).toUpperCase();
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const SYNC_LABEL: Record<SyncStatus, string> = {
  loading: "Connecting…",
  synced: "Synced",
  saving: "Saving…",
  offline: "Offline",
  error: "Not synced",
};

function Dashboard({ collaboration }: { collaboration: CollaborationContext }) {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const { projects, tasks, projectSpaces, calendarEvents } = dashboard;
  const sync = useWorkspaceSync(collaboration.workspace.id, dashboard, setDashboard);
  const setProjects = (update: SetStateAction<Project[]>) => {
    setDashboard((current) => ({ ...current, projects: typeof update === "function" ? update(current.projects) : update }));
  };
  const setTasks = (update: SetStateAction<Task[]>) => {
    setDashboard((current) => ({ ...current, tasks: typeof update === "function" ? update(current.tasks) : update }));
  };
  const setProjectSpaces = (update: SetStateAction<Record<string, ProjectSpace>>) => {
    setDashboard((current) => ({ ...current, projectSpaces: typeof update === "function" ? update(current.projectSpaces) : update }));
  };
  const setCalendarEvents = (update: SetStateAction<CalendarEvent[]>) => {
    setDashboard((current) => ({ ...current, calendarEvents: typeof update === "function" ? update(current.calendarEvents) : update }));
  };
  const [activeView, setActiveView] = useState<ViewName>("Overview");
  const [selectedProjectId, setSelectedProjectId] = useState<EntityId | null>(null);
  const [taskFilter, setTaskFilter] = useState<"All tasks" | "To do" | "Completed">("To do");
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState<"task" | "project" | null>(null);
  const [taskProjectDefault, setTaskProjectDefault] = useState("");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<EntityId | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [undo, setUndo] = useState<{ message: string; restore: () => void } | null>(null);
  const [backupNotice, setBackupNotice] = useState<{ message: string; error: boolean } | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedProject = selectedProjectId === null ? undefined : projects.find((project) => project.id === selectedProjectId);
  const hosted = useHostedApps(activeView === "Apps" || Boolean(selectedProject?.vercelProjectIds?.length));
  const myInitials = initials(collaboration.device.name);

  // ⌘K / Ctrl+K focuses search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleProjects = useMemo(
    () => projects.filter((project) => `${project.name} ${project.description}`.toLowerCase().includes(normalizedQuery)),
    [projects, normalizedQuery],
  );
  const visibleTasks = useMemo(
    () => tasks
      .filter((task) => {
        const matchesQuery = `${task.title} ${task.project}`.toLowerCase().includes(normalizedQuery);
        const matchesFilter = taskFilter === "All tasks" || (taskFilter === "To do" && !task.done) || (taskFilter === "Completed" && task.done);
        return matchesQuery && matchesFilter;
      })
      .sort((a, b) => Number(a.done) - Number(b.done) || (isoDate(a.due) ?? "9999").localeCompare(isoDate(b.due) ?? "9999")),
    [normalizedQuery, taskFilter, tasks],
  );
  const openTasks = tasks.filter((task) => !task.done).length;
  const overdueTasks = tasks.filter((task) => !task.done && dueTone(task.due) === "overdue").length;
  const week = useMemo(() => weeklyCompletions(tasks), [tasks]);
  const milestone = useMemo(() => nextMilestone(dashboard), [dashboard]);
  const selectedProjectSpace = selectedProject ? projectSpaces[String(selectedProject.id)] ?? emptyProjectSpace() : undefined;

  const pageTitle: Record<ViewName, string> = {
    Overview: greeting(),
    Projects: "Your projects",
    "My tasks": "Your task list",
    Calendar: "Coming up",
    Apps: "Hosted apps",
    Workspace: "Workspace",
  };
  const pageDescription: Record<ViewName, string> = {
    Overview: "Here's where every project stands across the team.",
    Projects: "All the things you're making happen, in one place.",
    "My tasks": "Small steps, big picture. Pick up where you left off.",
    Calendar: "Stay a step ahead of what's on the horizon.",
    Apps: "",
    Workspace: "",
  };

  function toggleTask(id: EntityId) {
    setTasks((current) => current.map((task) => {
      if (task.id !== id) return task;
      const done = !task.done;
      const { completedAt: _previous, ...rest } = task;
      return done ? { ...rest, done, completedAt: new Date().toISOString() } : { ...rest, done };
    }));
  }

  function deleteTask(task: Task) {
    const index = tasks.findIndex((item) => item.id === task.id);
    setTasks((current) => current.filter((item) => item.id !== task.id));
    setUndo({
      message: `Deleted “${task.title}”.`,
      restore: () => setTasks((current) => {
        const next = [...current];
        next.splice(Math.max(0, index), 0, task);
        return next;
      }),
    });
  }

  function closeComposer() {
    setComposer(null);
    setEditingProject(null);
    setEditingTask(null);
  }

  function openTaskComposer(projectName = "", task?: Task) {
    setTaskProjectDefault(task?.project ?? projectName);
    setEditingTask(task ?? null);
    setComposer("task");
  }

  function openProjectComposer(project?: Project) {
    setEditingProject(project ?? null);
    setComposer("project");
    setOpenProjectMenuId(null);
  }

  function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const project = String(form.get("project") ?? "");
    const due = String(form.get("due") ?? "").trim() || "No date";
    const priorityValue = String(form.get("priority") ?? "Medium");
    const priority: Task["priority"] = priorityValue === "High" || priorityValue === "Low" ? priorityValue : "Medium";
    if (!title) return;
    if (editingTask) {
      setTasks((current) => current.map((task) => task.id === editingTask.id ? { ...task, title, project: project || "Personal", due, priority } : task));
    } else {
      setTasks((current) => [
        { id: crypto.randomUUID(), title, project: project || "Personal", due, priority, done: false, initials: myInitials },
        ...current,
      ]);
    }
    closeComposer();
  }

  function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const due = String(form.get("due") ?? "").trim() || "No date";
    if (!name) return;
    const duplicate = projects.some((project) => project.name.toLowerCase() === name.toLowerCase() && project.id !== editingProject?.id);
    if (duplicate) {
      window.alert(`A project called “${name}” already exists. Project names must be unique so tasks file under the right one.`);
      return;
    }
    if (editingProject) {
      setProjects((current) => current.map((project) => project.id === editingProject.id
        ? { ...project, name, description: description || editingProject.description, due }
        : project));
      if (name !== editingProject.name) {
        setTasks((current) => current.map((task) => task.project === editingProject.name ? { ...task, project: name } : task));
        setCalendarEvents((current) => current.map((item) => item.project === editingProject.name ? { ...item, project: name } : item));
      }
      closeComposer();
      return;
    }

    const colors = ["lilac", "peach", "mint", "sky"];
    const symbols = ["✳", "↗", "◈", "✦"];
    const id = crypto.randomUUID();
    setProjects((current) => [
      ...current,
      {
        id,
        name,
        description: description || "A new idea taking shape.",
        due,
        progress: 0,
        tasks: 0,
        color: colors[current.length % colors.length],
        symbol: symbols[current.length % symbols.length],
      },
    ]);
    setProjectSpaces((current) => ({ ...current, [id]: emptyProjectSpace() }));
    closeComposer();
  }

  function confirmDeleteProject() {
    if (!deletingProject) return;
    const { id: projectId, name: projectName } = deletingProject;
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setTasks((current) => current.filter((task) => task.project !== projectName));
    setProjectSpaces((current) => {
      const next = { ...current };
      delete next[String(projectId)];
      return next;
    });
    if (selectedProjectId === projectId) setSelectedProjectId(null);
    setDeletingProject(null);
  }

  function updateProjectSpace(projectId: EntityId, update: (space: ProjectSpace) => ProjectSpace) {
    setProjectSpaces((current) => {
      const key = String(projectId);
      return { ...current, [key]: update(current[key] ?? emptyProjectSpace()) };
    });
  }

  /** An app belongs to at most one Orbit project. */
  function linkApp(appId: string, projectId: EntityId | null) {
    setProjects((current) => current.map((project) => {
      const ids = (project.vercelProjectIds ?? []).filter((id) => id !== appId);
      if (project.id === projectId) ids.push(appId);
      const { vercelProjectIds: _old, ...rest } = project;
      return ids.length ? { ...rest, vercelProjectIds: ids } : rest;
    }));
  }

  function addCalendarEvent(event: Omit<CalendarEvent, "id">) {
    setCalendarEvents((current) => [...current, { ...event, id: crypto.randomUUID() }].sort((a, b) => a.date.localeCompare(b.date)));
  }

  function updateCalendarEvent(id: EntityId, event: Omit<CalendarEvent, "id">) {
    setCalendarEvents((current) => current.map((item) => item.id === id ? { ...event, id } : item).sort((a, b) => a.date.localeCompare(b.date)));
  }

  function deleteCalendarEvent(id: EntityId) {
    setCalendarEvents((current) => current.filter((event) => event.id !== id));
  }

  function exportBackup() {
    try {
      const backup = {
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        workspace: collaboration.workspace.name,
        data: { projects, tasks, projectSpaces, calendarEvents },
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `orbit-${collaboration.workspace.name.replace(/[^\w-]+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setBackupNotice({ message: "Backup downloaded. Keep the JSON file somewhere safe.", error: false });
    } catch (error) {
      console.error("Could not export Orbit data.", error);
      setBackupNotice({ message: "The backup could not be downloaded.", error: true });
    }
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const backup = parseBackup(JSON.parse(await file.text()) as unknown);
      if (!backup) {
        setBackupNotice({ message: "That file is not a valid Orbit backup.", error: true });
        return;
      }
      if (!window.confirm(
        `Restore this backup into “${collaboration.workspace.name}”?\n\nIt replaces the shared data for EVERY device in this workspace. ` +
        "Download a backup of the current data first if you might need it.",
      )) return;
      setDashboard(backup);
      setSelectedProjectId(null);
      setActiveView("Overview");
      setBackupNotice({ message: "Backup restored and shared with every device.", error: false });
    } catch (error) {
      console.error("Could not restore Orbit data.", error);
      setBackupNotice({ message: "The backup file could not be read.", error: true });
    }
  }

  function goTo(view: ViewName) {
    setSelectedProjectId(null);
    setActiveView(view);
  }

  function openProject(project: Project) {
    setActiveView("Projects");
    setSelectedProjectId(project.id);
  }

  const showProjects = activeView === "Overview" || activeView === "Projects";
  const showTasks = activeView === "Overview" || activeView === "My tasks";
  const maxWeek = Math.max(1, ...week.counts);

  if (!sync.ready) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>{sync.error ? "Couldn't load the shared workspace" : "Syncing your workspace…"}</h1>
          <p>{sync.error || "Loading your projects and the latest teammate updates."}</p>
          {sync.error && <button className="button button-primary" onClick={sync.retry} type="button">Retry connection</button>}
        </section>
      </main>
    );
  }

  const backupTools = (
    <div className="backup-toolbar">
      <div className="backup-copy">
        <strong>Download or restore a backup</strong>
        <span>A JSON copy of every project, task, note, sprint, meeting, and event in this workspace.</span>
      </div>
      <div className="backup-actions">
        <button className="button button-secondary" onClick={exportBackup} type="button">Download backup</button>
        <button className="button button-secondary" onClick={() => backupInputRef.current?.click()} type="button">Restore backup</button>
        <input accept="application/json,.json" hidden onChange={importBackup} ref={backupInputRef} type="file" />
      </div>
      {backupNotice && <p className={`backup-notice ${backupNotice.error ? "backup-notice-error" : ""}`} role={backupNotice.error ? "alert" : "status"}>{backupNotice.message}</p>}
    </div>
  );

  const taskRow = (task: Task, showProject = true) => (
    <article className={`task-row ${task.done ? "task-done" : ""}`} key={task.id}>
      <button className={`task-check ${task.done ? "checked" : ""}`} type="button" aria-label={task.done ? `Mark ${task.title} as not done` : `Complete ${task.title}`} aria-pressed={task.done} onClick={() => toggleTask(task.id)}>
        {task.done && <Icon name="check" size={14} />}
      </button>
      <button className="task-main task-main-button" onClick={() => openTaskComposer("", task)} type="button"><strong>{task.title}</strong>{showProject && <span>{task.project}</span>}</button>
      <span className={`priority priority-${task.priority.toLowerCase()}`}><i />{task.priority}</span>
      <span className={`task-due due-${task.done ? "none" : dueTone(task.due)}`}><Icon name="clock" size={15} />{dueLabel(task.due)}</span>
      <span className="avatar task-avatar">{task.initials}</span>
      <button aria-label={`Delete ${task.title}`} className="icon-button task-delete" onClick={() => deleteTask(task)} type="button"><Icon name="trash" size={15} /></button>
    </article>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); goTo("Overview"); }}>
          <span className="brand-mark"><span /></span>
          <span>orbit<span className="brand-period">.</span></span>
        </a>

        <button className="workspace-switcher" onClick={() => goTo("Workspace")} type="button">
          <div className="workspace-avatar">{initials(collaboration.workspace.name).slice(0, 1)}</div>
          <div className="workspace-copy">
            <span className="eyebrow">WORKSPACE</span>
            <strong>{collaboration.workspace.name}</strong>
          </div>
          <Icon name="settings" size={16} />
        </button>

        <span className="nav-label">WORKSPACE</span>
        <nav className="primary-nav" aria-label="Main navigation">
          {([
            ["Overview", "grid"],
            ["Projects", "layers"],
            ["My tasks", "check"],
            ["Calendar", "calendar"],
            ["Apps", "globe"],
            ["Workspace", "settings"],
          ] as [ViewName, IconName][]).map(([label, icon]) => (
            <button className={`nav-item ${activeView === label && !selectedProject ? "active" : ""}`} key={label} onClick={() => goTo(label)} type="button">
              <Icon name={icon} size={19} />
              <span>{label === "Apps" ? "Hosted apps" : label}</span>
              {label === "My tasks" && <span className="nav-count">{openTasks}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-projects">
          <div className="sidebar-section-heading">
            <span className="nav-label">PROJECTS</span>
            <button className="icon-button sidebar-add" type="button" aria-label="Add project" onClick={() => openProjectComposer()}>
              <Icon name="plus" size={16} />
            </button>
          </div>
          {projects.slice(0, 6).map((project) => (
            <button className={`project-shortcut ${selectedProjectId === project.id ? "active" : ""}`} key={project.id} onClick={() => openProject(project)} type="button">
              <span className={`project-dot ${project.color}`} />
              <span>{project.name}</span>
            </button>
          ))}
          {projects.length > 6 && <button className="project-shortcut" onClick={() => goTo("Projects")} type="button"><span className="project-dot" /><span>All {projects.length} projects</span></button>}
        </div>

        <div className="sidebar-bottom">
          <button className="profile-button" onClick={() => goTo("Workspace")} type="button">
            <span className="avatar avatar-you">{myInitials}</span>
            <span className="profile-copy"><strong>{collaboration.device.name}</strong><small>{collaboration.device.role === "owner" ? "Owner" : "Member"}</small></span>
            <Icon name="dots" size={19} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>{collaboration.workspace.name}</span><span className="breadcrumb-slash">/</span><strong>{selectedProject?.name ?? (activeView === "Apps" ? "Hosted apps" : activeView)}</strong></div>
          <div className="topbar-actions">
            <button className={`sync-pill sync-${sync.status}`} onClick={sync.refresh} title={sync.lastSyncedAt ? `Last synced ${sync.lastSyncedAt.toLocaleTimeString()}` : undefined} type="button">
              <i />{SYNC_LABEL[sync.status]}
            </button>
            <label className="search-box">
              <Icon name="search" size={17} />
              <input aria-label="Search projects and tasks" placeholder="Search anything..." ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); if (activeView !== "Overview" && activeView !== "Projects" && activeView !== "My tasks") goTo("Overview"); }} />
              <kbd>{navigator.platform.includes("Mac") ? "⌘ K" : "Ctrl K"}</kbd>
            </label>
            <ActivityBell revisionHint={dashboard} />
            <span className="avatar avatar-you top-avatar" title={collaboration.device.name}>{myInitials}</span>
          </div>
        </header>

        <div className="page-content">
          {sync.error && (
            <div className="sync-warning" role="alert">
              <span>{sync.error}</span>
              <button className="inline-action" onClick={sync.refresh} type="button">Try again <Icon name="arrow" size={14} /></button>
            </div>
          )}
          {selectedProject && selectedProjectSpace ? (
            <ProjectWorkspace
              hostedApps={(hosted.data?.apps ?? []).filter((app) => selectedProject.vercelProjectIds?.includes(app.id))}
              onAddTask={() => openTaskComposer(selectedProject.name)}
              onBack={() => setSelectedProjectId(null)}
              onBrowseApps={() => goTo("Apps")}
              onDeleteTask={deleteTask}
              onEditTask={(task) => openTaskComposer("", task)}
              onProgressChange={(progress) => setProjects((current) => current.map((project) => project.id === selectedProject.id ? { ...project, progress } : project))}
              onToggleTask={toggleTask}
              onUpdateSpace={(update) => updateProjectSpace(selectedProject.id, update)}
              progress={projectProgress(selectedProject, tasks)}
              project={selectedProject}
              space={selectedProjectSpace}
              tasks={tasks.filter((task) => task.project === selectedProject.name)}
            />
          ) : activeView === "Calendar" ? (
            <CalendarView
              calendarEvents={calendarEvents}
              onAddEvent={addCalendarEvent}
              onDeleteEvent={deleteCalendarEvent}
              onToggleTask={toggleTask}
              onUpdateEvent={updateCalendarEvent}
              projectSpaces={projectSpaces}
              projects={projects}
              tasks={tasks}
            />
          ) : activeView === "Apps" ? (
            <AppsView hosted={hosted} onLinkApp={linkApp} projects={projects} />
          ) : activeView === "Workspace" ? (
            <WorkspaceSettings {...collaboration} backupTools={backupTools} onSynced={sync.refresh} />
          ) : (
            <>
              <section className="welcome-row">
                <div>
                  <div className="date-line"><span className="date-dot" />{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</div>
                  <h1>{pageTitle[activeView]}<span className="heading-period">.</span></h1>
                  <p className="welcome-description">{pageDescription[activeView]}</p>
                </div>
                <div className="welcome-actions">
                  <button className="button button-secondary" type="button" onClick={() => openTaskComposer()}><Icon name="plus" size={17} /> Add a task</button>
                  <button className="button button-primary" type="button" onClick={() => openProjectComposer()}><Icon name="plus" size={17} /> New project</button>
                </div>
              </section>

              {activeView === "Overview" && (
                <>
                  <section className="stats-grid" aria-label="Workspace summary">
                    <article className="stat-card stat-card-lavender">
                      <div className="stat-top"><span>In motion</span><span className="stat-icon"><Icon name="layers" size={18} /></span></div>
                      <div className="stat-value">{projects.length}<span className="stat-unit"> projects</span></div>
                      <div className="stat-note">{projects.filter((project) => projectProgress(project, tasks).value >= 100).length} complete</div>
                      <span className="stat-decoration decoration-rings" />
                    </article>
                    <article className="stat-card stat-card-peach">
                      <div className="stat-top"><span>On the plate</span><span className="stat-icon"><Icon name="check" size={18} /></span></div>
                      <div className="stat-value">{openTasks}<span className="stat-unit"> open tasks</span></div>
                      <div className="stat-note">{overdueTasks > 0 ? <span className="stat-note-strong due-overdue-text">{overdueTasks} overdue</span> : <span className="stat-note-strong">Nothing overdue</span>}</div>
                      <span className="stat-decoration decoration-sun" />
                    </article>
                    <article className="stat-card stat-card-mint">
                      <div className="stat-top"><span>Next milestone</span><span className="stat-icon"><Icon name="calendar" size={18} /></span></div>
                      <div className="stat-value stat-value-date">{milestone ? milestone.dateLabel : "—"}</div>
                      <div className="stat-note">{milestone ? <><span className="stat-note-strong">{milestone.title}</span> · {milestone.countdown}</> : "Add dates to sprints, meetings, or events"}</div>
                      <span className="stat-decoration decoration-spark">✳</span>
                    </article>
                  </section>

                  <section className="weekly-card">
                    <div className="weekly-copy">
                      <span className="weekly-kicker"><Icon name="spark" size={15} /> THIS WEEK, ACROSS THE TEAM</span>
                      <h2>{week.total > 0 ? "Look at you, making progress." : "A fresh week to fill."}</h2>
                      <p>{week.total > 0 ? <>The team has completed <strong>{week.total} task{week.total === 1 ? "" : "s"}</strong> since Monday.</> : "Tick off a task and it shows up here."}</p>
                    </div>
                    <div className="week-visual" aria-label={`${week.total} tasks completed this week`}>
                      <div className="week-bars">
                        {week.counts.map((count, index) => (
                          <div className="week-bar-column" key={index} title={`${count} done`}>
                            <span className={`week-bar ${index === week.today ? "week-bar-today" : ""}`} style={{ height: `${Math.max(6, (count / maxWeek) * 100)}%` }} />
                            <span className="week-day">{["M", "T", "W", "T", "F", "S", "S"][index]}</span>
                          </div>
                        ))}
                      </div>
                      <div className="week-total"><strong>{week.total}</strong><span>done</span></div>
                    </div>
                  </section>
                </>
              )}

              {showProjects && (
                <section className="content-section">
                  <div className="section-heading">
                    <div><h2>{activeView === "Projects" ? "All projects" : "In the works"}</h2><p>The big ideas and the steps getting you there.</p></div>
                    {activeView !== "Projects" && <button className="text-button" type="button" onClick={() => goTo("Projects")}>See all <Icon name="arrow" size={15} /></button>}
                  </div>
                  <div className="project-grid">
                    {(activeView === "Overview" ? visibleProjects.slice(0, 7) : visibleProjects).map((project) => {
                      const progress = projectProgress(project, tasks);
                      const taskCount = tasks.filter((task) => task.project === project.name).length;
                      return (
                        <article className={`project-card project-${project.color} ${openProjectMenuId === project.id ? "project-card-menu-open" : ""}`} key={project.id}>
                          <div className="project-menu-anchor">
                            <button aria-expanded={openProjectMenuId === project.id} aria-haspopup="menu" aria-label={`More options for ${project.name}`} className="icon-button card-menu" onClick={() => setOpenProjectMenuId((current) => current === project.id ? null : project.id)} type="button">
                              <Icon name="dots" size={19} />
                            </button>
                            {openProjectMenuId === project.id && (
                              <div className="project-menu" role="menu">
                                <button onClick={() => openProjectComposer(project)} role="menuitem" type="button">Edit project</button>
                                <button className="project-menu-danger" onClick={() => { setOpenProjectMenuId(null); setDeletingProject(project); }} role="menuitem" type="button">Delete project</button>
                              </div>
                            )}
                          </div>
                          <button className="project-card-open" onClick={() => openProject(project)} type="button">
                            <span className={`project-symbol symbol-${project.color}`}>{project.symbol}</span>
                            <span className="project-card-title-row"><span className="project-card-title">{project.name}</span><Icon name="arrow" size={14} /></span>
                            <span className="project-description">{project.description}</span>
                            <span className="project-progress-label"><span>{progress.derived ? "Tasks done" : "Progress"}</span><strong>{progress.value}%</strong></span>
                            <span className="progress-track"><span style={{ width: `${progress.value}%` }} /></span>
                            <span className="project-card-footer">
                              <span><Icon name="check" size={14} /> {taskCount} task{taskCount === 1 ? "" : "s"}</span>
                              {(project.vercelProjectIds?.length ?? 0) > 0 && <span><Icon name="globe" size={14} /> {project.vercelProjectIds!.length}</span>}
                              <span className={`due-${dueTone(project.due)}`}><Icon name="calendar" size={14} /> {dueLabel(project.due)}</span>
                            </span>
                          </button>
                        </article>
                      );
                    })}
                    <button className="project-add-card" type="button" onClick={() => openProjectComposer()}>
                      <span className="add-card-icon"><Icon name="plus" size={19} /></span>
                      <strong>Start something new</strong>
                      <span>Every good thing starts somewhere.</span>
                    </button>
                  </div>
                  {normalizedQuery && visibleProjects.length === 0 && <p className="empty-state">No projects match “{query}”. Try another search.</p>}
                </section>
              )}

              {showTasks && (
                <section className="content-section task-section">
                  <div className="section-heading task-heading">
                    <div><h2>{activeView === "My tasks" ? "Everything on the list" : "A good place to start"}</h2><p>Sorted by due date. Click a task to edit it.</p></div>
                    <div className="task-filters" role="tablist" aria-label="Filter tasks">
                      {(["To do", "Completed", "All tasks"] as const).map((filter) => (
                        <button aria-selected={taskFilter === filter} className={taskFilter === filter ? "selected" : ""} key={filter} onClick={() => setTaskFilter(filter)} role="tab" type="button">{filter}</button>
                      ))}
                    </div>
                  </div>
                  <div className="task-list">
                    {(activeView === "Overview" ? visibleTasks.slice(0, 6) : visibleTasks).map((task) => taskRow(task))}
                    {visibleTasks.length === 0 && <p className="empty-state">{normalizedQuery ? `No tasks match “${query}”.` : "Nothing here yet. Add a task to get moving."}</p>}
                  </div>
                  {activeView === "Overview" && visibleTasks.length > 6 && <button className="all-tasks-link" type="button" onClick={() => goTo("My tasks")}>View all {visibleTasks.length} tasks <Icon name="arrow" size={15} /></button>}
                </section>
              )}

              <footer className="page-footer"><span>Made for good work, not more work.</span><span>{SYNC_LABEL[sync.status]} across every device <span className="footer-spark">✳</span></span></footer>
            </>
          )}
        </div>
      </main>

      {undo && (
        <div className="undo-toast" role="status">
          <span>{undo.message}</span>
          <button className="text-button" onClick={() => { undo.restore(); setUndo(null); }} type="button">Undo</button>
        </div>
      )}

      {composer && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer(); }}>
          <section aria-labelledby="composer-title" aria-modal="true" className="composer-modal" role="dialog">
            <div className="modal-heading">
              <div><span className="modal-kicker">{composer === "task" ? "A SMALL STEP FORWARD" : editingProject ? "MAKE IT MORE YOU" : "A NEW THING TAKING SHAPE"}</span><h2 id="composer-title">{composer === "task" ? editingTask ? "Edit task" : "Add a task" : editingProject ? "Edit project" : "Start a project"}</h2></div>
              <button aria-label="Close dialog" className="icon-button" onClick={closeComposer} type="button"><Icon name="close" size={19} /></button>
            </div>
            <form onSubmit={composer === "task" ? saveTask : saveProject}>
              <label className="form-field"><span>{composer === "task" ? "What needs doing?" : "What are we calling it?"}</span><input autoFocus defaultValue={composer === "task" ? editingTask?.title ?? "" : editingProject?.name ?? ""} maxLength={90} name={composer === "task" ? "title" : "name"} placeholder={composer === "task" ? "e.g. Sketch out the first draft" : "e.g. A little side project"} required /></label>
              {composer === "project" && <label className="form-field"><span>A few words about it</span><input defaultValue={editingProject?.description ?? ""} maxLength={120} name="description" placeholder="What are you hoping to make?" /></label>}
              {composer === "task" && <label className="form-field"><span>Project</span><select defaultValue={taskProjectDefault} name="project"><option value="">Personal task</option>{projects.map((project) => <option key={project.id} value={project.name}>{project.name}</option>)}</select></label>}
              <div className="form-row">
                <label className="form-field"><span>Due date</span><input defaultValue={isoDate((composer === "task" ? editingTask?.due : editingProject?.due) ?? "") ?? ""} name="due" type="date" /></label>
                {composer === "task" && <label className="form-field"><span>Priority</span><select defaultValue={editingTask?.priority ?? "Medium"} name="priority"><option>Low</option><option>Medium</option><option>High</option></select></label>}
              </div>
              <div className="modal-actions"><button className="button button-secondary" onClick={closeComposer} type="button">Cancel</button><button className="button button-primary" type="submit"><Icon name={editingProject || editingTask ? "check" : "plus"} size={16} /> {composer === "task" ? editingTask ? "Save task" : "Add task" : editingProject ? "Save changes" : "Create project"}</button></div>
            </form>
          </section>
        </div>
      )}

      {deletingProject && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeletingProject(null); }}>
          <section aria-describedby="delete-project-description" aria-labelledby="delete-project-title" aria-modal="true" className="composer-modal delete-modal" role="alertdialog">
            <div className="modal-heading">
              <div><span className="modal-kicker delete-kicker">PROJECT REMOVAL</span><h2 id="delete-project-title">Delete {deletingProject.name}?</h2></div>
              <button aria-label="Close dialog" className="icon-button" onClick={() => setDeletingProject(null)} type="button"><Icon name="close" size={19} /></button>
            </div>
            <p id="delete-project-description" className="delete-description">
              This deletes the project, its notes, sprints, meetings, and links, and {tasks.filter((task) => task.project === deletingProject.name).length} linked tasks, for every device in the workspace. This can't be undone; download a backup first if you're unsure.
            </p>
            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setDeletingProject(null)} type="button">Keep project</button>
              <button className="button button-danger" onClick={confirmDeleteProject} type="button">Delete project</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function App() {
  const [importData] = useState(loadLegacyData);
  return <CollaborationGate importData={importData}>{(collaboration) => <Dashboard collaboration={collaboration} key={collaboration.workspace.id} />}</CollaborationGate>;
}

export default App;
