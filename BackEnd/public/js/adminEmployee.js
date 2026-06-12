import { db } from "./firebase.js";
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

// Load employees list
export function loadEmployees() {
  const tbody = document.querySelector("#employeeTable tbody");

  onSnapshot(collection(db, "employees"), (querySnapshot) => {
    tbody.innerHTML = "";

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();

      tbody.innerHTML += `
        <tr data-id="${docSnap.id}">
          <td>${data.fname}</td>
          <td>${data.lname}</td>
          <td>${data.email}</td>
          <td>${data.role}</td>
          <td>
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

    // Delete logic
    document.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        const id = e.target.closest("button").dataset.id;
        await deleteEmployee(id);
      };
    });

    // Edit logic
    document.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.onclick = (e) => {
        const id = e.target.closest("button").dataset.id;
        const row = e.target.closest("tr");

        // Fill modal fields
        document.getElementById("edit-fname").value = row.children[0].textContent;
        document.getElementById("edit-lname").value = row.children[1].textContent;
        document.getElementById("edit-email").value = row.children[2].textContent;
        document.getElementById("edit-role").value = row.children[3].textContent;

        // Refresh Materialize UI
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

          // 1. Update employees collection
          await updateDoc(doc(db, "employees", id), {
            fname: newFname,
            lname: newLname,
            email: newEmail,
            role: newRole,
            last_updated: serverTimestamp()
          });

          // 2. Update users collection (find by email)
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

// Add employee securely with Firebase Auth
export async function addEmployee(fname, lname, email, role, password) {
  try {
    // 0. Check muna kung existing na ang email sa users collection
    const q = query(collection(db, "users"), where("email", "==", email));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
      alert("Email already exists!");
      return;
    }

    // 1. Create account in Firebase Authentication
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    // 2. Save employee profile in Firestore (employees)
    await addDoc(collection(db, "employees"), {
      uid,
      fname,
      lname,
      email,
      role,
      created_at: serverTimestamp()
    });

    // 3. Also save login info in users collection
    await addDoc(collection(db, "users"), {
      username: email.split("@")[0].toLowerCase().trim(),
      email,
      role,
      status: "active",
      created_at: serverTimestamp()
    });

    alert("Employee added successfully!");
  } catch (error) {
    console.error("Error adding employee:", error);
    alert("Failed to add employee.");
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

      // Prevent deleting admin
      if (role === "admin") {
        alert("Admin accounts cannot be deleted.");
        return;
      }

      // 1. Delete sa employees collection
      await deleteDoc(employeeRef);

      // 2. Delete sa users collection
      const q = query(collection(db, "users"), where("email", "==", email));
      const snapshot = await getDocs(q);
      snapshot.forEach(async (docSnap) => {
        await deleteDoc(doc(db, "users", docSnap.id));
      });

      // 3. Delete sa Firebase Authentication (via backend)
      if (!uid) {
        alert("No UID found for this employee. Cannot delete Auth account.");
        return;
      }

        await fetch("http://localhost:4000/deleteAuthUser", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ uid })
      });

      alert("Employee deleted successfully!");
    } else {
      alert("Employee not found.");
    }
  } catch (error) {
    console.error("Error deleting employee:", error);
    alert("Failed to delete employee.");
  }
}
