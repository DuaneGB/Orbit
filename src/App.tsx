import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type SetStateAction } from "react";
import { Icon, type IconName } from "./Icon";
import CalendarView from "./CalendarView";
import ProjectWorkspace from "./ProjectWorkspace";
import { WeatherWidget } from "./WeatherWidget";
import type {
  CalendarEvent,
  DashboardData,
  EntityId,
  Project,
  ProjectSpace,
  Task,
} from "./project-types";
import {
  isCalendarEvent,
  isDashboardData,
  isProject,
  isProjectSpace,
  isTask,
  normalizeDashboardData,
} from "./data-validation";
import {
  CollaborationGate,
  TeamTools,
  type CollaborationContext,
} from "./Collaboration";
import { apiRequest } from "./client-api";
import { useWorkspaceSync } from "./useWorkspaceSync";

type ViewName = "Overview" | "Projects" | "My tasks" | "Calendar";

const STORAGE_KEY = "orbit-dashboard-v1";
const BACKUP_FORMAT = "orbit-dashboard-backup";

function emptyProjectSpace(): ProjectSpace {
  return { notes: [], sprints: [], meetings: [], links: [] };
}

function newEntityId(): string {
  return crypto.randomUUID();
}

const initialData: DashboardData = {
  projects: [
    {
      id: 1,
      name: "Brand refresh",
      description: "A brighter, bolder identity for a new chapter.",
      due: "Nov 28",
      progress: 72,
      tasks: 12,
      color: "lilac",
      symbol: "✳",
    },
    {
      id: 2,
      name: "Spring campaign",
      description: "Launch the things worth looking forward to.",
      due: "Dec 04",
      progress: 48,
      tasks: 18,
      color: "peach",
      symbol: "↗",
    },
    {
      id: 3,
      name: "Website redesign",
      description: "Make the first impression feel like us.",
      due: "Dec 12",
      progress: 31,
      tasks: 24,
      color: "mint",
      symbol: "◈",
    },
  ],
  tasks: [
    {
      id: 1,
      title: "Finalize the new color palette",
      project: "Brand refresh",
      due: "Today",
      priority: "High",
      done: false,
      initials: "JD",
    },
    {
      id: 2,
      title: "Share campaign moodboard",
      project: "Spring campaign",
      due: "Today",
      priority: "Medium",
      done: false,
      initials: "AL",
    },
    {
      id: 3,
      title: "Review homepage wireframes",
      project: "Website redesign",
      due: "Tomorrow",
      priority: "High",
      done: false,
      initials: "MK",
    },
    {
      id: 4,
      title: "Collect team feedback",
      project: "Brand refresh",
      due: "Nov 24",
      priority: "Low",
      done: true,
      initials: "JD",
    },
  ],
  calendarEvents: [],
  projectSpaces: {
    "1": {
      notes: [
        {
          id: 1,
          title: "A brand people can feel",
          body: "Make the new identity feel warm, clear, and unmistakably ours. Keep the system simple enough to flex across every touchpoint.",
          updatedAt: "2026-11-18T10:00:00.000Z",
        },
        {
          id: 2,
          title: "Voice & tone",
          body: "Confident, never corporate. Curious, never clever for its own sake. We want every message to feel like an invitation.",
          updatedAt: "2026-11-17T14:30:00.000Z",
        },
      ],
      sprints: [
        {
          id: 1,
          name: "Sprint 02 — Shape the system",
          goal: "Lock the visual identity and test it across the core brand touchpoints.",
          startDate: "2026-11-16",
          endDate: "2026-11-27",
          status: "Active",
        },
        {
          id: 2,
          name: "Sprint 03 — Launch & learn",
          goal: "Prepare the rollout and gather first impressions from the team.",
          startDate: "2026-11-30",
          endDate: "2026-12-11",
          status: "Planning",
        },
      ],
      meetings: [
        {
          id: 1,
          title: "Creative direction workshop",
          date: "2026-11-23",
          time: "10:30",
          attendees: "Duane, Jamie, Alex",
          notes: "Choose the strongest route and agree on the final color direction.",
        },
        {
          id: 2,
          title: "Design review",
          date: "2026-11-25",
          time: "14:00",
          attendees: "Duane, Morgan",
          notes: "Review the identity in context before the sprint wraps.",
        },
      ],
      links: [],
    },
    "2": { notes: [], sprints: [], meetings: [], links: [] },
    "3": { notes: [], sprints: [], meetings: [], links: [] },
  },
};

