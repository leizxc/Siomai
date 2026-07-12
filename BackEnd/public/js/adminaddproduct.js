import { db } from "/js/firebase.js";
import {
  collection,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { SyncProductFromFirebase } from "/js/IndexDB.js";

await SyncProductFromFirebase();

//populate dropdown from inventory
let unsubscribeInventoryOptions = null;

function loadInventoryOptions(role = "") {

  const select = document.getElementById("productName");

  if (!select) return;

  if (unsubscribeInventoryOptions) {
    unsubscribeInventoryOptions();
  }

  let q = collection(db, "inventory");

  if (role) {
    q = query(
      collection(db, "inventory"),
      where("role", "==", role)
    );
  }

  unsubscribeInventoryOptions = onSnapshot(q, (snapshot) => {

    select.innerHTML = `
            <option value="" disabled selected>Choose Product</option>
        `;

    snapshot.forEach((docSnap) => {

      const data = docSnap.data();

      const option = document.createElement("option");

      option.value = docSnap.id;
      option.textContent = data.product_name;

      select.appendChild(option);

    });

    M.FormSelect.init(select);

  });

}

document.getElementById("productRole").addEventListener("change", (e) => {

  const role = e.target.value;

  // reset product dropdown
  document.getElementById("productName").innerHTML =
    `<option value="" disabled selected>Choose Product</option>`;

  document.getElementById("productPrice").value = "";
  document.getElementById("availableStock").value = "";
  document.getElementById("assignQuantity").value = "";

  M.updateTextFields();

  loadInventoryOptions(role);

});

let unsubscribeProduct = null;
document.getElementById("productName").addEventListener("change", (e) => {

  const id = e.target.value;

  if (!id) return;

  if (unsubscribeProduct) {
    unsubscribeProduct();
  }

  unsubscribeProduct = onSnapshot(doc(db, "inventory", id), (snap) => {

    if (!snap.exists()) return;

    const data = snap.data();

    document.getElementById("productPrice").value = data.unit_price;

    if (data.unit_type === "pack") {
      document.getElementById("availableStock").value = data.quantity;
    } else {
      document.getElementById("availableStock").value = data.stock_quantity;
    }

    M.updateTextFields();
  });

});
document.getElementById("addProductForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const inventoryId = document.getElementById("productName").value;
  const employeeId = document.getElementById("productEmployee").value;
  const role = document.getElementById("productRole").value;
  const quantity = parseInt(document.getElementById("assignQuantity").value);
  console.log("inventoryId =", inventoryId);
  console.log("employeeId =", employeeId);
  console.log("role =", role);
  console.log("quantity =", quantity);

  if (!inventoryId) {
    console.error("❌ inventoryId is empty");
    return;
  }
  const invRef = doc(db, "inventory", inventoryId);
  const invSnap = await getDoc(invRef);
  const invData = invSnap.data();



  if (invData.unit_type === "pack") {

    if (invData.quantity < quantity) {
      M.toast({
        html: "Not enough stock!",
        classes: "red rounded"
      });
      return;
    }

  } else {

    if (invData.stock_quantity < quantity) {
      M.toast({
        html: "Not enough stock!",
        classes: "red rounded"
      });
      return;
    }

  }

  let newStockQuantity;
  let newQuantity;

  if (invData.unit_type === "pack") {

    const categorySnap = await getDoc(doc(db, "categoriesINV", invData.category_id));

    const piecesPerPack = categorySnap.data().pieces_per_pack;

    newQuantity = invData.quantity - quantity;

    newStockQuantity = newQuantity * piecesPerPack;

  } else {

    newQuantity = invData.quantity - quantity;
    newStockQuantity = newQuantity;

  }

  await updateDoc(invRef, {
    quantity: newQuantity,
    stock_quantity: newStockQuantity,
    last_updated: serverTimestamp()
  });

  await addDoc(collection(db, "products"), {
    name: invData.product_name,
    price: invData.unit_price,
    role,
    employeeId,
    stock: quantity,

    // IMPORTANT
    inventoryId: inventoryId,
    unit_type: invData.unit_type,
    assigned_at: serverTimestamp()
  });

  M.toast({ html: "Product assigned successfully!", classes: "green rounded" });
  // ✅ Clear all inputs
  e.target.reset(); // clears the form
  document.getElementById("productPrice").value = "";
  document.getElementById("availableStock").value = "";

  // Re‑init Materialize labels and selects
  M.updateTextFields();
  M.FormSelect.init(document.querySelectorAll("select"));

  // Disable Add Product button again
  document.getElementById("addProductBtn").disabled = true;
});

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
            <td data-label="Product Name">${data.name}</td>
            <td data-label="Price">₱${parseFloat(data.price).toFixed(2)}</td>
            <td data-label="Stock">${data.stock}</td>
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
        }
      });

      // Delete logic
      document.querySelectorAll(".delete-btn").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.dataset.id;

          const confirmed = await confirmDeletion(
            "Delete Product?",
            "This product will be permanently deleted."
          );

          if (confirmed) {
            try {
              const productRef = doc(db, "products", id);
              const productSnap = await getDoc(productRef);

              if (productSnap.exists()) {

                const productData = productSnap.data();


                if (!productData.inventoryId) {

                  console.error("No inventory reference found");

                  await deleteDoc(productRef);

                  M.toast({
                    html: "Product deleted but stock cannot be restored.",
                    classes: "orange rounded"
                  });

                  return;
                }


                const inventoryRef = doc(
                  db,
                  "inventory",
                  productData.inventoryId
                );

                const inventorySnap = await getDoc(inventoryRef);


                if (inventorySnap.exists()) {

                  const invData = inventorySnap.data();


                  let restoreQuantity =
                    invData.quantity + productData.stock;


                  let restoreStockQuantity;


                  if (invData.unit_type === "pack") {

                    const categorySnap = await getDoc(
                      doc(
                        db,
                        "categoriesINV",
                        invData.category_id
                      )
                    );


                    const piecesPerPack =
                      categorySnap.data().pieces_per_pack;


                    restoreStockQuantity =
                      restoreQuantity * piecesPerPack;


                  } else {

                    restoreStockQuantity =
                      restoreQuantity;

                  }



                  await updateDoc(inventoryRef, {
                    quantity: restoreQuantity,
                    stock_quantity: restoreStockQuantity,
                    last_updated: serverTimestamp()
                  });


                }


                // delete assigned product
                await deleteDoc(productRef);
              }
              M.toast({ html: "Product deleted successfully!", classes: "green rounded" });
              const form = document.getElementById("addProductForm");

              form.reset();

              document.getElementById("productPrice").value = "";
              document.getElementById("availableStock").value = "";

              M.updateTextFields();

              M.FormSelect.init(document.querySelectorAll("select"));
            } catch (err) {
              console.error("Delete error:", err);
              M.toast({ html: "Failed to delete Product.", classes: "red rounded" });
            }
          }
        }
      })

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
    const filterRole = document.getElementById("filterRole");

