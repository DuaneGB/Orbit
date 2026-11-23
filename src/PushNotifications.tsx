import { useEffect, useState } from "react";
import { apiRequest } from "./client-api";

function decodeVapidKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function PushNotifications() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;

  useEffect(() => {
    let active = true;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !publicKey) return;
    setSupported(true);
    navigator.serviceWorker.register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (active) setEnabled(Boolean(subscription));
      })
      .catch((registrationError: unknown) => {
        console.error("Could not register the push service worker.", registrationError);
        if (active) setError("Browser notifications could not be initialized.");
      });
    return () => { active = false; };
  }, [publicKey]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Allow notifications in your browser to enable push alerts.");
      const registration = await navigator.serviceWorker.register("/sw.js");
      const subscription = await registration.pushManager.getSubscription() ??
        await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(publicKey),
        });
      await apiRequest("/api/workspace/push", {
        method: "POST",
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });
      setEnabled(true);
      setMessage("Browser notifications are enabled on this device.");
    } catch (enableError) {
      console.error("Could not enable browser push notifications.", enableError);
      setError(enableError instanceof Error ? enableError.message : "Could not enable browser notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await apiRequest("/api/workspace/push", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        const removed = await subscription.unsubscribe();
        if (!removed) throw new Error("The browser did not remove the push subscription.");
      }
      setEnabled(false);
      setMessage("Browser notifications are disabled on this device.");
    } catch (disableError) {
      console.error("Could not disable browser push notifications.", disableError);
      setError(disableError instanceof Error ? disableError.message : "Could not disable browser notifications.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="push-controls">
      {supported ? (
        <button className="button button-secondary" disabled={busy} onClick={() => void (enabled ? disable() : enable())} type="button">
          {busy ? "Updating…" : enabled ? "Disable notifications" : "Enable notifications"}
        </button>
      ) : (
        <span className="push-unavailable">Push setup needs a supported browser and VAPID public key.</span>
      )}
      {(message || error) && <span className={error ? "push-message push-message-error" : "push-message"} role={error ? "alert" : "status"}>{error || message}</span>}
    </div>
  );
}
