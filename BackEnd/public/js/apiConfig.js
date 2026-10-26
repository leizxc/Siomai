const hostname = window.location.hostname;
const isFirebaseHosting = [
  "siomai-b3afe.web.app",
  "siomai-b3afe.firebaseapp.com",
].includes(hostname);

// On Firebase Hosting, Hosting rewrites send these API paths to the Cloud Function.
export const API_BASE_URL = isFirebaseHosting
  ? ""
  : "https://siomai-production-79a3.up.railway.app";
