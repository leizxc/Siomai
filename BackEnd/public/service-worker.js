const staticCacheName = "site-static-v17";
const dynamicCache = "site-dynamic-v17";

//firebase cloud messaging
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js",
);
const assets = [
  "./index.html",
  "./manifest.json",
  "./admin/adminpanel.html",
  "./employee/siomai/userpanel.html",

  // CSS
  "./css/login.css",
  "./css/admin.css",
  "./css/materialize.min.css",
  "./css/employee.css",

  // JS 
  "./js/app.js",
  "./js/install.js",
  "./js/refresh.js",
  "./js/materialize.min.js",
  "./js/firebase.js",
  "./js/frontfirebase.js",
  "./js/IndexDB.js",
  "./js/navemployee.js",
  "./js/empoleyee.js",
  "./js/deviceNotifications.js",

  // Images
  "./assets/queencassy.jpg",

  // External fonts
  "https://fonts.googleapis.com/icon?family=Material+Icons",
  "https://fonts.gstatic.com/s/materialicons/v47/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2",
];

firebase.initializeApp({
  apiKey: "AIzaSyC2Ja45yVDE8RzlyI-23z4LW89cy99Yvt0",
  authDomain: "siomai-b3afe.firebaseapp.com",
  projectId: "siomai-b3afe",
  messagingSenderId: "576185589251",
  appId: "1:576185589251:web:cffb3dd4bfd939ae273836",
});


const messaging = firebase.messaging();

// Handling background messages
messaging.onBackgroundMessage((payload) => {
  console.log('Background message received: ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: '/assets/queencasy192x192.png',
    badge: '/assets/queencasy192x192.png',
    tag: payload.data?.tag || 'fcm-push',
    renotify: true,
    requireInteraction: true,
    vibrate: [300, 100, 300, 100, 400],
    data: { url: payload.data?.url || '/index.html' },
    actions: [
      { action: 'open', title: 'View Details' }
    ]
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});


//install service worker
self.addEventListener("install", (evt) => {
  evt.waitUntil(
    caches.open(staticCacheName).then((cache) => {
      console.log("Caching shell assets");
      return cache.addAll(assets).then(() => self.skipWaiting());
    }),
  );
});

//CleanUp Cache
async function CleanupCache() {
  const keys = await caches.keys();
  const keysToDelete = keys.filter((key) => key != staticCacheName);
  return Promise.all(keysToDelete.map((key) => caches.delete(key)));
}

//activate event
self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => {
      //console.log(keys);
      return Promise.all(
        keys
          .filter((key) => key !== staticCacheName)
          .map((key) => caches.delete(key)),
      ).then(() => self.clients.claim());
    }),
  );
});

//fetch event
self.addEventListener("fetch", (evt) => {
  const requestUrl = new URL(evt.request.url);

  // Cache API only supports HTTP(S) requests. Browser extensions can make
  // chrome-extension:// requests while DevTools is open, so let those pass
  // through without trying to cache them.
  if (
    evt.request.method !== "GET" ||
    !["http:", "https:"].includes(requestUrl.protocol)
  ) {
    return;
  }

  evt.respondWith(
    caches.match(evt.request).then((cacheRes) => {
      return (
        cacheRes ||
        fetch(evt.request)
          .then((fetchRes) => {
            if (fetchRes.ok || fetchRes.type === "opaque") {
              return caches.open(dynamicCache).then((cache) => {
                return cache
                  .put(evt.request, fetchRes.clone())
                  .then(() => {
                    limitCacheSize(dynamicCache, 50);
                    return fetchRes;
                  })
                  .catch(() => fetchRes);
              });
            }

            return fetchRes;
          })
          .catch(() => {
            //  fallback kapag walang cache at offline
            if (evt.request.url.endsWith(".html")) {
              return caches.match("./index.html");
            }
            if (evt.request.url.endsWith(".js")) {
              return new Response("// offline js", {
                headers: { "Content-Type": "application/javascript" },
              });
            }
            if (evt.request.url.endsWith(".css")) {
              return new Response("/* offline css */", {
                headers: { "Content-Type": "text/css" },
              });
            }
            if (
              evt.request.url.endsWith(".png") ||
              evt.request.url.endsWith(".jpg") ||
              evt.request.url.endsWith(".ico")
            ) {
              return caches.match("./assets/queencassy.jpg");
            }
            return new Response("Offline content unavailable", {
              status: 200,
              headers: { "Content-Type": "text/plain" },
            });
          })
      );
    }),
  );
});

// Tapping a notification from the phone notification bar returns the user to
// the corresponding system page instead of opening an unrelated browser tab.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./index.html";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const existingClient = windowClients.find((client) =>
          client.url.includes(targetUrl),
        );
        if (existingClient) return existingClient.focus();
        return clients.openWindow(targetUrl);
      }),
  );
});

//cache size limiter
const limitCacheSize = (name, size) => {
  caches.open(name).then((cache) => {
    cache.keys().then((keys) => {
      if (keys.length > size) {
        cache.delete(keys[0]).then(limitCacheSize(name, size));
      }
    });
  });
};
