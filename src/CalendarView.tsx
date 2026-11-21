import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import type { CalendarEvent, EntityId, Project, ProjectSpace, Task } from "./project-types";

type Props = {
  projects: Project[];
  tasks: Task[];
  projectSpaces: Record<string, ProjectSpace>;
  calendarEvents: CalendarEvent[];
  onAddEvent: (event: Omit<CalendarEvent, "id">) => void;
  onUpdateEvent: (id: EntityId, event: Omit<CalendarEvent, "id">) => void;
  onDeleteEvent: (id: EntityId) => void;
  onToggleTask: (id: EntityId) => void;
};

type CalendarItem = {
  id: string;
  title: string;
  date: string;
  time: string;
  project: string;
  kind: "task" | "meeting" | "event";
  done: boolean;
  notes: string;
  sourceId: EntityId;
  reminderMinutesBefore?: number | null;
};

type CalendarMode = "Month" | "Week" | "Agenda";
type NotificationSupport = NotificationPermission | "unsupported";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const reminderOptions = [0, 5, 15, 30, 60, 1440];

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseTaskDue(due: string): string | null {
  const date = new Date();
  if (due === "Today") return dateKey(date);
  if (due === "Tomorrow") {
    date.setDate(date.getDate() + 1);
    return dateKey(date);
  }

  const match = due.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (!match) return null;
  const month = monthNames.findIndex((name) => name.toLowerCase() === match[1].slice(0, 3).toLowerCase());
  const year = Number(match[3] ?? date.getFullYear());
  const day = Number(match[2]);
  const parsedDate = new Date(year, month, day);
  if (month < 0 || parsedDate.getMonth() !== month || parsedDate.getDate() !== day) return null;
  return dateKey(parsedDate);
}

function formatLongDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}

function formatShortDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}

function formatReminderLead(minutes: number) {
  if (minutes === 0) return "At event time";
  if (minutes === 60) return "1 hour before";
  if (minutes === 1440) return "1 day before";
  return `${minutes} minutes before`;
}

function escapeCalendarText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