function parseBackup(value: unknown): DashboardData | null {
  if (typeof value !== "object" || value === null) return null;
  const backup = value as Record<string, unknown>;
  return backup.format === BACKUP_FORMAT &&
    backup.version === 1 &&
    isDashboardData(backup.data)
    ? normalizeDashboardData(backup.data)
    : null;
}

function loadDashboard(): DashboardData {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialData;
    const parsed: unknown = JSON.parse(saved);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "projects" in parsed &&
      "tasks" in parsed &&
      Array.isArray(parsed.projects) &&
      parsed.projects.every(isProject) &&
      Array.isArray(parsed.tasks) &&
      parsed.tasks.every(isTask)
    ) {
      const projects = parsed.projects as Project[];
      const tasks = parsed.tasks as Task[];
      const savedSpaces =
        "projectSpaces" in parsed &&
        typeof parsed.projectSpaces === "object" &&
        parsed.projectSpaces !== null
          ? parsed.projectSpaces as Record<string, unknown>
          : {};
      const projectSpaces = Object.fromEntries(
        projects.map((project) => {
          const key = String(project.id);
          const savedSpace = savedSpaces[key];
          return [
            key,
            isProjectSpace(savedSpace)
              ? { ...savedSpace, links: savedSpace.links ?? [] }
              : initialData.projectSpaces[key] ?? emptyProjectSpace(),
          ];
        }),
      );
      const calendarEvents =
        "calendarEvents" in parsed &&
        Array.isArray(parsed.calendarEvents) &&
        parsed.calendarEvents.every(isCalendarEvent)
          ? parsed.calendarEvents as CalendarEvent[]
          : [];
      return { projects, tasks, projectSpaces, calendarEvents };
    }
    console.error("Saved Orbit dashboard data has an unexpected format.");
  } catch (error) {
    console.error("Could not load saved Orbit dashboard data.", error);
  }
  return initialData;
}

