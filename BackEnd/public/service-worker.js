const staticCacheName = 'site-static-v9';
const dynamicCache = 'site-dynamic-v9';

const assets = [
'./index.html',
  './manifest.json',
  './admin/adminpanel.html',
  './employee/siomai/userpanel.html',

  // CSS
  './css/login.css',
  './css/admin.css',
  './css/materialize.min.css',

  // JS
  './js/app.js',
  './js/install.js',
  './js/refresh.js',
  './js/materialize.min.js',
  './js/firebase.js',
  './js/frontfirebase.js',
  './js/IndexDB.js',
  './js/navemployee.js',
  './js/empoleyee.js',

  // Images
  './assets/queencassy.jpg',

  // External fonts
  'https://fonts.googleapis.com/icon?family=Material+Icons',
  'https://fonts.gstatic.com/s/materialicons/v47/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2'
];

//install service worker
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(staticCacheName).then(cache => {
      console.log('Caching shell assets');
      return cache.addAll(assets);
    })
  );
});

//CleanUp Cache
async function CleanupCache() {
  const keys = await caches.keys()
  const keysToDelete = keys.filter(key => key != staticCacheName);
  return Promise.all(keysToDelete.map(key => caches.delete(key)));
}

//activate event
self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys => {
      //console.log(keys);
      return Promise.all(keys
        .filter(key => key !== staticCacheName)
        .map(key => caches.delete(key))
      );
})
  );
});

//fetch event
self.addEventListener('fetch', evt => {
  evt.respondWith(
    caches.match(evt.request).then(cacheRes => {
      return cacheRes || fetch(evt.request).then(fetchRes => {
        if (evt.request.method === "GET") {
          return caches.open(dynamicCache).then(cache => {
            cache.put(evt.request, fetchRes.clone());
            limitCacheSize(dynamicCache, 50);
            return fetchRes;
          });
        } else {
          return fetchRes;
        }
      }).catch(() => {
        //  fallback kapag walang cache at offline
        if (evt.request.url.endsWith('.html')) {
          return caches.match('./index.html');
        }
        if (evt.request.url.endsWith('.js')) {
          return new Response('// offline js', { headers: { 'Content-Type': 'application/javascript' } });
        }
        if (evt.request.url.endsWith('.css')) {
          return new Response('/* offline css */', { headers: { 'Content-Type': 'text/css' } });
        }
        if (evt.request.url.endsWith('.png') || evt.request.url.endsWith('.jpg') || evt.request.url.endsWith('.ico')) {
          return caches.match('./assets/queencassy.jpg');
        }
        return new Response('Offline content unavailable', { status: 200, headers: { 'Content-Type': 'text/plain' } });
      });
    })
  );
});

//cache size limiter
const limitCacheSize = (name, size) => {
  caches.open(name).then(cache => {
    cache.keys().then(keys => {
      if (keys.length > size){
        cache.delete(keys[0]).then(limitCacheSize(name, size));
      }
    });
  });
};
