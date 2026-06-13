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

export async function loadProducts() {
    const tbody = document.querySelector("#productTable tbody");
    const filterSelect = document.getElementById("filterEmployee");
    if (!tbody || !filterSelect) return;

    //  Load employees for filter dropdown
    const empSnap = await getDocs(collection(db, "employees"));
    const employeesMap = {}; // store employee data for quick lookup
    filterSelect.innerHTML = `<option value="" selected>All Employees</option>`;
    empSnap.forEach((docSnap) => {
        const data = docSnap.data();
        employeesMap[docSnap.id] = data;
        const option = document.createElement("option");
        option.value = docSnap.id;
        option.textContent = `${data.fname} ${data.lname} (${data.role})`;
        filterSelect.appendChild(option);
    });
    M.FormSelect.init(filterSelect);

    //  Render products with optional filter
    function renderProducts(employeeId = "") {
        let q = collection(db, "products");
        if (employeeId) {
            q = query(collection(db, "products"), where("employeeId", "==", employeeId));
        }

        onSnapshot(q, (querySnapshot) => {
            tbody.innerHTML = "";
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const empData = employeesMap[data.employeeId] || {};
                const empDisplay = empData.fname
                    ? `${empData.fname} ${empData.lname} (${empData.role})`
                    : data.employeeId;

                const row = document.createElement("tr");
                row.innerHTML = `
  <td data-label="Product Name">${data.name}</td>
  <td data-label="Product Price">₱${parseFloat(data.price).toFixed(2)}</td>
  <td data-label="Product Stock">${data.stock}</td>
  <td data-label="Role">${data.role}</td>
  <td data-label="Employee">${empDisplay}</td>
  <td data-label="Action">
    <button class="btn blue edit-btn" data-id="${docSnap.id}">
      <i class="material-icons">edit</i>
    </button>
    <button class="btn red delete-btn" data-id="${docSnap.id}">
      <i class="material-icons">delete</i>
    </button>
  </td>
`;

                tbody.appendChild(row);
            });

            // Delete logic
            document.querySelectorAll(".delete-btn").forEach((btn) => {
                btn.onclick = async () => {
                    const id = btn.dataset.id;
                    await deleteDoc(doc(db, "products", id));
                };
            });
        });
    }

    //  Initial load
    renderProducts();

    //  Filter change
    filterSelect.addEventListener("change", () => {
        const selectedEmployee = filterSelect.value;
        renderProducts(selectedEmployee);
    });
}

loadProducts();