function Dashboard({ collaboration, initialData: firstDashboard }: { collaboration: CollaborationContext; initialData: DashboardData }) {
  const [dashboard, setDashboard] = useState<DashboardData>(firstDashboard);
  const projects = dashboard.projects;
  const tasks = dashboard.tasks;
  const projectSpaces = dashboard.projectSpaces;
  const calendarEvents = dashboard.calendarEvents;
  const [now, setNow] = useState(() => new Date());
  const sync = useWorkspaceSync(
    collaboration.workspace.id,
    dashboard,
    setDashboard,
  );
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
  const [taskFilter, setTaskFilter] = useState<"All tasks" | "To do" | "Completed">("All tasks");
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState<"task" | "project" | null>(null);
  const [taskProjectDefault, setTaskProjectDefault] = useState("");
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [openProjectMenuId, setOpenProjectMenuId] = useState<EntityId | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [backupNotice, setBackupNotice] = useState<{ message: string; error: boolean } | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuError, setWorkspaceMenuError] = useState("");
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const storageKey = `${STORAGE_KEY}:${collaboration.workspace.id}`;

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!workspaceMenuRef.current?.contains(event.target as Node)) setWorkspaceMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWorkspaceMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [workspaceMenuOpen]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!notificationsRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  const upcomingTasks = useMemo(
    () => tasks.filter((task) => !task.done && ["today", "tomorrow"].includes(task.due.trim().toLowerCase())),
    [tasks],
  );
  const upcomingEvents = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return calendarEvents.filter((event) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return false;
      const eventDate = new Date(`${event.date}T00:00:00`);
      return !Number.isNaN(eventDate.getTime()) && eventDate >= today && eventDate <= nextWeek;
    });
  }, [calendarEvents]);
  const notificationCount = upcomingTasks.length + upcomingEvents.length;

  async function renameWorkspace() {
    const enteredName = window.prompt("Choose a workspace name", collaboration.workspace.name);
    if (enteredName === null) return;
    const name = enteredName.trim();
    if (name.length < 1 || name.length > 80) {
      setWorkspaceMenuError("Workspace name must be between 1 and 80 characters.");
      return;
    }
    try {
      await apiRequest<{ name: string }>("/api/workspace/rename", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setWorkspaceMenuError("");
      setWorkspaceMenuOpen(false);
      window.dispatchEvent(new CustomEvent("orbit:workspace-renamed", { detail: { name } }));
    } catch (renameError) {
      console.error("Could not rename the workspace.", renameError);
      setWorkspaceMenuError(renameError instanceof Error ? renameError.message : "Could not rename the workspace.");
    }
  }

  useEffect(() => {
    if (!sync.ready) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(dashboard));
      setStorageError(false);
    } catch (error) {
      console.error("Could not save Orbit dashboard data.", error);
      setStorageError(true);
    }
  }, [dashboard, storageKey, sync.ready]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleProjects = useMemo(
    () =>
      projects.filter((project) =>
        `${project.name} ${project.description}`.toLowerCase().includes(normalizedQuery),
      ),
    [projects, normalizedQuery],
  );
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        const matchesQuery = `${task.title} ${task.project}`.toLowerCase().includes(normalizedQuery);
        const matchesFilter =
          taskFilter === "All tasks" ||
          (taskFilter === "To do" && !task.done) ||
          (taskFilter === "Completed" && task.done);
        return matchesQuery && matchesFilter;
      }),
    [normalizedQuery, taskFilter, tasks],
  );
  const openTasks = tasks.filter((task) => !task.done).length;
  const completedTasks = tasks.filter((task) => task.done).length;
  const dueTodayTasks = tasks.filter((task) => !task.done && task.due.trim().toLowerCase() === "today");
  const nextAgendaItem = useMemo(() => {
    const items = [
      ...calendarEvents.map((event) => ({ title: event.title, date: event.date, time: event.time, project: event.project })),
      ...projects.flatMap((project) =>
        (projectSpaces[String(project.id)]?.meetings ?? []).map((meeting) => ({
          title: meeting.title,
          date: meeting.date,
          time: meeting.time,
          project: project.name,
        })),
      ),
    ];
    return items
      .map((item) => ({ ...item, timestamp: new Date(`${item.date}T${item.time || "23:59"}`).getTime() }))
      .filter((item) => Number.isFinite(item.timestamp) && item.timestamp >= now.getTime())
      .sort((left, right) => left.timestamp - right.timestamp)[0] ?? null;
  }, [calendarEvents, now, projectSpaces, projects]);
  const selectedProject =
    selectedProjectId === null
      ? undefined
      : projects.find((project) => project.id === selectedProjectId);
  const selectedProjectSpace = selectedProject
    ? projectSpaces[String(selectedProject.id)] ?? emptyProjectSpace()
    : undefined;
  const hour = now.getHours();
  const greeting = hour < 12
    ? "Good morning"
    : hour < 17
      ? "Good afternoon"
      : "Good evening";
  const pageTitle: Record<ViewName, string> = {
    Overview: greeting,
    Projects: "Your projects",
    "My tasks": "Your task list",
    Calendar: "Coming up",
  };
  const pageDescription: Record<ViewName, string> = {
    Overview: "A little progress adds up. Here's your day at a glance.",
    Projects: "All the things you're making happen, in one place.",
    "My tasks": "Small steps, big picture. Pick up where you left off.",
    Calendar: "Stay a step ahead of what's on the horizon.",
  };

  function toggleTask(id: EntityId) {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, done: !task.done } : task)),
    );
  }

  function closeComposer() {
    setComposer(null);
    setEditingProject(null);
  }

  function openTaskComposer(projectName = "") {
    setTaskProjectDefault(projectName);
    setComposer("task");
  }

  function openProjectComposer(project?: Project) {
    setEditingProject(project ?? null);
    setComposer("project");
    setOpenProjectMenuId(null);
  }

  function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const project = String(form.get("project") ?? "");
    const due = String(form.get("due") ?? "").trim() || "No date";
    const priorityValue = String(form.get("priority") ?? "Medium");
    const priority: Task["priority"] =
      priorityValue === "High" || priorityValue === "Low" || priorityValue === "Medium"
        ? priorityValue
        : "Medium";
    if (!title) return;
    setTasks((current) => [
      {
        id: newEntityId(),
        title,
        project: project || "Personal",
        due,
        priority,
        done: false,
        initials: "DU",
      },
      ...current,
    ]);
    if (project) {
      setProjects((current) =>
        current.map((item) =>
          item.name === project ? { ...item, tasks: item.tasks + 1 } : item,
        ),
      );
    }
    closeComposer();
  }

  function addProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const due = String(form.get("due") ?? "").trim() || "No date";
    if (!name) return;
    if (editingProject) {
      setProjects((current) =>
        current.map((project) =>
          project.id === editingProject.id
            ? {
                ...project,
                name,
                description: description || editingProject.description,
                due,
              }
            : project,
        ),
      );
      if (name !== editingProject.name) {
        setTasks((current) =>
          current.map((task) =>
            task.project === editingProject.name ? { ...task, project: name } : task,
          ),
        );
      }
      closeComposer();
      return;
    }

    const colors = ["lilac", "peach", "mint", "sky"];
    const symbols = ["✳", "↗", "◈", "✦"];
    const id = newEntityId();
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
    setProjectSpaces((current) => ({ ...current, [String(id)]: emptyProjectSpace() }));
    closeComposer();
  }

  function confirmDeleteProject() {
    if (!deletingProject) return;
    const projectId = deletingProject.id;
    const projectName = deletingProject.name;
    setProjects((current) => current.filter((project) => project.id !== projectId));
    setTasks((current) => current.filter((task) => task.project !== projectName));
    setProjectSpaces((current) => {
      const next = { ...current };
      delete next[String(projectId)];
      return next;
    });
    setDeletingProject(null);
  }

  function updateProjectSpace(projectId: EntityId, update: (space: ProjectSpace) => ProjectSpace) {
    setProjectSpaces((current) => {
      const key = String(projectId);
      return { ...current, [key]: update(current[key] ?? emptyProjectSpace()) };
    });
  }

  function addCalendarEvent(event: Omit<CalendarEvent, "id">) {
    const id = newEntityId();
    setCalendarEvents((current) => [...current, { ...event, id }].sort((a, b) => a.date.localeCompare(b.date)));
  }

  function updateCalendarEvent(id: EntityId, event: Omit<CalendarEvent, "id">) {
    setCalendarEvents((current) =>
      current.map((item) => item.id === id ? { ...event, id } : item)
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
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
        data: { projects, tasks, projectSpaces, calendarEvents },
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `orbit-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
      if (!window.confirm("Restore this backup? It will replace the Orbit data in this browser.")) return;

      setDashboard(backup);
      setSelectedProjectId(null);
      setActiveView("Overview");
      setBackupNotice({ message: "Backup restored. Orbit will save it in this browser.", error: false });
    } catch (error) {
      console.error("Could not restore Orbit data.", error);
      setBackupNotice({ message: "The backup file could not be read.", error: true });
    }
  }

  function openProject(project: Project) {
    setActiveView("Projects");
    setSelectedProjectId(project.id);
  }

  const showProjects = activeView === "Overview" || activeView === "Projects";
  const showTasks = activeView === "Overview" || activeView === "My tasks";
  const showCalendar = activeView === "Calendar";
  const currentWeekday = (new Date().getDay() + 6) % 7;

  if (!sync.ready) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>{sync.error ? "Couldn’t load the shared workspace" : "Syncing your workspace…"}</h1>
          <p>{sync.error || "Loading your projects and the latest teammate updates."}</p>
          {sync.error && <button className="button button-primary" onClick={sync.retry} type="button">Retry connection</button>}
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setSelectedProjectId(null); setActiveView("Overview"); }}>
          <span className="brand-mark"><span /></span>
          <span>orbit<span className="brand-period">.</span></span>
        </a>

        <div className="workspace-switcher-wrap" ref={workspaceMenuRef}>
          <button
            className="workspace-switcher"
            type="button"
            aria-label="Workspace menu"
            aria-expanded={workspaceMenuOpen}
            aria-controls="workspace-menu"
            onClick={() => setWorkspaceMenuOpen((open) => !open)}
          >
            <div className="workspace-avatar">{collaboration.workspace.name.slice(0, 1).toUpperCase()}</div>
            <div className="workspace-copy">
              <span className="eyebrow">WORKSPACE</span>
              <strong>{collaboration.workspace.name}</strong>
            </div>
            <Icon name="chevron" size={16} />
          </button>
          <div className="workspace-menu" hidden={!workspaceMenuOpen} id="workspace-menu" aria-label="Workspace actions">
              <div className="workspace-menu-summary">
                <strong>{collaboration.workspace.name}</strong>
                <span>Connected as {collaboration.device.name}</span>
                <small>{collaboration.device.role === "owner" ? "Workspace owner" : "Workspace member"}</small>
              </div>
              {workspaceMenuError && <p className="workspace-menu-error" role="alert">{workspaceMenuError}</p>}
              {collaboration.device.role === "owner" && (
                <button type="button" onClick={() => void renameWorkspace()}>
                  Rename workspace
                </button>
              )}
              <TeamTools {...collaboration} onForgetDevice={() => window.dispatchEvent(new Event("orbit:device-expired"))} />
              <section aria-label="Orbit data backups" className="backup-toolbar workspace-backup-tools">
                <div className="backup-copy">
                  <strong>Back up your Orbit data</strong>
                  <span>Save a JSON copy of your projects, tasks, notes, sprints, meetings, and events.</span>
                </div>
                <div className="backup-actions">
                  <button className="button button-secondary" onClick={exportBackup} type="button">Download backup</button>
                  <button className="button button-secondary" onClick={() => backupInputRef.current?.click()} type="button">Restore backup</button>
                  <input
                    accept="application/json,.json"
                    hidden
                    onChange={importBackup}
                    ref={backupInputRef}
                    type="file"
                  />
                </div>
                {backupNotice && (
                  <p className={`backup-notice ${backupNotice.error ? "backup-notice-error" : ""}`} role={backupNotice.error ? "alert" : "status"}>
                    {backupNotice.message}
                  </p>
                )}
              </section>
          </div>
        </div>

        <span className="nav-label">WORKSPACE</span>
        <nav className="primary-nav" aria-label="Main navigation">
          {([
            ["Overview", "grid"],
            ["Projects", "layers"],
            ["My tasks", "check"],
            ["Calendar", "calendar"],
          ] as [ViewName, IconName][]).map(([label, icon]) => (
            <button
              className={`nav-item ${activeView === label ? "active" : ""}`}
              key={label}
              onClick={() => { setSelectedProjectId(null); setActiveView(label); }}
              type="button"
            >
              <Icon name={icon} size={19} />
              <span>{label}</span>
              {label === "My tasks" && <span className="nav-count">{openTasks}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-projects">
          <div className="sidebar-section-heading">
            <span className="nav-label">YOUR PROJECTS</span>
            <button className="icon-button sidebar-add" type="button" aria-label="Add project" onClick={() => openProjectComposer()}>
              <Icon name="plus" size={16} />
            </button>
          </div>
          {projects.slice(0, 4).map((project) => (
            <button className="project-shortcut" key={project.id} onClick={() => openProject(project)} type="button">
              <span className={`project-dot ${project.color}`} />
              <span>{project.name}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-bottom">
          <div className="focus-card">
            <div className="focus-icon"><Icon name="spark" size={17} /></div>
            <strong>Make space for focus.</strong>
            <p>One thing at a time is still a lot.</p>
            <button type="button" onClick={() => { setSelectedProjectId(null); setActiveView("My tasks"); }}>Find your next step <Icon name="arrow" size={14} /></button>
          </div>
          <button className="profile-button" type="button">
            <span className="avatar avatar-you">DU</span>
            <span className="profile-copy"><strong>Duane User</strong><small>Free plan</small></span>
            <Icon name="dots" size={19} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb"><span>{collaboration?.workspace.name ?? "Studio North"}</span><span className="breadcrumb-slash">/</span><strong>{selectedProject?.name ?? activeView}</strong></div>
          <div className="topbar-actions">
            <label className="search-box">
              <Icon name="search" size={17} />
              <input aria-label="Search projects and tasks" placeholder="Search anything..." value={query} onChange={(event) => setQuery(event.target.value)} />
              <kbd>⌘ K</kbd>
            </label>
            <div className="notification-wrap" ref={notificationsRef}>
              <button
                className="icon-button notification-button"
                type="button"
                aria-label={notificationCount ? `Notifications, ${notificationCount} upcoming` : "Notifications"}
                aria-expanded={notificationsOpen}
                aria-controls="notifications-panel"
                onClick={() => setNotificationsOpen((open) => !open)}
              >
                <Icon name="bell" size={19} />
                {notificationCount > 0 && <span>{notificationCount > 9 ? "9+" : notificationCount}</span>}
              </button>
              {notificationsOpen && (
                <section className="notifications-panel" id="notifications-panel" role="dialog" aria-labelledby="notifications-title">
                  <div className="notifications-heading">
                    <div>
                      <strong id="notifications-title">Notifications</strong>
                      <span>{notificationCount ? `${notificationCount} things coming up` : "You’re all caught up"}</span>
                    </div>
                    <button className="icon-button" type="button" aria-label="Close notifications" onClick={() => setNotificationsOpen(false)}>
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                  {notificationCount === 0 ? (
                    <p className="notifications-empty">Tasks due today or tomorrow and events in the next week will show up here.</p>
                  ) : (
                    <div className="notifications-list">
                      {upcomingTasks.map((task) => (
                        <button
                          className="notification-item"
                          key={`task-${task.id}`}
                          type="button"
                          onClick={() => { setActiveView("My tasks"); setNotificationsOpen(false); }}
                        >
                          <span className="notification-item-icon"><Icon name="check" size={15} /></span>
                          <span><strong>{task.title}</strong><small>{task.project} · Due {task.due.toLowerCase()}</small></span>
                        </button>
                      ))}
                      {upcomingEvents.map((event) => (
                        <button
                          className="notification-item"
                          key={`event-${event.id}`}
                          type="button"
                          onClick={() => { setActiveView("Calendar"); setNotificationsOpen(false); }}
                        >
                          <span className="notification-item-icon"><Icon name="calendar" size={15} /></span>
                          <span><strong>{event.title}</strong><small>{event.date}{event.time ? ` · ${event.time}` : ""}</small></span>
                        </button>
                      ))}
                    </div>
                  )}
                  {notificationCount > 0 && (
                    <button
                      className="notifications-footer"
                      type="button"
                      onClick={() => { setActiveView(upcomingTasks.length ? "My tasks" : "Calendar"); setNotificationsOpen(false); }}
                    >
                      View {upcomingTasks.length ? "tasks" : "calendar"}
                    </button>
                  )}
                </section>
              )}
            </div>
            <span className="avatar avatar-you top-avatar">DU</span>
          </div>
        </header>

        <div className="page-content">
          {sync.error && (
            <div className="sync-warning" role="alert">
              <span>{sync.error}</span>
              <button className="inline-action" onClick={sync.retry} type="button">Retry sync <Icon name="arrow" size={14} /></button>
            </div>
          )}
          {selectedProject && selectedProjectSpace ? (
            <ProjectWorkspace
              onAddTask={() => openTaskComposer(selectedProject.name)}
              onBack={() => setSelectedProjectId(null)}
              onProgressChange={(progress) =>
                setProjects((current) =>
                  current.map((project) =>
                    project.id === selectedProject.id ? { ...project, progress } : project,
                  ),
                )
              }
              onToggleTask={toggleTask}
              onUpdateSpace={(update) => updateProjectSpace(selectedProject.id, update)}
              project={selectedProject}
              space={selectedProjectSpace}
              tasks={tasks.filter((task) => task.project === selectedProject.name)}
            />
          ) : showCalendar ? (
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
          ) : (
          <>
          <section className="welcome-row">
            <div>
              <div className="date-line"><span className="date-dot" />{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now)}<span className="welcome-local-time">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(now)}</span></div>
              <h1>{pageTitle[activeView]}<span className="heading-period">.</span></h1>
              <p className="welcome-description">{pageDescription[activeView]}</p>
            </div>
            <div className="welcome-actions">
              <button className="button button-secondary" type="button" onClick={() => openTaskComposer()}><Icon name="plus" size={17} /> Add a task</button>
              <button className="button button-primary" type="button" onClick={() => openProjectComposer()}><Icon name="plus" size={17} /> New project</button>
            </div>
          </section>

          {storageError && <p className="storage-warning" role="alert">Your changes couldn't be saved in this browser. Check your storage settings.</p>}

          {activeView === "Overview" && (
            <>
              <section aria-label="Today at a glance" className="today-widgets">
                <WeatherWidget />
                <article className="today-widget">
                  <div className="today-widget-top"><span>LOCAL TIME</span><Icon name="clock" size={16} /></div>
                  <strong className="today-widget-value">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(now)}</strong>
                  <small>{new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(now).find((part) => part.type === "timeZoneName")?.value ?? "Your local time"}</small>
                </article>
                <article className="today-widget">
                  <div className="today-widget-top"><span>NEXT UP</span><Icon name="calendar" size={16} /></div>
                  {nextAgendaItem ? (
                    <>
                      <strong className="today-widget-title">{nextAgendaItem.title}</strong>
                      <small>{[nextAgendaItem.project, new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", ...(nextAgendaItem.time ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(nextAgendaItem.timestamp))].filter(Boolean).join(" · ")}</small>
                    </>
                  ) : (
                    <><strong className="today-widget-title">Nothing scheduled</strong><small>There’s room for something new.</small></>
                  )}
                </article>
                <article className="today-widget">
                  <div className="today-widget-top"><span>TODAY’S FOCUS</span><Icon name="target" size={16} /></div>
                  <strong className="today-widget-value">{dueTodayTasks.length}<span> tasks</span></strong>
                  <small>{dueTodayTasks.length ? "Open tasks due today" : "No tasks due today"}</small>
                </article>
              </section>
              <section className="stats-grid" aria-label="Workspace summary">
                <article className="stat-card stat-card-lavender">
                  <div className="stat-top"><span>In motion</span><span className="stat-icon"><Icon name="layers" size={18} /></span></div>
                  <div className="stat-value">{projects.length}<span className="stat-unit"> projects</span></div>
                  <div className="stat-note"><span className="trend-up">↗</span> Keep the momentum going</div>
                  <span className="stat-decoration decoration-rings" />
                </article>
                <article className="stat-card stat-card-peach">
                  <div className="stat-top"><span>On your plate</span><span className="stat-icon"><Icon name="check" size={18} /></span></div>
                  <div className="stat-value">{openTasks}<span className="stat-unit"> open tasks</span></div>
                  <div className="stat-note"><span className="stat-note-strong">{completedTasks} wrapped up</span> this week</div>
                  <span className="stat-decoration decoration-sun" />
                </article>
                <article className="stat-card stat-card-mint">
                  <div className="stat-top"><span>Next milestone</span><span className="stat-icon"><Icon name="calendar" size={18} /></span></div>
                  <div className="stat-value stat-value-date">Nov 28</div>
                  <div className="stat-note"><span className="stat-note-strong">Brand refresh</span> · 8 days to go</div>
                  <span className="stat-decoration decoration-spark">✳</span>
                </article>
              </section>

              <section className="weekly-card">
                <div className="weekly-copy">
                  <span className="weekly-kicker"><Icon name="spark" size={15} /> YOUR WEEK, IN FOCUS</span>
                  <h2>Look at you, making progress.</h2>
                  <p>You’ve completed <strong>{completedTasks} tasks</strong> so far. Keep that good thing going.</p>
                </div>
                <div className="week-visual" aria-label={`${completedTasks} tasks completed this week`}>
                  <div className="week-bars">
                    {[36, 57, 43, 76, 52, 89, 39].map((height, index) => (
                      <div className="week-bar-column" key={index}>
                        <span className={`week-bar ${index === currentWeekday ? "week-bar-today" : ""}`} style={{ height: `${height}%` }} />
                        <span className="week-day">{["M", "T", "W", "T", "F", "S", "S"][index]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="week-total"><strong>{completedTasks}</strong><span>done</span></div>
                </div>
              </section>
            </>
          )}

          {showProjects && (
            <section className="content-section">
              <div className="section-heading">
                <div><h2>{activeView === "Projects" ? "All projects" : "In the works"}</h2><p>The big ideas and the steps getting you there.</p></div>
                <button className="text-button" type="button" onClick={() => setActiveView("Projects")}>See all <Icon name="arrow" size={15} /></button>
              </div>
              <div className="project-grid">
                {visibleProjects.map((project) => (
                  <article className={`project-card project-${project.color} ${openProjectMenuId === project.id ? "project-card-menu-open" : ""}`} key={project.id}>
                    <div className="project-menu-anchor">
                      <button
                        aria-expanded={openProjectMenuId === project.id}
                        aria-haspopup="menu"
                        aria-label={`More options for ${project.name}`}
                        className="icon-button card-menu"
                        onClick={() =>
                          setOpenProjectMenuId((current) =>
                            current === project.id ? null : project.id,
                          )
                        }
                        type="button"
                      >
                        <Icon name="dots" size={19} />
                      </button>
                      {openProjectMenuId === project.id && (
                        <div className="project-menu" role="menu">
                          <button onClick={() => openProjectComposer(project)} role="menuitem" type="button">
                            Edit project
                          </button>
                          <button
                            className="project-menu-danger"
                            onClick={() => {
                              setOpenProjectMenuId(null);
                              setDeletingProject(project);
                            }}
                            role="menuitem"
                            type="button"
                          >
                            Delete project
                          </button>
                        </div>
                      )}
                    </div>
                    <button className="project-card-open" onClick={() => openProject(project)} type="button">
                      <span className={`project-symbol symbol-${project.color}`}>{project.symbol}</span>
                      <span className="project-card-title-row">
                        <span className="project-card-title">{project.name}</span>
                        <Icon name="arrow" size={14} />
                      </span>
                      <span className="project-description">{project.description}</span>
                      <span className="project-progress-label"><span>Progress</span><strong>{project.progress}%</strong></span>
                      <span className="progress-track"><span style={{ width: `${project.progress}%` }} /></span>
                      <span className="project-card-footer">
                        <span><Icon name="check" size={14} /> {project.tasks} tasks</span>
                        <span><Icon name="calendar" size={14} /> {project.due}</span>
                      </span>
                    </button>
                  </article>
                ))}
                <button className="project-add-card" type="button" onClick={() => openProjectComposer()}>
                  <span className="add-card-icon"><Icon name="plus" size={19} /></span>
                  <strong>Start something new</strong>
                  <span>Every good thing starts somewhere.</span>
                </button>
              </div>
              {visibleProjects.length === 0 && <p className="empty-state">No projects match “{query}”. Try another search.</p>}
            </section>
          )}

          {showTasks && (
            <section className="content-section task-section">
              <div className="section-heading task-heading">
                <div><h2>{activeView === "My tasks" ? "Everything on your list" : "A good place to start"}</h2><p>Your next little wins are right here.</p></div>
                <div className="task-filters" role="tablist" aria-label="Filter tasks">
                  {(["All tasks", "To do", "Completed"] as const).map((filter) => (
                    <button aria-selected={taskFilter === filter} className={taskFilter === filter ? "selected" : ""} key={filter} onClick={() => setTaskFilter(filter)} role="tab" type="button">{filter}</button>
                  ))}
                </div>
              </div>
              <div className="task-list">
                {visibleTasks.map((task) => (
                  <article className={`task-row ${task.done ? "task-done" : ""}`} key={task.id}>
                    <button className={`task-check ${task.done ? "checked" : ""}`} type="button" aria-label={task.done ? `Mark ${task.title} as not done` : `Complete ${task.title}`} aria-pressed={task.done} onClick={() => toggleTask(task.id)}>
                      {task.done && <Icon name="check" size={14} />}
                    </button>
                    <div className="task-main"><strong>{task.title}</strong><span>{task.project}</span></div>
                    <span className={`priority priority-${task.priority.toLowerCase()}`}><i />{task.priority}</span>
                    <span className={`task-due ${task.due === "Today" ? "due-today" : ""}`}><Icon name="clock" size={15} />{task.due}</span>
                    <span className="avatar task-avatar">{task.initials}</span>
                  </article>
                ))}
                {visibleTasks.length === 0 && <p className="empty-state">Nothing here yet. Add a task to get moving.</p>}
              </div>
              {activeView === "Overview" && <button className="all-tasks-link" type="button" onClick={() => setActiveView("My tasks")}>View all tasks <Icon name="arrow" size={15} /></button>}
            </section>
          )}

          <footer className="page-footer"><span>Made for good work, not more work.</span><span>Take a breath. You’re right on track <span className="footer-spark">✳</span></span></footer>
          </>
          )}
        </div>
      </main>

      {composer && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer(); }}>
          <section aria-labelledby="composer-title" aria-modal="true" className="composer-modal" role="dialog">
            <div className="modal-heading">
              <div><span className="modal-kicker">{composer === "task" ? "A SMALL STEP FORWARD" : editingProject ? "MAKE IT MORE YOU" : "A NEW THING TAKING SHAPE"}</span><h2 id="composer-title">{composer === "task" ? "Add a task" : editingProject ? "Edit project" : "Start a project"}</h2></div>
              <button aria-label="Close dialog" className="icon-button" onClick={closeComposer} type="button"><Icon name="close" size={19} /></button>
            </div>
            <form onSubmit={composer === "task" ? addTask : addProject}>
              <label className="form-field"><span>{composer === "task" ? "What needs doing?" : "What are we calling it?"}</span><input autoFocus defaultValue={editingProject?.name ?? ""} maxLength={90} name={composer === "task" ? "title" : "name"} placeholder={composer === "task" ? "e.g. Sketch out the first draft" : "e.g. A little side project"} required /></label>
              {composer === "project" && <label className="form-field"><span>A few words about it</span><input defaultValue={editingProject?.description ?? ""} maxLength={120} name="description" placeholder="What are you hoping to make?" /></label>}
              {composer === "task" && <label className="form-field"><span>Project</span><select defaultValue={taskProjectDefault} name="project"><option value="">Personal task</option>{projects.map((project) => <option key={project.id} value={project.name}>{project.name}</option>)}</select></label>}
              <div className="form-row">
                <label className="form-field"><span>Due date</span><input defaultValue={editingProject?.due ?? ""} name="due" placeholder="e.g. Friday, Nov 28" /></label>
                {composer === "task" && <label className="form-field"><span>Priority</span><select defaultValue="Medium" name="priority"><option>Low</option><option>Medium</option><option>High</option></select></label>}
              </div>
              <div className="modal-actions"><button className="button button-secondary" onClick={closeComposer} type="button">Maybe later</button><button className="button button-primary" type="submit"><Icon name={editingProject ? "check" : "plus"} size={16} /> {composer === "task" ? "Add task" : editingProject ? "Save changes" : "Create project"}</button></div>
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
              This also deletes linked tasks ({tasks.filter((task) => task.project === deletingProject.name).length}). This can’t be undone.
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
  const [initialData] = useState(loadDashboard);
  return <CollaborationGate initialData={initialData}>{(collaboration) => <Dashboard collaboration={collaboration} initialData={initialData} />}</CollaborationGate>;
}

export default App;
