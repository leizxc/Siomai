import { db } from "../BackEnd/js/firebase.js";
import { collection, getDocs, addDoc, query, where } 
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function initProductModal() {
  document.addEventListener("DOMContentLoaded", async () => {
    M.FormSelect.init(document.querySelectorAll("select"));
  });

  const roleSelect = document.getElementById("productRole");
  const employeeSelect = document.getElementById("productEmployee");
  const inputs = [
    document.getElementById("productName"),
    document.getElementById("productPrice"),
    document.getElementById("productStock"),
    document.getElementById("addProductBtn")
  ];

  //  Function to enable/disable product inputs
  function toggleInputs() {
    const role = roleSelect.value;
    const employee = employeeSelect.value;
    const enable = role && employee;
    inputs.forEach(el => el.disabled = !enable);
  }

  //  Populate employee dropdown based on selected role
  async function loadEmployeesByRole(selectedRole) {
    employeeSelect.innerHTML = `
      <option value="" disabled selected>Choose Employee</option>
    `;
    const q = query(collection(db, "employees"), where("role", "==", selectedRole));
    const snap = await getDocs(q);

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = `${data.fname} ${data.lname} (${data.role})`;
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

  //  Handle form submission
  const form = document.getElementById("addProductForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name = document.getElementById("productName").value.trim();
      const price = parseFloat(document.getElementById("productPrice").value);
      const stock = parseInt(document.getElementById("productStock").value);
      const role = roleSelect.value;
      const employeeId = employeeSelect.value;

      if (!name || isNaN(price) || isNaN(stock) || !role || !employeeId) {
        M.toast({ html: "⚠️ Please fill out all fields correctly." });
        return;
      }

      try {
        await addDoc(collection(db, "products"), {
          name,
          price,
          stock,
          role,
          employeeId
        });
        M.toast({ html: "✅ Product added successfully!" });
        form.reset();
        toggleInputs(); // disable again after reset
        M.FormSelect.init(document.querySelectorAll("select"));
      } catch (err) {
        console.error("Error adding product:", err);
        M.toast({ html: "❌ Failed to add product." });
      }
    });
  }
}
