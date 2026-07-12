import { db } from "/js/firebase.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  getDoc,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getAuth,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const auth = getAuth();

// Load employees list with username from users collection
export async function loadEmployees() {
  const tbody = document.querySelector("#employeeTable tbody");
  tbody.innerHTML = "";

  //  Get all users first to map email → username
  const usersSnap = await getDocs(collection(db, "users"));
  const usersMap = {};
  usersSnap.forEach((docSnap) => {
    const data = docSnap.data();
    usersMap[data.email] = data.username;
  });

  //  Real-time listener for employees
  onSnapshot(collection(db, "employees"), (querySnapshot) => {
    tbody.innerHTML = "";

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const username = usersMap[data.email] || "—"; // fallback kung wala

     tbody.innerHTML += `
  <tr data-id="${docSnap.id}">
    <td data-label="First Name">${data.fname}</td>
    <td data-label="Last Name">${data.lname}</td>
    <td data-label="Email">${data.email}</td>
    <td data-label="Username">${username}</td>
    <td data-label="Role">${data.role}</td>
    <td data-label="Action">
      <button class="edit-btn btn blue" data-id="${docSnap.id}">
        <i class="material-icons">edit</i>
      </button>
      <button class="delete-btn btn red" data-id="${docSnap.id}">
        <i class="material-icons">delete</i>
      </button>
    </td>
  </tr>
`;
    });

    //  Delete logic
    document.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        const id = e.target.closest("button").dataset.id;
        await deleteEmployee(id);
      };
    });

    //  Edit logic
    document.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.onclick = (e) => {
        const id = e.target.closest("button").dataset.id;
        const row = e.target.closest("tr");

        document.getElementById("edit-fname").value = row.children[0].textContent;
        document.getElementById("edit-lname").value = row.children[1].textContent;
        document.getElementById("edit-email").value = row.children[2].textContent;
        document.getElementById("edit-role").value = row.children[4].textContent;

        M.updateTextFields();
        M.FormSelect.init(document.querySelectorAll("select"));

        const modalElem = document.getElementById("modal-edit-employee");
        const modalInstance = M.Modal.init(modalElem);
        modalInstance.open();

        const saveBtn = document.getElementById("edit-save");
        saveBtn.onclick = async () => {
          const newFname = document.getElementById("edit-fname").value;
          const newLname = document.getElementById("edit-lname").value;
          const newEmail = document.getElementById("edit-email").value;
          const newRole = document.getElementById("edit-role").value;

          await updateDoc(doc(db, "employees", id), {
            fname: newFname,
            lname: newLname,
            email: newEmail,
            role: newRole,
            last_updated: serverTimestamp()
          });

          const q = query(collection(db, "users"), where("email", "==", newEmail));
          const snapshot = await getDocs(q);
          snapshot.forEach(async (docSnap) => {
            await updateDoc(doc(db, "users", docSnap.id), {
              role: newRole,
              last_updated: serverTimestamp()
            });
          });

          modalInstance.close();
        };
      };
    });
  });
}

//hash password
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}


//  Add employee securely with Firebase Auth
export async function addEmployee(fname, lname, email, role, password) {
  try {
    const q = query(collection(db, "users"), where("email", "==", email));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      M.toast({ html: "Email already exists!", classes: "red rounded" });
      return;
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    await addDoc(collection(db, "employees"), {
      uid,
      fname,
      lname,
      email,
      role,
      created_at: serverTimestamp()
    });
    const hashvalue = await hashPassword(password);
    await addDoc(collection(db, "users"), {
      username: email.split("@")[0].toLowerCase().trim(),
      email,
      role,
      status: "active",
      passwordHash: hashvalue, // store hashed password
      created_at: serverTimestamp()
    });

    M.toast({ html: "Employee added successfully!", classes: "green rounded" });
  } catch (error) {
    console.error("Error adding employee:", error);
    M.toast({ html: "Failed to add employee.", classes: "red rounded" });
  }
}

// Delete employee
export async function deleteEmployee(id) {
  try {
    const employeeRef = doc(db, "employees", id);
    const employeeSnap = await getDoc(employeeRef);

    if (employeeSnap.exists()) {
      const employeeData = employeeSnap.data();
      const uid = employeeData.uid;
      const email = employeeData.email;
      const role = employeeData.role?.toLowerCase();

      if (role === "admin") {
        M.toast({ html: "Admin accounts cannot be deleted.", classes: "red rounded" });
        return;
      }

      await deleteDoc(employeeRef);

      const q = query(collection(db, "users"), where("email", "==", email));
      const snapshot = await getDocs(q);
      snapshot.forEach(async (docSnap) => {
        await deleteDoc(doc(db, "users", docSnap.id));
      });

      if (!uid) {
        M.toast({ html: "No UID found for this employee. Cannot delete Auth account.", classes: "red rounded" });
        return;
      }

      const API_BASE = window.location.origin;
      const idToken = await auth.currentUser?.getIdToken();

      if (!idToken) {
        M.toast({ html: "Your session has expired. Please sign in again.", classes: "red rounded" });
        return;
      }

      const res = await fetch(`${API_BASE}/deleteAuthUser`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ uid })
      });

      const result = await res.json();

      if (result.success) {
        M.toast({ html: result.message, classes: "green rounded" });
      } else {
        M.toast({ html: `Error: ${result.error}`, classes: "red rounded" });
      }
    } else {
      M.toast({ html: "Employee not found.", classes: "red rounded" });
    }
  } catch (error) {
    console.error("Error deleting employee:", error);
    M.toast({ html: "Failed to delete employee.", classes: "red rounded" });
  }
}
