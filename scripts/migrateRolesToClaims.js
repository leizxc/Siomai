const admin = require("./firebaseAdmin");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const snapshot = await admin.firestore().collection("users").get();
  let updated = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    const role = String(data.role || "").trim().toLowerCase();
    const uid = String(data.uid || doc.id).trim();
    if (!["owner", "admin", "manager", "employee"].includes(role) || !uid) continue;
    if (dryRun) {
      console.log(`Would set role=${role} for uid=${uid}`);
      updated++;
      continue;
    }
    const user = await admin.auth().getUser(uid);
    await admin.auth().setCustomUserClaims(uid, { ...(user.customClaims || {}), role });
    updated++;
  }
  console.log(`${dryRun ? "Dry run: " : ""}${updated} role claim(s) ${dryRun ? "matched" : "updated"}.`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
