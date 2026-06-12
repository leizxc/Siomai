const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const path = require("path");

// Firebase Admin Setup
let serviceAccount;

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

  console.log("Firebase Admin Initialized");
} catch (error) {
  console.error("Firebase Admin Initialization Failed:", error);
}

const app = express();

app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());

// ✅ Serve static files from BackEnd/public folder (absolute path)
app.use(express.static(path.join(__dirname, "BackEnd", "public")));

// ✅ Root route → serve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "BackEnd", "public", "index.html"));
});

// Delete Firebase Auth User
app.post("/deleteAuthUser", async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      return res.status(400).json({ success: false, error: "UID is required" });
    }

    await admin.auth().deleteUser(uid);
    console.log(`Deleted Auth User: ${uid}`);

    return res.status(200).json({ success: true, message: "User deleted successfully" });
  } catch (error) {
    console.error("Delete Auth Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Test Firebase Connection
app.get("/testFirebase", async (req, res) => {
  try {
    const users = await admin.auth().listUsers(1);
    res.status(200).json({
      success: true,
      message: "Firebase Admin Connected",
      count: users.users.length
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
