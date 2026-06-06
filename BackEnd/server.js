const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
app.use(cors());
app.use(express.json());

app.post("/deleteAuthUser", async (req, res) => {
  const { uid } = req.body;
  try {
    await admin.auth().deleteUser(uid);
    console.log(`Deleted user ${uid}`);
    res.status(200).send({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send({ error: error.message });
  }
});

app.listen(4000, () => console.log("Backend server running on port 4000"));
