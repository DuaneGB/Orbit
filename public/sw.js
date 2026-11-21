self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() ?? "" };
  }
  event.waitUntil(self.registration.showNotification(payload.title || "Orbit update", {
    body: payload.body || "Your shared workspace has an update.",
    icon: "/orbit-icon.svg",
    badge: "/orbit-icon.svg",
    data: { url: payload.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url || "/", self.location.origin);
  const targetUrl = requestedUrl.origin === self.location.origin ? requestedUrl.href : self.location.origin;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => client.url === targetUrl);
    return existing ? existing.focus() : self.clients.openWindow(targetUrl);
  }));
});
