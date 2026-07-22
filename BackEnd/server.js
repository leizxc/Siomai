const express = require("express");
const admin = require("firebase-admin");
const path = require("path");

let serviceAccount;
let firebaseReady = false;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log("Using Railway ENV Service Account");
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    console.log("Using Local serviceAccountKey.json");
    serviceAccount = require("./serviceAccountKey.json");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  firebaseReady = true;
  console.log("Firebase Admin Initialized");
} catch (error) {
  console.error("Firebase Admin Initialization Failed:", error.message);
}

const app = express();
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

app.use((req, res, next) => {
  const origin = req.get("Origin");
  // Fall back to the direct Express host when running without a proxy.
  const forwardedHost = req.get("X-Forwarded-Host")?.split(",")[0].trim();
  const forwardedProtocol = req.get("X-Forwarded-Proto")?.split(",")[0].trim();
  const publicHost = forwardedHost || req.get("host");
  const publicProtocol = forwardedProtocol || req.protocol;
  const appOrigin = `${publicProtocol}://${publicHost}`;
  //ngrok testing
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  return req.method === "OPTIONS" ? res.sendStatus(204) : next();

  if (origin && origin !== appOrigin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ success: false, error: "Origin is not allowed" });
  }

  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }

  return req.method === "OPTIONS" ? res.sendStatus(204) : next();
});

app.use(express.json({ limit: "100kb" }));

// Serve static files from BackEnd/public folder
app.use(express.static(path.join(__dirname, "public")));

// Root route → serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.status(firebaseReady ? 200 : 503).json({
    success: firebaseReady,
    firebase: firebaseReady ? "ready" : "unavailable"
  });
});

function getBearerToken(req) {
  const [scheme, token] = (req.get("Authorization") || "").split(" ");
  return scheme === "Bearer" && token ? token : null;
}

async function requireAdmin(req, res, next) {
  if (!firebaseReady) {
    return res.status(503).json({ success: false, error: "Firebase Admin is unavailable" });
  }

  if (adminEmails.size === 0) {
    console.error("ADMIN_EMAILS is not configured");
    return res.status(503).json({ success: false, error: "Admin authorization is not configured" });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ success: false, error: "Authentication token is required" });
  }

  try {
    const user = await admin.auth().verifyIdToken(token);
    const email = user.email?.toLowerCase();

    if (!email || !adminEmails.has(email)) {
      return res.status(403).json({ success: false, error: "Administrator access is required" });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error("Token verification failed:", error.code || error.message);
    return res.status(401).json({ success: false, error: "Invalid or expired authentication token" });
  }
}

// Delete Firebase Auth User
app.post("/deleteAuthUser", requireAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    if (typeof uid !== "string" || !uid.trim()) {
      return res.status(400).json({ success: false, error: "UID is required" });
    }

    if (uid === req.user.uid) {
      return res.status(400).json({ success: false, error: "You cannot delete your own account" });
    }

    const targetUser = await admin.auth().getUser(uid);
    if (targetUser.email && adminEmails.has(targetUser.email.toLowerCase())) {
      return res.status(403).json({ success: false, error: "Admin accounts cannot be deleted" });
    }

    await admin.auth().deleteUser(uid);
    console.log(`Deleted Auth User: ${uid}`);

    return res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete Auth Error:", error);
    return res.status(500).json({ success: false, error: "Unable to delete the user" });
  }
});

// Test Firebase Connection
app.get("/testFirebase", requireAdmin, async (req, res) => {
  try {
    const users = await admin.auth().listUsers(1);
    res.status(200).json({
      success: true,
      message: "Firebase Admin Connected",
      count: users.users.length
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Firebase request failed" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
