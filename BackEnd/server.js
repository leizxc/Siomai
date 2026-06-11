const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

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

// Express App
const app = express();

app.use(cors({
  origin: true, // allow all origins for development
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());

// Health Check
app.get("/", (req, res) => {
  res.send("Backend Server Running");
});

// Delete Firebase Auth User
app.post("/deleteAuthUser", async (req, res) => {
  try {
    console.log("Request Body:", req.body);

    const { uid } = req.body;

    if (!uid) {
      return res.status(400).json({
        success: false,
        error: "UID is required"
      });
    }

    await admin.auth().deleteUser(uid);

    console.log(`Deleted Auth User: ${uid}`);

    return res.status(200).json({
      success: true,
      message: "User deleted successfully"
    });

  } catch (error) {
    console.error("Delete Auth Error:", error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
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

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start Server
const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});