if(!filterRole){
    return;
}
const selectedRole = filterRole.value;
    renderProducts("", selectedRole);
  });
}


function confirmDeletion(title, message) {
  const modalElement = document.getElementById("modal-delete-category");
  const confirmButton = document.getElementById("confirm-delete-category");
  const cancelButton = document.getElementById("cancel-delete-category");
  const titleElement = document.getElementById("delete-confirmation-title");
  const messageElement = document.getElementById("delete-confirmation-message");

  // ✅ kunin na lang ang existing instance
  const modalInstance = M.Modal.getInstance(modalElement);

  titleElement.textContent = title;
  messageElement.textContent = message;

  return new Promise((resolve) => {
    cancelButton.onclick = () => {
      modalInstance.close();
      resolve(false);
    };

    confirmButton.onclick = () => {
      modalInstance.close();
      resolve(true);
    };

    modalInstance.open();
  });
}

export async function initProductPage() {
  M.Modal.init(document.querySelectorAll(".modal"), {
    dismissible: false
  });

  M.FormSelect.init(document.querySelectorAll("select"));

  await loadRoles();

  loadInventoryOptions();

  console.log("✅ Product page initialized");
}

async function loadRoles() {

  const roleSelect = document.getElementById("productRole");

  const snap = await getDocs(collection(db, "employees"));

  const roles = new Set();

  roleSelect.innerHTML =
    `<option value="" disabled selected>Choose Role</option>`;

  snap.forEach((docSnap) => {

    const data = docSnap.data();

    if (data.role) {
      roles.add(data.role.trim());
    }

  });

  roles.forEach((role) => {

    roleSelect.innerHTML += `<option value="${role}">${role}</option>`;

  });

  M.FormSelect.init(roleSelect);

}

initProductPage();
loadProducts();
