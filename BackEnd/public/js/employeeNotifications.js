import { app } from "/js/firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, getFirestore, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeReports = null;

export async function initEmployeeNotifications() {
  const bell = document.querySelector("#employee-notification-bell");
  const badge = document.querySelector("#employee-notification-count");
  if (!bell || !badge || unsubscribeReports) return;

  const user = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      unsubscribe();
      resolve(currentUser);
    });
  });
  if (!user) return;

  const employeeSnapshot = await getDocs(query(collection(db, "employees"), where("uid", "==", user.uid)));
  if (employeeSnapshot.empty) return;
  const employeeId = employeeSnapshot.docs[0].id;

  unsubscribeReports = onSnapshot(
    query(collection(db, "expenseReports"), where("employeeId", "==", employeeId)),
    (snapshot) => {
      const readCount = snapshot.docs.filter((item) => item.data().status === "read" && !item.data().employeeNotified).length;
      badge.textContent = readCount > 9 ? "9+" : String(readCount);
      badge.hidden = readCount === 0;
      bell.classList.toggle("has-notification", readCount > 0);
    },
    (error) => console.error("Unable to load employee notifications:", error),
  );
}

export function stopEmployeeNotifications() {
  unsubscribeReports?.();
  unsubscribeReports = null;
}
