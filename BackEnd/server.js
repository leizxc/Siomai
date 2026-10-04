require("dotenv").config();
const express = require("express");
const admin = require("firebase-admin");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const isProduction = process.env.NODE_ENV === "production";
const verboseLog = (...args) => { if (!isProduction) console.log(...args); };

let serviceAccount;
let firebaseReady = false;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    verboseLog("Using FIREBASE_SERVICE_ACCOUNT environment configuration");
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else if (isProduction) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is required in production");
  } else {
    verboseLog("Using local serviceAccountKey.json");
    serviceAccount = require("./serviceAccountKey.json");
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  firebaseReady = true;
  verboseLog("Firebase Admin Initialized");
} catch (error) {
  console.error("Firebase Admin Initialization Failed:", error.message);
}

const app = express();
app.set("trust proxy", 1);
// The existing pages use inline module bootstrap code and Firebase's gstatic modules.
app.use(helmet({ contentSecurityPolicy: false }));
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const adminEmails = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
const ownerEmails = new Set(
  (process.env.OWNER_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

app.use((req, res, next) => {
  const origin = req.get("Origin");
  // Fall back to the direct Express host when running without a proxy.
  const forwardedHost = req.get("X-Forwarded-Host")?.split(",")[0].trim();
  const forwardedProtocol = req.get("X-Forwarded-Proto")?.split(",")[0].trim();
  const publicHost = forwardedHost || req.get("host");
  const publicProtocol = forwardedProtocol || req.protocol;
  const appOrigin = `${publicProtocol}://${publicHost}`;
  if (origin && origin !== appOrigin && !allowedOrigins.has(origin)) {
    return res
      .status(403)
      .json({ success: false, error: "Origin is not allowed" });
  }

  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
    res.set("Access-Control-Allow-Methods", "GET, POST");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  }

  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.sendStatus(204);
  }

  return next();
});

const accountLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false });
app.use(["/createAuthUser", "/updateAuthPassword", "/deleteAuthUser"], accountLimiter);

app.use(express.json({ limit: "100kb" }));

// Serve static files from BackEnd/public folder
app.use("/owner", express.static(path.join(__dirname, "owner")));
app.use(express.static(path.join(__dirname, "public")));

// Root route → serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.status(firebaseReady ? 200 : 503).json({
    success: firebaseReady,
    firebase: firebaseReady ? "ready" : "unavailable",
  });
});
//get bereartoken
function getBearerToken(req) {
  const [scheme, token] = (req.get("Authorization") || "").split(" ");
  return scheme === "Bearer" && token ? token : null;
}

async function getStoredAccountRole(uid) {
  const db = admin.firestore();
  const directMatch = await db.collection("users").doc(uid).get();
  if (directMatch.exists) {
    return String(directMatch.data()?.role || "").trim().toLowerCase();
  }

  const matches = await db.collection("users").where("uid", "==", uid).limit(1).get();
  return matches.empty
    ? ""
    : String(matches.docs[0].data()?.role || "").trim().toLowerCase();
}

//createAuthUser()
async function requireAdmin(req, res, next) {
  if (!firebaseReady) {
    return res
      .status(503)
      .json({ success: false, error: "Firebase Admin is unavailable" });
  }

  const token = getBearerToken(req);
  if (!token) {
    return res
      .status(401)
      .json({ success: false, error: "Authentication token is required" });
  }

  try {
    const user = await admin.auth().verifyIdToken(token);
    const email = user.email?.trim().toLowerCase();
    const tokenRole = String(user.role || "").trim().toLowerCase();
    // Legacy owner accounts may have the owner role in Firestore before their
    // Firebase custom claim was created. Resolve that role with Admin SDK only;
    // never trust a role sent by the browser.
    const storedRole = tokenRole ? "" : await getStoredAccountRole(user.uid);
    const role = (email && ownerEmails.has(email))
      ? "owner"
      : tokenRole || storedRole;
    const hasPanelAccess = ["admin", "manager", "owner"].includes(role) || Boolean(email && adminEmails.has(email));

    if (!hasPanelAccess) {
      return res.status(403).json({
        success: false,
        error: "Manager, owner, or administrator access is required",
      });
    }

    req.user = user;
    req.userRole = role || (email && adminEmails.has(email) ? "admin" : "");
    return next();
  } catch (error) {
    verboseLog("Token verification failed:", error.code || "unknown error");
    return res.status(401).json({
      success: false,
      error: "Invalid or expired authentication token",
    });
  }
}

async function writeAudit(actor, action, target) {
  await admin.firestore().collection("auditLogs").add({
    actorUid: actor.uid,
    actorEmail: actor.email || null,
    action,
    targetUid: target.uid,
    targetEmail: target.email || null,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });
}

