import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { apiRequest, ApiRequestError } from "./client-api";
import { Icon } from "./Icon";
import { PushNotifications } from "./PushNotifications";
import type { DashboardData } from "./project-types";

type DeviceInfo = {
  id: string;
  name: string;
  role: "owner" | "member";
  createdAt: string;
};

export type CollaborationContext = {
  workspace: { id: string; name: string };
  device: { id: string; name: string; role: "owner" | "member" };
  initialInviteCode?: string;
};

type WorkspaceInfoResponse = CollaborationContext;
type DeviceListResponse = { devices: DeviceInfo[] };

function defaultDeviceName() {
  return navigator.platform ? `${navigator.platform} device` : "This device";
}

export function CollaborationGate({
  initialData,
  children,
}: {
  initialData: DashboardData;
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
    void apiRequest<WorkspaceInfoResponse>("/api/workspace/me").then((response) => {
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

  useEffect(() => {
    const handleWorkspaceRenamed = (event: Event) => {
      const name = (event as CustomEvent<{ name?: unknown }>).detail?.name;
      if (typeof name !== "string") return;
      setContext((current) => current
        ? { ...current, workspace: { ...current.workspace, name } }
        : current);
    };
    window.addEventListener("orbit:workspace-renamed", handleWorkspaceRenamed);
    return () => window.removeEventListener("orbit:workspace-renamed", handleWorkspaceRenamed);
  }, []);

  if (loading) {
    return <main className="auth-shell"><section className="auth-card"><h1>Connecting to Orbit…</h1><p>Checking this device’s workspace access.</p></section></main>;
  }
  if (!context) {
    return <AccessForm
      error={error}
      initialData={initialData}
      onConnected={setContext}
      onRetry={() => setRetry((count) => count + 1)}
    />;
  }
  return <>{children(context)}</>;
}

function AccessForm({
  error: initialError,
  initialData,
  onConnected,
  onRetry,
}: {
  error: string;
  initialData: DashboardData;
  onConnected: (context: CollaborationContext) => void;
  onRetry: () => void;
}) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const deviceName = String(form.get("deviceName") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      const response = mode === "create"
        ? await apiRequest<WorkspaceInfoResponse & { initialInviteCode?: string }>("/api/workspace/create", {
            method: "POST",
            body: JSON.stringify({
              name: String(form.get("workspaceName") ?? "").trim(),
              deviceName,
              initialData,
            }),
          })
        : await apiRequest<WorkspaceInfoResponse>("/api/workspace/join", {
            method: "POST",
            body: JSON.stringify({
              inviteCode: String(form.get("inviteCode") ?? "").trim(),
              deviceName,
            }),
          });
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
        <h1>{mode === "create" ? "Make a space for both of you." : "Join your shared space."}</h1>
        <p>No account or password. A one-time invite code gives this device a revocable access key.</p>
        {initialError && <p className="push-message-error" role="alert">{initialError}</p>}
        {error && <p className="push-message-error" role="alert">{error}</p>}
        <div className="auth-mode-switch" role="tablist" aria-label="Workspace access">
          <button aria-selected={mode === "create"} className={mode === "create" ? "active" : ""} onClick={() => { setMode("create"); setError(""); }} role="tab" type="button">Create workspace</button>
          <button aria-selected={mode === "join"} className={mode === "join" ? "active" : ""} onClick={() => { setMode("join"); setError(""); }} role="tab" type="button">Join with code</button>
        </div>
        <form onSubmit={submit}>
          {mode === "create" ? (
            <label className="form-field"><span>Workspace name</span><input autoFocus maxLength={70} name="workspaceName" placeholder="e.g. Our studio" required /></label>
          ) : (
            <label className="form-field"><span>One-time invite code</span><input autoFocus autoCapitalize="characters" maxLength={80} name="inviteCode" placeholder="Paste your invite code" required /></label>
          )}
          <label className="form-field"><span>This device’s name</span><input defaultValue={defaultDeviceName()} maxLength={60} name="deviceName" required /></label>
          <button className="button button-primary auth-submit" disabled={busy} type="submit">{busy ? "Connecting…" : mode === "create" ? "Create shared workspace" : "Join workspace"} <Icon name="arrow" size={16} /></button>
        </form>
        <button className="auth-retry" onClick={onRetry} type="button">Already connected? Check access again</button>
      </section>
    </main>
  );
}

export function TeamTools({
  workspace,
  device,
  initialInviteCode,
  onForgetDevice,
}: CollaborationContext & { onForgetDevice: () => void }) {
  const [inviteCode, setInviteCode] = useState(initialInviteCode ?? "");
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadDevices() {
    try {
      const response = await apiRequest<DeviceListResponse>("/api/workspace/devices");
      setDevices(response.devices);
      setError("");
    } catch (loadError) {
      console.error("Could not load workspace devices.", loadError);
      setError(loadError instanceof Error ? loadError.message : "Could not load devices.");
    }
  }

  useEffect(() => { void loadDevices(); }, [workspace.id]);

  async function createInvite() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await apiRequest<{ code: string }>("/api/workspace/invites", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setInviteCode(response.code);
      setMessage("Share this one-time code with your partner. It expires after 24 hours.");
    } catch (inviteError) {
      console.error("Could not create an invite code.", inviteError);
      setError(inviteError instanceof Error ? inviteError.message : "Could not create an invite code.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeDevice(target: DeviceInfo) {
    if (!window.confirm(`Revoke access for “${target.name}”?`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest("/api/workspace/devices", {
        method: "DELETE",
        body: JSON.stringify({ deviceId: target.id }),
      });
      setMessage(`Access for ${target.name} has been revoked.`);
      await loadDevices();
    } catch (revokeError) {
      console.error("Could not revoke device access.", revokeError);
      setError(revokeError instanceof Error ? revokeError.message : "Could not revoke device access.");
    } finally {
      setBusy(false);
    }
  }

  async function forgetDevice() {
    if (!window.confirm("Remove this device’s access to the shared workspace?")) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/workspace/forget-device", { method: "POST", body: JSON.stringify({}) });
      onForgetDevice();
    } catch (forgetError) {
      console.error("Could not remove this device.", forgetError);
      setError(forgetError instanceof Error ? forgetError.message : "Could not remove this device.");
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteCode);
      setMessage("Invite code copied.");
    } catch (copyError) {
      console.error("Could not copy the invite code.", copyError);
      setError("Could not copy the code. Select and copy it manually.");
    }
  }

  return (
    <section id="team-tools" aria-label="Shared workspace tools" className="team-tools workspace-menu-tools">
      {device.role === "owner" && (
        <div className="team-tools-controls">
          <button className="workspace-menu-action" disabled={busy} onClick={() => void createInvite()} type="button"><Icon name="plus" size={15} /> Create invite code</button>
          {inviteCode && <div className="invite-code-display"><code>{inviteCode}</code><button className="text-button" onClick={() => void copyInvite()} type="button">Copy</button></div>}
          <div className="device-list" aria-label="Connected devices">
            {devices.map((item) => <div className="device-row" key={item.id}><span>{item.name}{item.id === device.id ? " (this device)" : ""}</span><small>{item.role}</small>{item.id !== device.id && <button className="text-button" disabled={busy} onClick={() => void revokeDevice(item)} type="button">Revoke</button>}</div>)}
          </div>
        </div>
      )}
      <PushNotifications />
      <button className="workspace-menu-action" disabled={busy} onClick={() => void forgetDevice()} type="button">Remove this device</button>
      {(message || error) && <p className={error ? "push-message push-message-error" : "push-message"} role={error ? "alert" : "status"}>{error || message}</p>}
    </section>
  );
}
