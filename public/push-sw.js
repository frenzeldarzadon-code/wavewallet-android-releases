/*
 * Phone notification handler, imported by the generated app service worker.
 *
 * Shows the short lock-screen text the server sent and, on tap, opens (or
 * focuses) ONE WAVE at the linked screen. Sign-in is handled by the app
 * itself: a signed-out tap lands on the login screen and continues to the
 * linked screen afterwards.
 */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "ONE WAVE", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "ONE WAVE";
  const link = typeof data.link === "string" && data.link.startsWith("/") ? data.link : "/universe/notifications";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { link, id: data.id || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/universe/notifications";
  const target = new URL(link, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          if ("navigate" in client) {
            return client.navigate(target).then((c) => (c || client).focus());
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

// The browser rotated the subscription: re-subscribe and let the app store it
// on its next open (the app refreshes the registration whenever it starts).
self.addEventListener("pushsubscriptionchange", (event) => {
  const options = event.oldSubscription ? event.oldSubscription.options : undefined;
  if (!options) return;
  event.waitUntil(self.registration.pushManager.subscribe(options).catch(() => undefined));
});
