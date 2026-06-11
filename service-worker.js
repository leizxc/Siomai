const staticCacheName = 'site-static-v1';
const dynamicCache = 'site-dynamic-v1';

const asset = [
  './index.html',
  './js/app.js',
  './js/materialize.min.js',
  './css/login.css',
  './css/materialize.min.css',
  './assets/queencassy.jpg',
  './js/install.js',
  './admin/adminpanel.html',   
  './css/admin.css',
  './admin/refresh.js',
  './frontfirebase.js',
  './employee/siomai/userpanel.html',
  'https://fonts.googleapis.com/icon?family=Material+Icons',
  'https://fonts.gstatic.com/s/materialicons/v47/flUhRq6tzZclQEJ-Vdg-IuiaDsNcIhQ8tQ.woff2'
];


//install service worker
self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(staticCacheName).then(cache => {
      console.log('Caching shell assets');
      return cache.addAll(asset);
    })
  );
});

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
        // cache only GET requests
        if (evt.request.method === "GET") {
          return caches.open(dynamicCache).then(cache => {
            cache.put(evt.request, fetchRes.clone());
            return fetchRes;
          });
        } else {
          return fetchRes; // skip caching for POST, PUT, DELETE
        }
      }).catch(() => cacheRes); // fallback kapag failed ang fetch
    })
  );
});
