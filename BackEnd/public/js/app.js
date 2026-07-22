import { syncUsersFromFirebase } from "./IndexDB.js";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("./service-worker.js", { scope: "./" })
    .then((reg) => console.log("Service worker registered", reg))
    .catch((err) => console.log("Service worker not registered", err));
}

// Auto-sync kapag online
if (navigator.onLine) {
  syncUsersFromFirebase();
}
