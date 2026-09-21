// Native notifications are intentionally requested from a user action (the
// notification bell). Mobile browsers can block permission prompts that are
// triggered automatically on page load.
export async function requestDeviceNotificationPermission() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return "unsupported";
  }

  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }

  return Notification.permission;
}

export async function showDeviceNotification({ title, body, tag, url }) {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body,
    icon: "/assets/queencasy192x192.png",
    badge: "/assets/queencasy192x192.png",
    tag,
    renotify: false,
    data: { url },
  });
}
