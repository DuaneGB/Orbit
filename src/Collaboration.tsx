import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiRequest, ApiRequestError } from "./client-api";
import { timeAgo } from "./AppsView";
import { Icon } from "./Icon";
import { PushNotifications } from "./PushNotifications";
import type { DashboardData } from "./project-types";

type DeviceInfo = {
  id: string;
  name: string;
  role: "owner" | "member";
  createdAt: string;
  lastSeenAt: string;
};

export type CollaborationContext = {
  workspace: { id: string; name: string };
  device: { id: string; name: string; role: "owner" | "member" };
  initialInviteCode?: string;
};

type DeviceListResponse = { devices: DeviceInfo[] };

function defaultDeviceName() {
  const agent = navigator.userAgent;
  const kind = /iPhone/.test(agent) ? "iPhone"
    : /iPad/.test(agent) ? "iPad"
      : /Android/.test(agent) ? "Android"
        : /Mac/.test(agent) ? "Mac"
          : /Windows/.test(agent) ? "Windows PC"
            : "This device";
  const browser = /Edg\//.test(agent) ? "Edge" : /Chrome\//.test(agent) ? "Chrome" : /Firefox\//.test(agent) ? "Firefox" : /Safari\//.test(agent) ? "Safari" : "";
  return browser ? `${kind} · ${browser}` : kind;
}

export function CollaborationGate({
  importData,
  children,
}: {
  /** Data saved in this browser before it joined a workspace, offered for import on create. */
  importData: DashboardData | null;
  children: (context: CollaborationContext) => ReactNode;
}) {
  const [context, setContext] = useState<CollaborationContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void apiRequest<CollaborationContext>("/api/workspace/me").then((response) => {
      if (active) setContext(response);
    }).catch((loadError: unknown) => {
      if (!active) return;
      if (!(loadError instanceof ApiRequestError && loadError.status === 401)) {
        console.error("Could not check the current workspace device.", loadError);
        setError(loadError instanceof Error ? loadError.message : "Could not connect to Orbit.");
      }
      setContext(null);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    const handleExpired = () => {
      setContext(null);
      setLoading(false);
      setError("");
    };
    window.addEventListener("orbit:device-expired", handleExpired);
    return () => window.removeEventListener("orbit:device-expired", handleExpired);
  }, []);

  if (loading) {
    return <main className="auth-shell"><section className="auth-card"><h1>Connecting to Orbit…</h1><p>Checking this device's workspace access.</p></section></main>;
  }
  if (!context) {
    return <AccessForm error={error} importData={importData} onConnected={setContext} onRetry={() => setRetry((count) => count + 1)} />;
  }
  return <>{children(context)}</>;
}

function AccessForm({
  error: initialError,
  importData,
  onConnected,
  onRetry,
}: {
  error: string;
  importData: DashboardData | null;
  onConnected: (context: CollaborationContext) => void;
  onRetry: () => void;
}) {
  const inviteFromUrl = new URLSearchParams(window.location.search).get("invite") ?? "";
  const [mode, setMode] = useState<"create" | "join">(inviteFromUrl ? "join" : "create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const importCount = importData ? importData.projects.length + importData.tasks.length : 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const deviceName = String(form.get("deviceName") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const response = mode === "create"
        ? await apiRequest<CollaborationContext>("/api/workspace/create", {
            method: "POST",
            body: JSON.stringify({
              name: String(form.get("workspaceName") ?? "").trim(),
              deviceName,
              setupKey: String(form.get("setupKey") ?? ""),
              initialData: form.get("importLocal") === "on" ? importData : undefined,
            }),
          })
        : await apiRequest<CollaborationContext>("/api/workspace/join", {
            method: "POST",
            body: JSON.stringify({ inviteCode: String(form.get("inviteCode") ?? "").trim(), deviceName }),
          });
      if (inviteFromUrl) window.history.replaceState(null, "", window.location.pathname);
      onConnected(response);
    } catch (submitError) {
      console.error("Could not connect this device to a workspace.", submitError);
      setError(submitError instanceof Error ? submitError.message : "Could not connect to the workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <a className="brand auth-brand" href="/" aria-label="Orbit home"><span className="brand-mark"><span /></span><span>orbit<span className="brand-period">.</span></span></a>
        <span className="modal-kicker">PRIVATE SHARED WORKSPACE</span>
        <h1>{mode === "create" ? "Make a space for your team." : "Join your shared space."}</h1>
        <p>No account or password. A one-time invite code gives each device its own key, which an owner can revoke at any time.</p>
        {initialError && <p className="push-message-error" role="alert">{initialError}</p>}
        {error && <p className="push-message-error" role="alert">{error}</p>}
        <div className="auth-mode-switch" role="tablist" aria-label="Workspace access">
          <button aria-selected={mode === "create"} className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setError(""); }} role="tab" type="button">Create workspace</button>
          <button aria-selected={mode === "join"} className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setError(""); }} role="tab" type="button">Join with code</button>
        </div>
        <form onSubmit={submit}>
          {mode === "create" ? (
            <>
              <label className="form-field"><span>Workspace name</span><input autoFocus maxLength={80} name="workspaceName" placeholder="e.g. Our studio" required /></label>
              <label className="form-field"><span>Setup key <small>(only if your admin set one)</small></span><input autoComplete="off" name="setupKey" type="password" /></label>
              {importCount > 0 && (
                <label className="checkbox-field"><input defaultChecked name="importLocal" type="checkbox" /> Bring the {importCount} projects and tasks saved in this browser</label>
              )}
            </>
          ) : (
            <label className="form-field"><span>One-time invite code</span><input autoCapitalize="characters" autoFocus defaultValue={inviteFromUrl} maxLength={20} name="inviteCode" placeholder="XXXX-XXXX-XXXX" required /></label>
          )}
          <label className="form-field"><span>This device's name</span><input defaultValue={defaultDeviceName()} maxLength={60} name="deviceName" required /></label>
          <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? "Connecting…" : mode === "create" ? "Create shared workspace" : "Join workspace"} <Icon name="arrow" size={16} /></button>
        </form>
        <button className="auth-retry" onClick={onRetry} type="button">Already connected? Check access again</button>
      </section>
    </main>
  );
}