function CalendarView({ projects, tasks, projectSpaces, calendarEvents, onAddEvent, onUpdateEvent, onDeleteEvent, onToggleTask }: Props) {
  const todayKey = dateKey(new Date());
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [mode, setMode] = useState<CalendarMode>("Month");
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [composerError, setComposerError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const [notificationPermission, setNotificationPermission] = useState<NotificationSupport>(
    () => typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const [reminderMessage, setReminderMessage] = useState("");
  const [reminderError, setReminderError] = useState("");
  const notifiedReminders = useRef(new Set<string>());

  const items = useMemo<CalendarItem[]>(() => [
    ...tasks.flatMap((task) => {
      const date = parseTaskDue(task.due);
      return date
        ? [{ id: `task-${task.id}`, sourceId: task.id, title: task.title, date, time: "", project: task.project, kind: "task" as const, done: task.done, notes: "" }]
        : [];
    }),
    ...projects.flatMap((project) =>
      (projectSpaces[String(project.id)]?.meetings ?? []).map((meeting) => ({
        id: `meeting-${project.id}-${meeting.id}`,
        sourceId: meeting.id,
        title: meeting.title,
        date: meeting.date,
        time: meeting.time,
        project: project.name,
        kind: "meeting" as const,
        done: false,
        notes: meeting.notes,
      })),
    ),
    ...calendarEvents.map((event) => ({
      id: `event-${event.id}`,
      sourceId: event.id,
      title: event.title,
      date: event.date,
      time: event.time,
      project: event.project,
      kind: "event" as const,
      done: false,
      notes: event.notes,
      reminderMinutesBefore: event.reminderMinutesBefore,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)), [calendarEvents, projectSpaces, projects, tasks]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (notificationPermission !== "granted" || typeof Notification === "undefined") return;
    for (const event of calendarEvents) {
      if (typeof event.reminderMinutesBefore !== "number") continue;
      const eventTime = new Date(`${event.date}T${event.time || "09:00"}`).getTime();
      if (!Number.isFinite(eventTime)) continue;
      const reminderTime = eventTime - event.reminderMinutesBefore * 60_000;
      const reminderKey = `${event.id}:${reminderTime}`;
      if (reminderTime > clock || clock >= reminderTime + 15_000 || notifiedReminders.current.has(reminderKey)) continue;
      try {
        new Notification(`Coming up: ${event.title}`, {
          body: event.time ? `Starts at ${event.time}.` : "Your event starts today.",
          tag: reminderKey,
        });
        notifiedReminders.current.add(reminderKey);
      } catch (notificationError) {
        console.error("Could not display a calendar reminder.", notificationError);
        setReminderError("A browser reminder could not be displayed.");
      }
    }
  }, [calendarEvents, clock, notificationPermission]);

  const reminderItems = useMemo(() => calendarEvents
    .filter((event) => typeof event.reminderMinutesBefore === "number")
    .map((event) => ({
      ...event,
      reminderTime: new Date(`${event.date}T${event.time || "09:00"}`).getTime() - (event.reminderMinutesBefore ?? 0) * 60_000,
    }))
    .filter((event) => Number.isFinite(event.reminderTime) && event.reminderTime >= clock)
    .sort((left, right) => left.reminderTime - right.reminderTime), [calendarEvents, clock]);

  const dayEvents = useMemo(() => {
    const grouped = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const group = grouped.get(item.date) ?? [];
      group.push(item);
      grouped.set(item.date, group);
    }
    return grouped;
  }, [items]);

  const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - mondayOffset);
  const monthDays = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  const weekStart = new Date(selectedDate + "T12:00:00");
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    return date;
  });
  const selectedEvents = dayEvents.get(selectedDate) ?? [];
  const upcomingEvents = items.filter((item) => item.date >= todayKey);
  const monthTitle = new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(cursor);

  function navigate(amount: number) {
    if (mode === "Week") {
      const next = new Date(weekStart);
      next.setDate(next.getDate() + amount * 7);
      setSelectedDate(dateKey(next));
      setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
      return;
    }
    if (mode === "Agenda") {
      const next = new Date(selectedDate + "T12:00:00");
      next.setDate(next.getDate() + amount * 7);
      setSelectedDate(dateKey(next));
      setCursor(new Date(next.getFullYear(), next.getMonth(), 1));
      return;
    }
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
    setSelectedDate(dateKey(new Date(cursor.getFullYear(), cursor.getMonth() + amount, 1)));
  }

  function goToToday() {
    const today = new Date();
    setCursor(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(todayKey);
  }

  function selectDate(date: Date) {
    const key = dateKey(date);
    setSelectedDate(key);
    if (date.getMonth() !== cursor.getMonth() || date.getFullYear() !== cursor.getFullYear()) {
      setCursor(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  }

  function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    const reminderValue = String(form.get("reminderMinutesBefore") ?? "");
    const reminderMinutesBefore = reminderValue === "" ? null : Number(reminderValue);
    if (!title || !date) return;
    if (reminderMinutesBefore !== null && !reminderOptions.includes(reminderMinutesBefore)) {
      setComposerError("Choose a valid reminder time.");
      return;
    }
    const eventData = {
      title,
      date,
      time,
      project: String(form.get("project") ?? ""),
      notes: String(form.get("notes") ?? "").trim(),
      reminderMinutesBefore,
    };
    if (editingEvent) onUpdateEvent(editingEvent.id, eventData);
    else onAddEvent(eventData);
    setSelectedDate(date);
    const [year, month] = date.split("-").map(Number);
    setCursor(new Date(year, month - 1, 1));
    setComposerOpen(false);
    setEditingEvent(null);
    setComposerError("");
  }

  function openComposer(event?: CalendarEvent) {
    setEditingEvent(event ?? null);
    setComposerError("");
    setComposerOpen(true);
  }

  function closeComposer() {
    setComposerOpen(false);
    setEditingEvent(null);
    setComposerError("");
  }

  function removeEvent() {
    if (!editingEvent || !window.confirm(`Delete “${editingEvent.title}”?`)) return;
    onDeleteEvent(editingEvent.id);
    closeComposer();
  }

  async function enableBrowserReminders() {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      setReminderError("Browser notifications are not supported here.");
      return;
    }
    setReminderError("");
    setReminderMessage("");
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === "granted") setReminderMessage("Browser reminders are enabled while Orbit is open.");
      else setReminderError("Allow notifications in your browser settings to receive reminders.");
    } catch (permissionError) {
      console.error("Could not request browser reminder permission.", permissionError);
      setReminderError("Browser notification permission could not be requested.");
    }
  }

  function exportIcs() {
    const formatDate = (value: string) => value.replace(/-/g, "");
    const formatDateTime = (date: Date) => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      "T",
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      "00",
    ].join("");
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Orbit//Project Calendar//EN",
      "CALSCALE:GREGORIAN",
      ...items.flatMap((item) => {
        const eventLines = [
          "BEGIN:VEVENT",
          `UID:${escapeCalendarText(item.id)}@orbit.local`,
          `DTSTAMP:${timestamp}`,
          `SUMMARY:${escapeCalendarText(item.title)}`,
          `DESCRIPTION:${escapeCalendarText([item.project, item.kind, item.notes].filter(Boolean).join(" · "))}`,
        ];
        if (item.time) {
          const [hours, minutes] = item.time.split(":").map(Number);
          const start = new Date(`${item.date}T12:00:00`);
          start.setHours(hours, minutes, 0, 0);
          const end = new Date(start);
          end.setHours(end.getHours() + 1);
          eventLines.push(`DTSTART:${formatDateTime(start)}`);
          eventLines.push(`DTEND:${formatDateTime(end)}`);
        } else {
          const endDate = new Date(`${item.date}T12:00:00`);
          endDate.setDate(endDate.getDate() + 1);
          eventLines.push(`DTSTART;VALUE=DATE:${formatDate(item.date)}`);
          eventLines.push(`DTEND;VALUE=DATE:${dateKey(endDate).replace(/-/g, "")}`);
        }
        eventLines.push("END:VEVENT");
        return eventLines;
      }),
      "END:VCALENDAR",
    ];
    const blob = new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "orbit-calendar.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderEvent(item: CalendarItem, editable = false) {
    const content = <>{item.time && <small>{item.time}</small>}{item.title}</>;
    if (editable && item.kind === "event") {
      return (
        <button
          aria-label={`Double-click to edit ${item.title} on ${formatLongDate(item.date)}`}
          className={`calendar-event-chip chip-${item.kind} ${item.done ? "event-done" : ""}`}
          key={item.id}
          onDoubleClick={(event) => {
            event.stopPropagation();
            const calendarEvent = calendarEvents.find((event) => event.id === item.sourceId);
            if (calendarEvent) openComposer(calendarEvent);
          }}
          title="Double-click to edit this event"
          type="button"
        >
          {content}
        </button>
      );
    }
    return (
      <span className={`calendar-event-chip chip-${item.kind} ${item.done ? "event-done" : ""}`} key={item.id} onDoubleClick={(event) => event.stopPropagation()}>
        {content}
      </span>
    );
  }

  return (
    <section className="calendar-workspace">
      <div className="calendar-page-heading">
        <div><span className="panel-kicker">EVERYTHING, IN ITS TIME</span><h1>Your calendar<span className="heading-period">.</span></h1><p>Tasks, team time, and little milestones — all in one place.</p></div>
        <div className="calendar-page-actions">
          <button className="button button-secondary" onClick={exportIcs} type="button"><Icon name="calendar" size={16} /> Export for Google</button>
          <button className="button button-primary" onClick={() => openComposer()} type="button"><Icon name="plus" size={16} /> Add event</button>
        </div>
      </div>

      <section className="calendar-board">
        <div className="calendar-toolbar">
          <div className="calendar-month-controls">
            <button aria-label="Previous period" className="icon-button" onClick={() => navigate(-1)} type="button"><Icon name="back" size={17} /></button>
            <button aria-label="Next period" className="icon-button calendar-next" onClick={() => navigate(1)} type="button"><Icon name="back" size={17} /></button>
            <h2>{mode === "Month" ? monthTitle : mode === "Week" ? `${formatShortDate(dateKey(weekDays[0]))} — ${formatShortDate(dateKey(weekDays[6]))}` : "Upcoming"}</h2>
            <button className="today-button" onClick={goToToday} type="button">Today</button>
          </div>
          <div aria-label="Calendar view" className="calendar-mode-switch" role="tablist">
            {(["Month", "Week", "Agenda"] as const).map((item) => <button aria-selected={mode === item} className={mode === item ? "active" : ""} key={item} onClick={() => setMode(item)} role="tab" type="button">{item}</button>)}
          </div>
        </div>

        {mode === "Month" && (
          <div className="month-calendar">
            <div className="month-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
            <div className="month-grid">
              {monthDays.map((date) => {
                const key = dateKey(date);
                const events = dayEvents.get(key) ?? [];
                return (
                  <div
                    className={`calendar-day-cell ${date.getMonth() !== cursor.getMonth() ? "outside-month" : ""} ${key === selectedDate ? "selected-day" : ""} ${key === todayKey ? "today-cell" : ""}`}
                    key={key}
                    onClick={() => selectDate(date)}
                    onDoubleClick={() => { selectDate(date); openComposer(); }}
                  >
                    <button aria-label={formatLongDate(key)} className="calendar-day-number" onClick={() => selectDate(date)} type="button">{date.getDate()}</button>
                    <div className="calendar-day-events">{events.slice(0, 3).map((item) => renderEvent(item, true))}{events.length > 3 && <span className="more-events">+{events.length - 3} more</span>}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {mode === "Week" && (
          <div className="week-calendar">
            {weekDays.map((date) => {
              const key = dateKey(date);
              return (
                <div
                  className={`week-calendar-day ${key === selectedDate ? "selected-day" : ""} ${key === todayKey ? "today-cell" : ""}`}
                  key={key}
                  onClick={() => selectDate(date)}
                  onDoubleClick={() => { selectDate(date); openComposer(); }}
                >
                  <button className="week-calendar-day-select" onClick={() => selectDate(date)} type="button">
                    <span>{weekdays[(date.getDay() + 6) % 7]}</span><strong>{date.getDate()}</strong>
                  </button>
                  <div>{(dayEvents.get(key) ?? []).slice(0, 4).map((item) => renderEvent(item, true))}</div>
                </div>
              );
            })}
          </div>
        )}

        {mode === "Agenda" && (
          <div className="calendar-agenda">
            {upcomingEvents.length ? upcomingEvents.map((item) => (
              <button
                className="agenda-event"
                key={item.id}
                onClick={() => setSelectedDate(item.date)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (item.kind !== "event") return;
                  const calendarEvent = calendarEvents.find((calendarEvent) => calendarEvent.id === item.sourceId);
                  if (calendarEvent) openComposer(calendarEvent);
                }}
                type="button"
              >
                <span className={`agenda-event-type chip-${item.kind}`} />
                <span className="agenda-event-date">{formatShortDate(item.date)}{item.time && ` · ${item.time}`}</span>
                <span className="agenda-event-title">{item.title}<small>{[item.project, item.kind].filter(Boolean).join(" · ")}</small></span>
                <Icon name="arrow" size={15} />
              </button>
            )) : <div className="calendar-empty">Your upcoming days are wide open. Add an event to get started.</div>}
          </div>
        )}
      </section>

      <section aria-label="Calendar reminders" className="calendar-reminders">
        <div className="calendar-reminders-heading">
          <div>
            <span className="panel-kicker">STAY ONE STEP AHEAD</span>
            <h2>Reminders</h2>
            <p>Browser alerts work while Orbit is open. Push when it’s closed needs a scheduler.</p>
          </div>
          {notificationPermission === "granted"
            ? <span className="reminder-permission">Browser alerts enabled</span>
            : notificationPermission === "unsupported"
              ? <span className="reminder-permission">Browser alerts unavailable</span>
              : <button className="button button-secondary" disabled={notificationPermission === "denied"} onClick={() => void enableBrowserReminders()} type="button">
                  {notificationPermission === "denied" ? "Allow alerts in browser settings" : "Enable browser alerts"}
                </button>}
        </div>
        {(reminderMessage || reminderError) && (
          <p className={reminderError ? "reminder-status reminder-status-error" : "reminder-status"} role={reminderError ? "alert" : "status"}>
            {reminderError || reminderMessage}
          </p>
        )}
        {reminderItems.length ? (
          <div className="calendar-reminder-list">
            {reminderItems.map((event) => (
              <button
                className="calendar-reminder-item"
                key={event.id}
                onClick={() => selectDate(new Date(`${event.date}T12:00:00`))}
                onDoubleClick={(clickEvent) => {
                  clickEvent.stopPropagation();
                  openComposer(event);
                }}
                type="button"
              >
                <span className="calendar-reminder-marker" />
                <span className="calendar-reminder-copy">
                  <strong>{event.title}</strong>
                  <small>{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(event.reminderTime))} · {formatReminderLead(event.reminderMinutesBefore ?? 0)}</small>
                </span>
                <span className="calendar-reminder-edit-hint">Double-click to edit</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="calendar-reminders-empty">No upcoming reminders. New events get a reminder 5 minutes before by default.</div>
        )}
      </section>

      <section className="selected-day-panel">
        <div className="selected-day-heading"><div><span className="panel-kicker">YOUR DAY, AT A GLANCE</span><h2>{formatLongDate(selectedDate)}</h2><p>Double-click a date to add an event, or double-click an event to edit it.</p></div><button className="inline-action" onClick={() => openComposer()} type="button"><Icon name="plus" size={15} /> Add event</button></div>
        <div className="selected-day-events">
          {selectedEvents.length ? selectedEvents.map((item) => (
            <div className={`selected-event ${item.done ? "event-done" : ""}`} key={item.id}>
              {item.kind === "task" ? (
                <button aria-label={item.done ? `Mark ${item.title} incomplete` : `Complete ${item.title}`} aria-pressed={item.done} className={`calendar-task-toggle ${item.done ? "checked" : ""}`} onClick={() => onToggleTask(item.sourceId)} type="button">{item.done && <Icon name="check" size={13} />}</button>
              ) : <span className={`selected-event-marker chip-${item.kind}`} />}
              <span className="selected-event-time">{item.time || "All day"}</span>
              <span className="selected-event-copy"><strong>{item.title}</strong><small>{[item.project, item.kind].filter(Boolean).join(" · ")}</small>{item.kind === "event" && typeof item.reminderMinutesBefore === "number" && <span className="selected-event-reminder">Reminder: {formatReminderLead(item.reminderMinutesBefore)}</span>}{item.notes && <span className="selected-event-notes">{item.notes}</span>}</span>
              {item.kind === "event" && <button className="selected-event-edit" onClick={() => openComposer(calendarEvents.find((event) => event.id === item.sourceId))} type="button">Edit</button>}
            </div>
          )) : <div className="calendar-empty">Nothing planned for this day yet. Make room for something good.</div>}
        </div>
      </section>

      {composerOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComposer(); }}>
          <section aria-labelledby="calendar-event-title" aria-modal="true" className="composer-modal calendar-event-modal" role="dialog">
            <div className="modal-heading"><div><span className="modal-kicker">{editingEvent ? "MAKE A CHANGE" : "PUT IT ON THE MAP"}</span><h2 id="calendar-event-title">{editingEvent ? "Edit calendar event" : "Book something"}</h2></div><button aria-label="Close dialog" className="icon-button" onClick={closeComposer} type="button"><Icon name="close" size={19} /></button></div>
            <form key={String(editingEvent?.id ?? "new")} onSubmit={addEvent}>
              <label className="form-field"><span>What’s happening?</span><input autoFocus defaultValue={editingEvent?.title ?? ""} maxLength={100} name="title" placeholder="e.g. Creative review" required /></label>
              <div className="form-row"><label className="form-field"><span>Date</span><input defaultValue={editingEvent?.date ?? selectedDate} name="date" type="date" required /></label><label className="form-field"><span>Time</span><input defaultValue={editingEvent?.time ?? ""} name="time" type="time" /></label></div>
              <label className="form-field"><span>Project</span><select defaultValue={editingEvent?.project ?? ""} name="project"><option value="">General</option>{projects.map((project) => <option key={project.id} value={project.name}>{project.name}</option>)}</select></label>
              <label className="form-field"><span>Reminder</span><select defaultValue={editingEvent ? String(editingEvent.reminderMinutesBefore ?? "") : "5"} name="reminderMinutesBefore"><option value="">No reminder</option><option value="0">At event time</option><option value="5">5 minutes before</option><option value="15">15 minutes before</option><option value="30">30 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option></select></label>
              <label className="form-field"><span>Details</span><textarea defaultValue={editingEvent?.notes ?? ""} maxLength={1000} name="notes" placeholder="A little context for later..." rows={3} /></label>
              {composerError && <p className="reminder-status reminder-status-error" role="alert">{composerError}</p>}
              <div className="modal-actions">{editingEvent && <button className="button button-danger" onClick={removeEvent} type="button">Delete</button>}<button className="button button-secondary" onClick={closeComposer} type="button">Cancel</button><button className="button button-primary" type="submit"><Icon name={editingEvent ? "check" : "plus"} size={16} /> {editingEvent ? "Save changes" : "Add event"}</button></div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

export default CalendarView;
