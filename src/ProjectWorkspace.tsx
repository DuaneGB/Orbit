import { useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import type {
  Project,
  EntityId,
  ProjectMeeting,
  ProjectLink,
  ProjectNote,
  ProjectSpace,
  ProjectSprint,
  ProjectTab,
  SprintStatus,
  Task,
} from "./project-types";

type Props = {
  project: Project;
  tasks: Task[];
  space: ProjectSpace;
  onBack: () => void;
  onAddTask: () => void;
  onToggleTask: (id: EntityId) => void;
  onProgressChange: (progress: number) => void;
  onUpdateSpace: (update: (space: ProjectSpace) => ProjectSpace) => void;
};

type Composer = "note" | "sprint" | "meeting" | "link" | null;

const tabs: ProjectTab[] = ["Overview", "Tasks", "Notes", "Sprints", "Meetings", "Links"];

function formatDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date);
}

function nextSprintStatus(status: SprintStatus): SprintStatus {
  if (status === "Planning") return "Active";
  if (status === "Active") return "Completed";
  return "Planning";
}

function ProjectWorkspace({
  project,
  tasks,
  space,
  onBack,
  onAddTask,
  onToggleTask,
  onProgressChange,
  onUpdateSpace,
}: Props) {
  const [activeTab, setActiveTab] = useState<ProjectTab>("Overview");
  const [composer, setComposer] = useState<Composer>(null);
  const [editingNote, setEditingNote] = useState<ProjectNote | null>(null);
  const [linkError, setLinkError] = useState("");
  const completedTasks = tasks.filter((task) => task.done).length;
  const activeSprint = space.sprints.find((sprint) => sprint.status === "Active");
  const nextMeeting = [...space.meetings].sort((a, b) => a.date.localeCompare(b.date))[0];

  function closeComposer() {
    setComposer(null);
    setEditingNote(null);
    setLinkError("");
  }

  function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const body = String(form.get("body") ?? "").trim();
    if (!title || !body) return;
    const note: ProjectNote = {
      id: editingNote?.id ?? crypto.randomUUID(),
      title,
      body,
      updatedAt: new Date().toISOString(),
    };
    onUpdateSpace((current) => ({
      ...current,
      notes: [note, ...current.notes.filter((item) => item.id !== note.id)],
    }));
    closeComposer();
  }

  function addSprint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const goal = String(form.get("goal") ?? "").trim();
    const startDate = String(form.get("startDate") ?? "");
    const endDate = String(form.get("endDate") ?? "");
    if (!name || !startDate || !endDate) return;
    const sprint: ProjectSprint = {
      id: crypto.randomUUID(),
      name,
      goal,
      startDate,
      endDate,
      status: "Planning",
    };
    onUpdateSpace((current) => ({ ...current, sprints: [sprint, ...current.sprints] }));
    closeComposer();
  }

  function addMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    if (!title || !date || !time) return;
    const meeting: ProjectMeeting = {
      id: crypto.randomUUID(),
      title,
      date,
      time,
      attendees: String(form.get("attendees") ?? "").trim(),
      notes: String(form.get("notes") ?? "").trim(),
    };
    onUpdateSpace((current) => ({
      ...current,
      meetings: [...current.meetings, meeting].sort((a, b) => a.date.localeCompare(b.date)),
    }));
    closeComposer();
  }

  function addLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") ?? "").trim();
    const rawUrl = String(form.get("url") ?? "").trim();
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      setLinkError("Enter a complete web address, including https://.");
      return;
    }
    if (!label || (url.protocol !== "https:" && url.protocol !== "http:")) {
      setLinkError("Use a name and a valid http or https address.");
      return;
    }
    const link: ProjectLink = {
      id: crypto.randomUUID(),
      label,
      url: url.href,
      addedAt: new Date().toISOString(),
    };
    onUpdateSpace((current) => ({ ...current, links: [...current.links, link] }));
    setLinkError("");
    closeComposer();
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    if (composer === "note") addNote(event);
    if (composer === "sprint") addSprint(event);
    if (composer === "meeting") addMeeting(event);
    if (composer === "link") addLink(event);
  }

  function openNote(note?: ProjectNote) {
    setEditingNote(note ?? null);
    setComposer("note");
  }

  return (
    <div className={`project-space project-space-${project.color}`}>
      <button className="back-to-projects" onClick={onBack} type="button">
        <Icon name="back" size={17} /> All projects
      </button>

      <section className="project-space-hero">
        <div className="project-space-identity">
          <div className="project-space-symbol">{project.symbol}</div>
          <div>
            <span className="project-space-eyebrow"><span /> PROJECT SPACE</span>
            <h1>{project.name}<span className="heading-period">.</span></h1>
            <p>{project.description}</p>
            <div className="project-space-tags">
              <span><Icon name="calendar" size={14} /> Due {project.due}</span>
              <span><Icon name="layers" size={14} /> {space.sprints.length} sprints</span>
            </div>
          </div>
        </div>
        <div className="project-space-progress">
          <div className="project-progress-ring" style={{ background: `conic-gradient(var(--space-accent) ${project.progress * 3.6}deg, #ffffff73 0)` }}>
            <div><strong>{project.progress}<small>%</small></strong><span>in motion</span></div>
          </div>
          <label>
            <span>Project pulse</span>
            <input aria-label="Project progress" max="100" min="0" onChange={(event) => onProgressChange(Number(event.target.value))} type="range" value={project.progress} />
          </label>
        </div>
        <div className="project-space-actions">
          <button className="button button-light" onClick={onAddTask} type="button"><Icon name="plus" size={16} /> Add task</button>
          <button className="button button-light" onClick={() => openNote()} type="button"><Icon name="note" size={16} /> New note</button>
          <button className="button button-primary" onClick={() => setComposer("meeting")} type="button"><Icon name="calendar" size={16} /> Plan a meeting</button>
        </div>
        <span className="project-hero-orbit orbit-one" />
        <span className="project-hero-orbit orbit-two" />
      </section>

      <div aria-label="Project sections" className="project-tabs" role="tablist">
        {tabs.map((tab) => {
          const count = tab === "Tasks" ? tasks.length : tab === "Notes" ? space.notes.length : tab === "Sprints" ? space.sprints.length : tab === "Meetings" ? space.meetings.length : tab === "Links" ? space.links.length : null;
          return (
            <button aria-selected={activeTab === tab} className={activeTab === tab ? "project-tab active" : "project-tab"} key={tab} onClick={() => setActiveTab(tab)} role="tab" type="button">
              {tab}{count !== null && <span>{count}</span>}
            </button>
          );
        })}
      </div>

      {activeTab === "Overview" && (
        <div className="space-content">
          <div className="space-metrics">
            <article><span className="space-metric-icon metric-violet"><Icon name="check" size={17} /></span><div><strong>{completedTasks}<small> / {tasks.length}</small></strong><span>Tasks completed</span></div><b>{tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0}%</b></article>
            <article><span className="space-metric-icon metric-peach"><Icon name="target" size={17} /></span><div><strong>{space.sprints.length}</strong><span>Sprints planned</span></div><b>{activeSprint ? "1 active" : "Ready"}</b></article>
            <article><span className="space-metric-icon metric-mint"><Icon name="note" size={17} /></span><div><strong>{space.notes.length}</strong><span>Project notes</span></div><b>Ideas live here</b></article>
          </div>

          <div className="space-overview-grid">
            <section className="space-panel active-sprint-panel">
              <div className="space-panel-heading"><div><span className="panel-kicker">MAKE IT HAPPEN</span><h2>{activeSprint ? activeSprint.name : "Your next sprint starts here"}</h2></div><Icon name="target" size={19} /></div>
              {activeSprint ? (
                <>
                  <p>{activeSprint.goal || "A focused stretch of work, one clear goal."}</p>
                  <div className="sprint-date-range"><Icon name="calendar" size={15} /> {formatDate(activeSprint.startDate)} — {formatDate(activeSprint.endDate)} <span className="sprint-status status-active">Active</span></div>
                  <button className="inline-action" onClick={() => {
                    onUpdateSpace((current) => ({
                      ...current,
                      sprints: current.sprints.map((sprint) => sprint.id === activeSprint.id ? { ...sprint, status: "Completed" } : sprint),
                    }));
                  }} type="button">Wrap up sprint <Icon name="check" size={15} /></button>
                </>
              ) : (
                <>
                  <p>Give the next stretch of work a name, a goal, and a finish line.</p>
                  <button className="inline-action" onClick={() => setComposer("sprint")} type="button">Plan your first sprint <Icon name="arrow" size={15} /></button>
                </>
              )}
            </section>

            <section className="space-panel next-meeting-panel">
              <div className="space-panel-heading"><div><span className="panel-kicker">ON THE CALENDAR</span><h2>{nextMeeting ? nextMeeting.title : "Make time to connect"}</h2></div><span className="meeting-icon"><Icon name="users" size={18} /></span></div>
              {nextMeeting ? (
                <>
                  <p>{nextMeeting.notes || "A little time together can move a big idea forward."}</p>
                  <div className="meeting-detail-line"><Icon name="calendar" size={15} /> {formatDate(nextMeeting.date)} <i /> {nextMeeting.time}</div>
                  <div className="meeting-attendees">{nextMeeting.attendees || "Add your people"} <button aria-label="Schedule another meeting" onClick={() => setComposer("meeting")} type="button"><Icon name="plus" size={14} /></button></div>
                </>
              ) : (
                <>
                  <p>No meetings yet. Add a check-in, workshop, or review.</p>
                  <button className="inline-action" onClick={() => setComposer("meeting")} type="button">Schedule a meeting <Icon name="arrow" size={15} /></button>
                </>
              )}
            </section>

            <section className="space-panel recent-notes-panel">
              <div className="space-panel-heading"><div><span className="panel-kicker">THE THINKING BEHIND IT</span><h2>Recent notes</h2></div><button aria-label="Write a note" className="icon-button" onClick={() => openNote()} type="button"><Icon name="plus" size={17} /></button></div>
              {space.notes.slice(0, 2).length ? space.notes.slice(0, 2).map((note) => (
                <button className="note-preview" key={note.id} onClick={() => openNote(note)} type="button"><span className="note-preview-icon"><Icon name="note" size={15} /></span><span><strong>{note.title}</strong><small>{note.body}</small></span><Icon name="arrow" size={14} /></button>
              )) : <p className="panel-empty">Capture an idea before it gets away.</p>}
              <button className="inline-action" onClick={() => setActiveTab("Notes")} type="button">Open project notes <Icon name="arrow" size={15} /></button>
            </section>

            <section className="space-panel task-preview-panel">
              <div className="space-panel-heading"><div><span className="panel-kicker">THE NEXT SMALL WINS</span><h2>Up next</h2></div><button aria-label="Add task" className="icon-button" onClick={onAddTask} type="button"><Icon name="plus" size={17} /></button></div>
              {tasks.filter((task) => !task.done).slice(0, 3).map((task) => (
                <div className="space-task-preview" key={task.id}><button aria-label={`Complete ${task.title}`} onClick={() => onToggleTask(task.id)} type="button" /><span><strong>{task.title}</strong><small>{task.due} · {task.priority} priority</small></span></div>
              ))}
              {tasks.filter((task) => !task.done).length === 0 && <p className="panel-empty">No open tasks. Add one when you’re ready.</p>}
              <button className="inline-action" onClick={() => setActiveTab("Tasks")} type="button">See all project tasks <Icon name="arrow" size={15} /></button>
            </section>
          </div>
        </div>
      )}

      {activeTab === "Tasks" && (
        <section className="space-content">
          <div className="space-section-heading"><div><span className="panel-kicker">KEEP THE MOMENTUM</span><h2>Project tasks</h2><p>{completedTasks} of {tasks.length} complete</p></div><button className="button button-primary" onClick={onAddTask} type="button"><Icon name="plus" size={16} /> Add task</button></div>
          <div className="space-task-list">
            {tasks.map((task) => (
              <article className={`task-row ${task.done ? "task-done" : ""}`} key={task.id}>
                <button className={`task-check ${task.done ? "checked" : ""}`} type="button" aria-label={task.done ? `Mark ${task.title} as not done` : `Complete ${task.title}`} aria-pressed={task.done} onClick={() => onToggleTask(task.id)}>{task.done && <Icon name="check" size={14} />}</button>
                <div className="task-main"><strong>{task.title}</strong><span>{task.project}</span></div>
                <span className={`priority priority-${task.priority.toLowerCase()}`}><i />{task.priority}</span>
                <span className={`task-due ${task.due === "Today" ? "due-today" : ""}`}><Icon name="clock" size={15} />{task.due}</span>
                <span className="avatar task-avatar">{task.initials}</span>
              </article>
            ))}
            {tasks.length === 0 && <div className="space-empty-state"><span><Icon name="check" size={21} /></span><h3>A clean slate.</h3><p>Add the first task to get this project moving.</p><button className="button button-primary" onClick={onAddTask} type="button"><Icon name="plus" size={16} /> Add a task</button></div>}
          </div>
        </section>
      )}

      {activeTab === "Notes" && (
        <section className="space-content">
          <div className="space-section-heading"><div><span className="panel-kicker">THE THINKING BEHIND IT</span><h2>Project notes</h2><p>Keep decisions, ideas, and useful little details close.</p></div><button className="button button-primary" onClick={() => openNote()} type="button"><Icon name="plus" size={16} /> New note</button></div>
          <div className="note-grid">
            {space.notes.map((note, index) => (
              <button className={`note-card note-card-${index % 3}`} key={note.id} onClick={() => openNote(note)} type="button">
                <span className="note-card-top"><Icon name="note" size={17} /><span>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(note.updatedAt))}</span></span>
                <strong>{note.title}</strong><span className="note-card-body">{note.body}</span><span className="note-card-footer">Open note <Icon name="arrow" size={14} /></span>
              </button>
            ))}
            <button className="note-add-card" onClick={() => openNote()} type="button"><span><Icon name="plus" size={19} /></span><strong>Catch a thought</strong><small>Save a note for the team.</small></button>
          </div>
        </section>
      )}

      {activeTab === "Sprints" && (
        <section className="space-content">
          <div className="space-section-heading"><div><span className="panel-kicker">WORK IN RHYTHM</span><h2>Sprints</h2><p>Break the big picture into focused, finishable stretches.</p></div><button className="button button-primary" onClick={() => setComposer("sprint")} type="button"><Icon name="plus" size={16} /> Plan sprint</button></div>
          <div className="sprint-list">
            {space.sprints.map((sprint, index) => (
              <article className="sprint-card" key={sprint.id}>
                <div className={`sprint-card-symbol sprint-symbol-${index % 3}`}><Icon name="target" size={20} /></div>
                <div className="sprint-card-main"><div className="sprint-card-title"><h3>{sprint.name}</h3><span className={`sprint-status status-${sprint.status.toLowerCase()}`}>{sprint.status}</span></div><p>{sprint.goal || "A focused sprint toward the project goal."}</p><span className="sprint-date-range"><Icon name="calendar" size={15} /> {formatDate(sprint.startDate)} — {formatDate(sprint.endDate)}</span></div>
                <button className="sprint-status-action" onClick={() => onUpdateSpace((current) => ({ ...current, sprints: current.sprints.map((item) => item.id === sprint.id ? { ...item, status: nextSprintStatus(item.status) } : item) }))} type="button">{sprint.status === "Active" ? "Complete sprint" : sprint.status === "Completed" ? "Reopen sprint" : "Start sprint"} <Icon name="arrow" size={14} /></button>
              </article>
            ))}
            {space.sprints.length === 0 && <div className="space-empty-state"><span><Icon name="target" size={21} /></span><h3>Give the work a rhythm.</h3><p>Plan your first sprint with a goal and a finish line.</p><button className="button button-primary" onClick={() => setComposer("sprint")} type="button"><Icon name="plus" size={16} /> Plan a sprint</button></div>}
          </div>
        </section>
      )}

      {activeTab === "Meetings" && (
        <section className="space-content">
          <div className="space-section-heading"><div><span className="panel-kicker">GOOD THINGS HAPPEN TOGETHER</span><h2>Meetings</h2><p>Keep check-ins, workshops, and decisions connected to the work.</p></div><button className="button button-primary" onClick={() => setComposer("meeting")} type="button"><Icon name="plus" size={16} /> Schedule meeting</button></div>
          <div className="meeting-list">
            {space.meetings.map((meeting) => (
              <article className="meeting-card" key={meeting.id}>
                <div className="meeting-date-tile"><strong>{new Date(`${meeting.date}T12:00:00`).getDate()}</strong><span>{new Intl.DateTimeFormat("en", { month: "short" }).format(new Date(`${meeting.date}T12:00:00`)).toUpperCase()}</span></div>
                <div className="meeting-card-main"><span className="panel-kicker">{formatDate(meeting.date)} · {meeting.time}</span><h3>{meeting.title}</h3><p>{meeting.notes || "No meeting notes yet."}</p><div className="meeting-people"><Icon name="users" size={15} /> {meeting.attendees || "No attendees added"}</div></div>
              </article>
            ))}
            {space.meetings.length === 0 && <div className="space-empty-state"><span><Icon name="calendar" size={21} /></span><h3>Bring the right people together.</h3><p>Plan your first project check-in or working session.</p><button className="button button-primary" onClick={() => setComposer("meeting")} type="button"><Icon name="plus" size={16} /> Schedule meeting</button></div>}
          </div>
        </section>
      )}

      {activeTab === "Links" && (
        <section className="space-content">
          <div className="space-section-heading"><div><span className="panel-kicker">TOOLS FOR THIS PROJECT</span><h2>Connected platforms</h2><p>Keep related apps one click away. Data sync requires a platform API integration.</p></div><button className="button button-primary" onClick={() => setComposer("link")} type="button"><Icon name="plus" size={16} /> Add platform URL</button></div>
          <div className="project-link-list">
            {space.links.map((link) => (
              <a className="project-link-card" href={link.url} key={link.id} rel="noreferrer" target="_blank">
                <span className="project-link-icon"><Icon name="arrow" size={17} /></span>
                <span><strong>{link.label}</strong><small>{link.url}</small></span>
                <Icon name="arrow" size={15} />
              </a>
            ))}
            {space.links.length === 0 && <div className="space-empty-state"><span><Icon name="arrow" size={21} /></span><h3>Bring your tools together.</h3><p>Add links to the PWA tools your team uses. Orbit stores links only for now; it doesn’t sync their data.</p><button className="button button-primary" onClick={() => setComposer("link")} type="button"><Icon name="plus" size={16} /> Add a platform URL</button></div>}
          </div>
        </section>
      )}

      {composer && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer(); }}>
          <section aria-labelledby="space-composer-title" aria-modal="true" className="composer-modal space-composer-modal" role="dialog">
            <div className="modal-heading">
              <div><span className="modal-kicker">{composer === "note" ? "A THOUGHT WORTH KEEPING" : composer === "sprint" ? "MAKE THE NEXT STRETCH COUNT" : composer === "link" ? "KEEP YOUR TOOLS CLOSE" : "GET THE RIGHT PEOPLE TOGETHER"}</span><h2 id="space-composer-title">{composer === "note" ? editingNote ? "Edit note" : "New project note" : composer === "sprint" ? "Plan a sprint" : composer === "link" ? "Add a platform URL" : "Schedule a meeting"}</h2></div>
              <button aria-label="Close dialog" className="icon-button" onClick={closeComposer} type="button"><Icon name="close" size={19} /></button>
            </div>
            <form onSubmit={submitForm}>
              {composer === "note" && (
                <>
                  <label className="form-field"><span>Note title</span><input autoFocus defaultValue={editingNote?.title ?? ""} maxLength={100} name="title" placeholder="Give this thought a name" required /></label>
                  <label className="form-field"><span>Your note</span><textarea defaultValue={editingNote?.body ?? ""} maxLength={3000} name="body" placeholder="Capture decisions, ideas, or useful details..." required rows={6} /></label>
                </>
              )}
              {composer === "sprint" && (
                <>
                  <label className="form-field"><span>Sprint name</span><input autoFocus maxLength={80} name="name" placeholder="e.g. Sprint 04 — Ship the story" required /></label>
                  <label className="form-field"><span>What does success look like?</span><textarea maxLength={500} name="goal" placeholder="The one clear outcome this sprint should deliver..." rows={3} /></label>
                  <div className="form-row"><label className="form-field"><span>Start date</span><input name="startDate" type="date" required /></label><label className="form-field"><span>End date</span><input name="endDate" type="date" required /></label></div>
                </>
              )}
              {composer === "meeting" && (
                <>
                  <label className="form-field"><span>Meeting name</span><input autoFocus maxLength={100} name="title" placeholder="e.g. Weekly design check-in" required /></label>
                  <div className="form-row"><label className="form-field"><span>Date</span><input name="date" type="date" required /></label><label className="form-field"><span>Time</span><input name="time" type="time" required /></label></div>
                  <label className="form-field"><span>Who’s joining?</span><input maxLength={180} name="attendees" placeholder="Add names, separated by commas" /></label>
                  <label className="form-field"><span>Agenda or notes</span><textarea maxLength={1000} name="notes" placeholder="What should everyone leave knowing?" rows={3} /></label>
                </>
              )}
              {composer === "link" && (
                <>
                  <label className="form-field"><span>Platform name</span><input autoFocus maxLength={80} name="label" placeholder="e.g. Figma, Trello, or another PWA" required /></label>
                  <label className="form-field"><span>Web address</span><input maxLength={500} name="url" placeholder="https://…" required type="url" /></label>
                  {linkError && <p className="link-error" role="alert">{linkError}</p>}
                </>
              )}
              <div className="modal-actions"><button className="button button-secondary" onClick={closeComposer} type="button">Cancel</button><button className="button button-primary" type="submit"><Icon name="plus" size={16} /> {composer === "note" ? "Save note" : composer === "sprint" ? "Create sprint" : composer === "link" ? "Add URL" : "Add meeting"}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

export default ProjectWorkspace;