type GoogleStatus = { configured: boolean; connected: boolean; connectedAt: string | null; lastSyncedAt: string | null };

function GoogleCalendarPanel({ isOwner, onSynced }: { isOwner: boolean; onSynced: () => void }) {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(() => {
    const outcome = new URLSearchParams(window.location.search).get("google");
    return outcome === "connected" ? "Google Calendar connected. Run a sync to bring events across." : outcome === "error" ? "Google Calendar could not be connected. Try again." : "";
  });

  const load = useCallback(async () => {
    try {
      setStatus(await apiRequest<GoogleStatus>("/api/google/status"));
    } catch (loadError) {
      console.error("Could not check Google Calendar.", loadError);
    }
  }, []);

  useEffect(() => {
    void load();
    if (new URLSearchParams(window.location.search).has("google")) window.history.replaceState(null, "", window.location.pathname);
  }, [load]);

  async function run(action: "connect" | "sync" | "disconnect") {
    setBusy(true);
    setMessage("");
    try {
      if (action === "connect") {
        const { url } = await apiRequest<{ url: string }>("/api/google/auth", { method: "POST", body: "{}" });
        window.location.assign(url);
        return;
      }
      if (action === "disconnect") {
        if (!window.confirm("Disconnect Google Calendar? Events already in Orbit stay; they stop syncing.")) return;
        await apiRequest("/api/google/disconnect", { method: "POST", body: "{}" });
        setMessage("Google Calendar disconnected.");
      } else {
        const report = await apiRequest<{ sentToGoogle: number; receivedFromGoogle: number; removed: number }>("/api/google/sync", {
          method: "POST",
          body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
        });
        setMessage(`Synced: ${report.sentToGoogle} sent, ${report.receivedFromGoogle} received, ${report.removed} removed.`);
        onSynced();
      }
      await load();
    } catch (actionError) {
      setMessage(actionError instanceof Error ? actionError.message : "Google Calendar request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!status?.configured) {
    return <p className="settings-help">Google Calendar sync needs Google OAuth settings on the server. See the README.</p>;
  }
  return (
    <div className="settings-row-group">
      <p className="settings-help">
        {status.connected
          ? `Connected ${timeAgo(status.connectedAt)}. Last synced ${timeAgo(status.lastSyncedAt)}. Events from 30 days ago to a year ahead sync both ways.`
          : "Two-way sync between Orbit's calendar and the owner's Google Calendar. Every device in the workspace will see the synced events."}
      </p>
      <div className="settings-actions">
        {status.connected && <button className="button button-secondary" disabled={busy} onClick={() => void run("sync")} type="button"><Icon name="refresh" size={15} /> Sync now</button>}
        {isOwner && !status.connected && <button className="button button-primary" disabled={busy} onClick={() => void run("connect")} type="button">Connect Google Calendar</button>}
        {isOwner && status.connected && <button className="button button-secondary" disabled={busy} onClick={() => void run("disconnect")} type="button">Disconnect</button>}
      </div>
      {message && <p className="push-message" role="status">{message}</p>}
    </div>
  );
}

export function WorkspaceSettings({
  workspace,
  device,
  initialInviteCode,
  backupTools,
  onSynced,
}: CollaborationContext & { backupTools: ReactNode; onSynced: () => void }) {
  const [invite, setInvite] = useState(initialInviteCode ? { code: initialInviteCode, expiresAt: "" } : null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const isOwner = device.role === "owner";

  const loadDevices = useCallback(async () => {
    try {
      const response = await apiRequest<DeviceListResponse>("/api/workspace/devices");
      setDevices(response.devices);
    } catch (loadError) {
      console.error("Could not load workspace devices.", loadError);
      setError(loadError instanceof Error ? loadError.message : "Could not load devices.");
    }
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices, workspace.id]);

  async function act(work: () => Promise<string | void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const done = await work();
      if (done) setMessage(done);
    } catch (actionError) {
      console.error("Workspace action failed.", actionError);
      setError(actionError instanceof Error ? actionError.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const inviteLink = invite ? `${window.location.origin}/?invite=${encodeURIComponent(invite.code)}` : "";

  return (
    <div className="settings-view">
      <section className="welcome-row">
        <div>
          <div className="date-line"><span className="date-dot" />Workspace settings</div>
          <h1>{workspace.name}<span className="heading-period">.</span></h1>
          <p className="welcome-description">Connected as <strong>{device.name}</strong> ({device.role}).</p>
        </div>
      </section>

      {(message || error) && <p className={error ? "sync-warning" : "push-message"} role={error ? "alert" : "status"}>{error || message}</p>}

      <section className="settings-card">
        <div className="settings-card-heading"><div><span className="panel-kicker">PEOPLE AND DEVICES</span><h2>Connected devices</h2></div>
          {isOwner && <button className="button button-primary" disabled={busy} onClick={() => void act(async () => {
            setInvite(await apiRequest<{ code: string; expiresAt: string }>("/api/workspace/invites", { method: "POST", body: "{}" }));
            return "Invite created. It works once and expires in 24 hours.";
          })} type="button"><Icon name="plus" size={15} /> Invite a device</button>}
        </div>
        {invite && (
          <div className="invite-code-display">
            <code>{invite.code}</code>
            <button className="text-button" onClick={() => void act(async () => { await navigator.clipboard.writeText(invite.code); return "Code copied."; })} type="button">Copy code</button>
            <button className="text-button" onClick={() => void act(async () => { await navigator.clipboard.writeText(inviteLink); return "Invite link copied. Opening it fills in the code."; })} type="button">Copy invite link</button>
          </div>
        )}
        <div className="device-list" aria-label="Connected devices">
          {devices.map((item) => (
            <div className="device-row" key={item.id}>
              <span>{item.name}{item.id === device.id ? " (this device)" : ""}</span>
              <small>{item.role} · active {timeAgo(item.lastSeenAt)}</small>
              {isOwner && item.id !== device.id && (
                <span className="device-actions">
                  <button className="text-button" disabled={busy} onClick={() => void act(async () => {
                    await apiRequest("/api/workspace/devices", { method: "PATCH", body: JSON.stringify({ deviceId: item.id, role: item.role === "owner" ? "member" : "owner" }) });
                    await loadDevices();
                    return `${item.name} is now ${item.role === "owner" ? "a member" : "an owner"}.`;
                  })} type="button">{item.role === "owner" ? "Make member" : "Make owner"}</button>
                  <button className="text-button text-danger" disabled={busy} onClick={() => void act(async () => {
                    if (!window.confirm(`Revoke access for “${item.name}”? It will be signed out immediately.`)) return;
                    await apiRequest("/api/workspace/devices", { method: "DELETE", body: JSON.stringify({ deviceId: item.id }) });
                    await loadDevices();
                    return `Access for ${item.name} has been revoked.`;
                  })} type="button">Revoke</button>
                </span>
              )}
            </div>
          ))}
        </div>
        {!isOwner && <p className="settings-help">Only owners can invite or remove devices.</p>}
      </section>

      <section className="settings-card">
        <div className="settings-card-heading"><div><span className="panel-kicker">STAY IN THE LOOP</span><h2>Notifications on this device</h2></div></div>
        <p className="settings-help">Get a browser notification when another device changes something. Alerts are grouped: at most one every two minutes.</p>
        <PushNotifications />
      </section>

      <section className="settings-card">
        <div className="settings-card-heading"><div><span className="panel-kicker">CALENDAR</span><h2>Google Calendar</h2></div></div>
        <GoogleCalendarPanel isOwner={isOwner} onSynced={onSynced} />
      </section>

      <section className="settings-card">
        <div className="settings-card-heading"><div><span className="panel-kicker">YOUR DATA</span><h2>Backups</h2></div></div>
        {backupTools}
      </section>

      <section className="settings-card">
        <div className="settings-card-heading"><div><span className="panel-kicker">THIS DEVICE</span><h2>Leave the workspace</h2></div>
          <button className="button button-secondary" disabled={busy} onClick={() => void act(async () => {
            if (!window.confirm("Remove this device's access? You'll need a new invite code to come back.")) return;
            await apiRequest("/api/workspace/forget-device", { method: "POST", body: "{}" });
            window.dispatchEvent(new Event("orbit:device-expired"));
          })} type="button">Remove this device</button>
        </div>
        <p className="settings-help">Shared data stays in the workspace for everyone else.</p>
      </section>
    </div>
  );
}
