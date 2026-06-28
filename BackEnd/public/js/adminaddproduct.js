import { db } from "/js/firebase.js";
import {
  collection,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { SyncProductFromFirebase } from "/js/IndexDB.js";

await SyncProductFromFirebase();

export async function loadProducts() {
  const tbody = document.querySelector("#productTable tbody");
  const filterRole = document.getElementById("filterRole"); // <-- role filter dropdown
  if (!tbody || !filterRole) return;

  // Employees map (for display only)
  const empSnap = await getDocs(collection(db, "employees"));
  const employeesMap = {};
  empSnap.forEach((docSnap) => {
    employeesMap[docSnap.id] = docSnap.data();
  });

  // Render products with optional filter
  function renderProducts(employeeId = "", role = "") {
    let q = collection(db, "products");

    if (employeeId) {
      const empRole = employeesMap[employeeId].role;
      q = query(collection(db, "products"), where("role", "==", empRole));
    } else if (role) {
      q = query(collection(db, "products"), where("role", "==", role));
    }

    onSnapshot(q, (querySnapshot) => {
      tbody.innerHTML = "";
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();

        // show if shared OR specific to employee
        if (!employeeId || !data.employeeId || data.employeeId === employeeId) {
          const empData = employeesMap[data.employeeId] || {};
          const empDisplay = empData.fname
            ? `${empData.fname} ${empData.lname} (${empData.role})`
            : "Shared";

          const row = document.createElement("tr");
          row.innerHTML = `
            <td>${data.name}</td>
            <td>₱${parseFloat(data.price).toFixed(2)}</td>
            <td>${data.stock}</td>
            <td>${data.role}</td>
            <td>${empDisplay}</td>
            <td>
              <button class="btn blue edit-btn" data-id="${docSnap.id}">
                <i class="material-icons">edit</i>
              </button>
              <button class="btn red delete-btn" data-id="${docSnap.id}">
                <i class="material-icons">delete</i>
              </button>
            </td>
          `;
          tbody.appendChild(row);
        }
      });

      // Delete logic
      document.querySelectorAll(".delete-btn").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.dataset.id;
          await deleteDoc(doc(db, "products", id));
        };
      });

      // Edit logic
      document.querySelectorAll(".edit-btn").forEach((btn) => {
        btn.onclick = (e) => {
          const id = e.target.closest("button").dataset.id;
          const row = e.target.closest("tr");

          document.getElementById("edit-name").value = row.children[0].textContent;
          document.getElementById("edit-price").value = row.children[1].textContent.replace("₱", "");
          document.getElementById("edit-stock").value = row.children[2].textContent;

          M.updateTextFields();
          M.FormSelect.init(document.querySelectorAll("select"));

          const modalElem = document.getElementById("modal-edit-product");
          const modalInstance = M.Modal.init(modalElem);
          modalInstance.open();

          const saveBtn = document.getElementById("edit-save");
          saveBtn.onclick = async () => {
            const newName = document.getElementById("edit-name").value;
            const newPrice = parseFloat(document.getElementById("edit-price").value);
            const newStock = parseInt(document.getElementById("edit-stock").value);

            await updateDoc(doc(db, "products", id), {
              name: newName,
              price: newPrice,
              stock: newStock
            });
            modalInstance.close();
          };
        };
      });
    });
  }

  // Initial load (all products)
  renderProducts();

  // Filter change (role-based)
  filterRole.addEventListener("change", () => {
    const selectedRole = filterRole.value;
    renderProducts("", selectedRole);
  });
}

loadProducts();