//create Auth user
app.post("/createAuthUser", requireAdmin, async (req, res) => {
  try {
    const { email, password } = req.body;
    const requestedRole = String(req.body.accountRole || req.body.role || "employee").trim().toLowerCase();
    // The frontend's `role` may be a job title such as Cashier. Only the
    // separate accountRole value determines Firebase authorization claims.
    const role = ["admin", "manager", "employee"].includes(requestedRole)
      ? requestedRole
      : req.body.accountRole
        ? requestedRole
        : "employee";
    const allowedRoles = new Set(["admin", "manager", "employee"]);
    if (!allowedRoles.has(role)) return res.status(400).json({ success: false, error: "Account role must be admin, manager, or employee" });
    if (role === "manager" && !["owner", "admin"].includes(req.userRole)) {
      return res.status(403).json({ success: false, error: "Only owners and administrators can create managers" });
    }
    if (role === "admin" && req.userRole !== "owner") {
      return res.status(403).json({ success: false, error: "Only an owner can create administrators" });
    }
    if (typeof email !== "string" || !email.trim() || typeof password !== "string") {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters",
      });
    }
    if (adminEmails.has(email.trim().toLowerCase())) {
      return res.status(403).json({
        success: false,
        error: "Configured administrator accounts cannot be created here",
      });
    }
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });
    await admin.auth().setCustomUserClaims(userRecord.uid, { role });
    await writeAudit(req.user, "account_created", userRecord);
    verboseLog("Created Auth User:", userRecord.uid);
    return res.status(200).json({
      success: true,
      uid: userRecord.uid,
    });
  } catch (error) {
    verboseLog("Create Auth Error:", error.code || "unknown error");
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Update an employee Firebase Auth password from the admin panel.
app.post("/updateAuthPassword", requireAdmin, async (req, res) => {
  try {
    const { uid, password, fname, lname } = req.body;
    if (typeof uid !== "string" || !uid.trim() || (password !== undefined && typeof password !== "string")) {
      return res.status(400).json({
        success: false,
        error: "A user ID and password are required",
      });
    }
    if (password && password.length < 6) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters",
      });
    }

    const targetUser = await admin.auth().getUser(uid);
    const targetClaims = targetUser.customClaims || {};
    const targetRole = String(targetClaims.role || "").toLowerCase();
    if (!(["employee", "manager"].includes(targetRole)) || (targetRole === "manager" && req.userRole !== "owner")) {
      return res.status(403).json({ success: false, error: "You are not allowed to manage this account" });
    }
    if (
      uid === req.user.uid ||
      (targetUser.email && adminEmails.has(targetUser.email.toLowerCase()))
    ) {
      return res.status(403).json({
        success: false,
        error: "Admin account passwords cannot be changed here",
      });
    }

    const firstName = typeof fname === "string" ? fname.trim() : undefined;
    const lastName = typeof lname === "string" ? lname.trim() : undefined;
    if ((firstName !== undefined && !firstName) || (lastName !== undefined && !lastName) ||
        (firstName !== undefined && firstName.length > 80) || (lastName !== undefined && lastName.length > 80)) {
      return res.status(400).json({ success: false, error: "Enter a valid first and last name" });
    }
    const update = {};
    if (password) update.password = password;
    if (firstName !== undefined || lastName !== undefined) {
      update.displayName = `${firstName ?? targetUser.displayName?.split(" ")[0] ?? ""} ${lastName ?? targetUser.displayName?.split(" ").slice(1).join(" ") ?? ""}`.trim();
    }
    if (Object.keys(update).length) await admin.auth().updateUser(uid, update);
    if (firstName !== undefined || lastName !== undefined) {
      const db = admin.firestore();
      for (const collectionName of ["employees", "users"]) {
        const matches = await db.collection(collectionName).where("uid", "==", uid).get();
        await Promise.all(matches.docs.map((doc) => doc.ref.update({
          ...(firstName !== undefined ? { fname: firstName } : {}),
          ...(lastName !== undefined ? { lname: lastName } : {}),
        })));
      }
    }
    if (password) await writeAudit(req.user, "password_changed", targetUser);
    return res.status(200).json({ success: true });
  } catch (error) {
    verboseLog("Update Auth Password Error:", error.code || "unknown error");
    return res.status(500).json({
      success: false,
      error: "Unable to update the employee password",
    });
  }
});

// Delete Firebase Auth User
app.post("/deleteAuthUser", requireAdmin, async (req, res) => {
  try {
    const { uid } = req.body;
    if (typeof uid !== "string" || !uid.trim()) {
      return res.status(400).json({ success: false, error: "UID is required" });
    }

    if (uid === req.user.uid) {
      return res
        .status(400)
        .json({ success: false, error: "You cannot delete your own account" });
    }

    const targetUser = await admin.auth().getUser(uid);
    const targetRole = String((targetUser.customClaims || {}).role || "").toLowerCase();
    if (!(["employee", "manager"].includes(targetRole)) || (targetRole === "manager" && req.userRole !== "owner")) {
      return res.status(403).json({ success: false, error: "You are not allowed to manage this account" });
    }
    if (targetUser.email && adminEmails.has(targetUser.email.toLowerCase())) {
      return res
        .status(403)
        .json({ success: false, error: "Admin accounts cannot be deleted" });
    }

    await admin.auth().deleteUser(uid);
    await writeAudit(req.user, "account_deleted", targetUser);
    verboseLog(`Deleted Auth User: ${uid}`);

    return res
      .status(200)
      .json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    verboseLog("Delete Auth Error:", error.code || "unknown error");
    return res
      .status(500)
      .json({ success: false, error: "Unable to delete the user" });
  }
});

// Test Firebase Connection
app.get("/testFirebase", generalLimiter, requireAdmin, async (req, res) => {
  try {
    const users = await admin.auth().listUsers(1);
    res.status(200).json({
      success: true,
      message: "Firebase Admin Connected",
      count: users.users.length,
    });
  } catch (error) {
    verboseLog("Firebase request failed:", error.code || "unknown error");
    res.status(500).json({ success: false, error: "Firebase request failed" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
