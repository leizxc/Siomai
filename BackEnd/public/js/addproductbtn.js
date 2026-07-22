import { db } from "/js/firebase.js";
import {
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function initProductModal() {
  const roleSelect = document.getElementById("productRole");
  const employeeSelect = document.getElementById("productEmployee");
  const productNameSelect = document.getElementById("productName");

  const inputs = [
    productNameSelect,
    document.getElementById("productPrice"),
    document.getElementById("availableStock"),
    document.getElementById("assignQuantity"),
    document.getElementById("addProductBtn"),
  ];

  console.log("Inputs:", inputs);

  // Materialize caches a select's disabled state inside its ".select-wrapper"
  // at init time. Flipping the native .disabled property alone does NOT
  // update that wrapper, so we always re-sync it right after.
  function resyncSelectWrapper(selectEl) {
    if (!selectEl) return;
    const instance = M.FormSelect.getInstance(selectEl);
    if (instance) {
      instance.destroy();
    }
    M.FormSelect.init(selectEl);
  }

  //  Function to enable/disable product inputs
  function toggleInputs() {
    const role = roleSelect.value;
    const enable = !!role;
    inputs.forEach((el) => (el.disabled = !enable));

    // productName is Materialize-managed, so resync its wrapper too,
    // otherwise it can get visually stuck showing "disabled" even
    // after we just enabled the underlying <select>.
    resyncSelectWrapper(productNameSelect);
  }

  //  Populate employee dropdown based on selected role
  async function loadEmployeesByRole(selectedRole) {
    employeeSelect.innerHTML = `
    <option value="" selected>All ${selectedRole} Employees (Shared)</option>
  `;
    const q = query(
      collection(db, "employees"),
      where("role", "==", selectedRole),
    );
    const snap = await getDocs(q);

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = `${data.fname} ${data.lname}`;
      employeeSelect.appendChild(option);
    });

    resyncSelectWrapper(employeeSelect);
  }

  //  When role changes, reload employee list
  roleSelect.addEventListener("change", async () => {
    const selectedRole = roleSelect.value;
    await loadEmployeesByRole(selectedRole);
    toggleInputs();
  });

  employeeSelect.addEventListener("change", toggleInputs);
}