  if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js', { scope: './' })
    .then(reg => console.log('Service worker registered', reg))
    .catch(err => console.log('Service worker not registered', err));
  }