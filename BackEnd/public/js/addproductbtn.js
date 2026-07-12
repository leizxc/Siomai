import { db } from "/js/firebase.js";
import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
export async function initProductModal() {
  document.addEventListener("DOMContentLoaded", async () => {
    M.FormSelect.init(document.querySelectorAll("select"));
  });

  const roleSelect = document.getElementById("productRole");
  const employeeSelect = document.getElementById("productEmployee");
  const inputs = [
    document.getElementById("productName"),
    document.getElementById("productPrice"),
    document.getElementById("availableStock"),
    document.getElementById("assignQuantity"),
    document.getElementById("addProductBtn")
];

console.log("Inputs:", inputs);

  //  Function to enable/disable product inputs
  function toggleInputs() {
    const role = roleSelect.value;
    const employee = employeeSelect.value;
    const enable = !!role;
    inputs.forEach(el => el.disabled = !enable);
  }

  //  Populate employee dropdown based on selected role
  async function loadEmployeesByRole(selectedRole) {
    const employeeSelect = document.getElementById("productEmployee");
    employeeSelect.innerHTML = `
    <option value="" selected>All ${selectedRole} Employees (Shared)</option>
  `;
    const q = query(collection(db, "employees"), where("role", "==", selectedRole));
    const snap = await getDocs(q);

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = `${data.fname} ${data.lname}`;
      employeeSelect.appendChild(option);
    });

    M.FormSelect.init(employeeSelect);
  }

  //  When role changes, reload employee list
  roleSelect.addEventListener("change", async () => {
    const selectedRole = roleSelect.value;
    await loadEmployeesByRole(selectedRole);
    toggleInputs();
  });

  employeeSelect.addEventListener("change", toggleInputs);

}


