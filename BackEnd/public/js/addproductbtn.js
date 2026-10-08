// addproductbtn.js
import { db } from "/js/firebase.js";
import {
  collection,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let productModalSession = 0;
let productModalSelects = [];

export async function initProductModal() {
  stopProductModal();
  const token = ++productModalSession;
  const roleSelect = document.getElementById("productRole");
  const employeeSelect = document.getElementById("productEmployee");
  const productNameSelect = document.getElementById("productName");

  if (!roleSelect || !employeeSelect || !productNameSelect) return;

  // Keep this list aligned with product.html. filter(Boolean) prevents a
  // missing optional field from crashing the form during page navigation.
  const inputs = [
    productNameSelect,
    document.getElementById("productPrice"),
    document.getElementById("availablePacks"),
    document.getElementById("availableStock"),
    document.getElementById("assignPacks"),
    document.getElementById("assignPieces"),
    document.getElementById("addProductBtn"),
  ].filter(Boolean);
  productModalSelects = [roleSelect, employeeSelect, productNameSelect];

  // Materialize caches a select's disabled state inside its ".select-wrapper"
  function resyncSelectWrapper(selectEl) {
    // isConnected guard: kung na-navigate na palayo
    if (!selectEl || !selectEl.isConnected) return;

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
    resyncSelectWrapper(productNameSelect);
  }

  // Tumataas ito kada bagong loadEmployeesByRole() call
  //  Populate employee dropdown based on selected role
  async function loadEmployeesByRole(selectedRole) {
    const myRoleToken = token;

    employeeSelect.innerHTML = `
    <option value="" selected>All ${selectedRole} Employees (Shared)</option>
  `;
    const q = query(
      collection(db, "employees"),
      where("role", "==", selectedRole),
    );
    const snap = await getDocs(q);

    // May mas bagong role request na nauna — huwag na ituloy ito.
    if (myRoleToken !== productModalSession) return;
    if (!employeeSelect.isConnected) return;

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
  if (roleSelect && !roleSelect.dataset.roleChangeBound) {
    roleSelect.dataset.roleChangeBound = "true";
    roleSelect.addEventListener("change", async () => {
      const selectedRole = roleSelect.value;
      await loadEmployeesByRole(selectedRole);
      toggleInputs();
    });
  }

  if (employeeSelect && !employeeSelect.dataset.employeeChangeBound) {
    employeeSelect.dataset.employeeChangeBound = "true";
    employeeSelect.addEventListener("change", toggleInputs);
  }
}

export function stopProductModal() {
  productModalSession += 1;
  productModalSelects.forEach((select) => {
    const instance = M?.FormSelect?.getInstance(select);
    instance?.destroy();
  });
  productModalSelects = [];
}
