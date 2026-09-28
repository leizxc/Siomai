import { messaging, db } from "./frontfirebase.js";
import { getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Handle foreground messages
onMessage(messaging, (payload) => {
  console.log("Foreground notification received:", payload);
  showDeviceNotification({
    title: payload.notification.title,
    body: payload.notification.body,
    tag: payload.data?.tag || "fcm-notif",
    url: payload.data?.url || "/index.html"
  });
});

/**
 * Nagre-request ng permission at kinukuha ang FCM token para i-save sa Firestore.
 * @param {string} userDocId - Ang document ID ng user sa 'users' collection.
 */
export async function requestDeviceNotificationPermission(userDocId = null) {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    console.warn("Notifications not supported in this browser.");
    return "unsupported";
  }

  try {
    const permission = await Notification.requestPermission();
    
    if (permission === "granted" && userDocId) {
      // Kunin ang existing service worker registration
      const registration = await navigator.serviceWorker.getRegistration();
      
      const token = await getToken(messaging, {
        vapidKey: "BF16lEWakSzGFu3GL3SxuJhhcbzJrYj2q38uXDZPFTm-MIxxoMHLPFzxC98Eb0jpOvEzaVOZG36vhPR_-IYsRpQ",
        serviceWorkerRegistration: registration // Gamitin ang registration natin
      });

      if (token) {
        const userRef = doc(db, "users", userDocId);
        await updateDoc(userRef, {
          fcmToken: token,
          notificationEnabled: true,
          lastTokenUpdate: new Date()
        });
        console.log("FCM Token saved to Firestore:", token);
      }
    }
    return permission;
  } catch (error) {
    console.error("FCM Error:", error);
    return "error";
  }
}

/**
 * Nagpapakita ng local notification via Service Worker.
 */
export async function showDeviceNotification({ title, body, tag, url }) {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      icon: "/assets/queencasy192x192.png",
      badge: "/assets/queencasy192x192.png",
      tag: tag || "default-tag",
      renotify: true,
      requireInteraction: true, // Forces the notification to stay visible until dismissed
      vibrate: [300, 100, 300, 100, 400], // Stronger vibration pattern
      data: { url },
      actions: [
        { action: 'open', title: 'Open App' }
      ]
    });
  } catch (error) {
    console.error("Error showing local notification:", error);
  }
}
