const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../BackEnd/.env") });
const admin = require("firebase-admin");

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  const localKeyPath = [
    path.join(__dirname, "../BackEnd/serviceAccountKey.json"),
    path.join(__dirname, "../BackEnd/serviceAccountKey.json.json"),
  ].find((filePath) => fs.existsSync(filePath));
  if (!localKeyPath) throw new Error("Local Firebase service account file was not found");
  serviceAccount = require(localKeyPath);
}

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

module.exports = admin;
