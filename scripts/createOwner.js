const admin = require("./firebaseAdmin");

async function main() {
  const [, , emailArg, ...nameParts] = process.argv;
  const email = String(emailArg || "").trim().toLowerCase();
  const displayName = nameParts.join(" ").trim();
  if (!email || !displayName) throw new Error("Usage: node scripts/createOwner.js <email> <display name>");

  let user;
  try {
    user = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(user.uid, { displayName });
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
    user = await admin.auth().createUser({ email, displayName, emailVerified: false });
  }

  await admin.auth().setCustomUserClaims(user.uid, { ...(user.customClaims || {}), role: "owner" });
  const resetLink = await admin.auth().generatePasswordResetLink(email);
  console.log(`Owner account ready (uid: ${user.uid}). Password reset link:\n${resetLink}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
