import { db } from "/js/firebase.js";
import {
  collection,
  updateDoc,
  deleteDoc,
  doc,
  runTransaction,
  onSnapshot,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { SyncProductFromFirebase } from "/js/IndexDB.js";

await SyncProductFromFirebase();

// global listeners state
let unsubscribeInventoryOptions = null;
let unsubscribeProducts = null;
let unsubscribeProduct = null;
let unsubscribeRoleFilter = null;

// correctly instead of stacking a broken duplicate dropdown UI.
function reinitSelect(selectEl) {
  if (!selectEl) return;
  // If the section was navigated away from, functionalnav.js already
  if (!selectEl.isConnected) return;

  const instance = M.FormSelect.getInstance(selectEl);
  if (instance) {
    instance.destroy();
  }
  M.FormSelect.init(selectEl);
}

function resetAssignProductForm() {
  if (unsubscribeProduct) {
    unsubscribeProduct();
    unsubscribeProduct = null;
  }

  const form = document.getElementById("addProductForm");
  if (!form) return;

  form.reset();

  document.getElementById("productPrice").value = "";
  document.getElementById("availableStock").value = "";
  document.getElementById("assignQuantity").value = "";

  const select = document.getElementById("productName");
  select.innerHTML = `<option value="" disabled selected>Choose Product</option>`;

  M.updateTextFields();
  reinitSelect(select);

  loadInventoryOptions(document.getElementById("productRole").value);
}

function loadInventoryOptions(role = "") {
  const select = document.getElementById("productName");
  if (!select) return;

  if (unsubscribeInventoryOptions) {
    unsubscribeInventoryOptions();
  }

  let q = collection(db, "inventory");
  if (role) {
    q = query(collection(db, "inventory"), where("role", "==", role));
  }

  unsubscribeInventoryOptions = onSnapshot(q, (snapshot) => {
    // Guard against a stale snapshot firing after the user navigated away
    if (!select.isConnected) return;

    select.innerHTML = `<option value="" disabled selected>Choose Product</option>`;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.status === "On Selling") return;

      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = data.product_name;
      select.appendChild(option);
    });

    reinitSelect(select);
  });
}

// all DOM-dependent listeners live in one place and get
function bindProductFormListeners() {
  const productRole = document.getElementById("productRole");
  const productName = document.getElementById("productName");
  const addProductForm = document.getElementById("addProductForm");

  productRole.addEventListener("change", (e) => {
    const role = e.target.value;

    document.getElementById("productName").innerHTML =
      `<option value="" disabled selected>Choose Product</option>`;
    document.getElementById("productPrice").value = "";
    document.getElementById("availableStock").value = "";
    document.getElementById("assignQuantity").value = "";

    M.updateTextFields();
    loadInventoryOptions(role);
  });

  productName.addEventListener("change", (e) => {
    const id = e.target.value;
    if (!id) return;

    if (unsubscribeProduct) {
      unsubscribeProduct();
    }

    unsubscribeProduct = onSnapshot(doc(db, "inventory", id), (snap) => {
      const priceEl = document.getElementById("productPrice");
      const stockEl = document.getElementById("availableStock");
      // Same stale-listener guard as elsewhere: bail if the page was
      // navigated away from before this snapshot callback fired.
      if (!priceEl || !priceEl.isConnected) return;
      if (!snap.exists()) return;

      const data = snap.data();
      priceEl.value = data.unit_price;

      if (data.unit_type === "pack") {
        stockEl.value = data.quantity;
      } else {
        stockEl.value = data.stock_quantity;
      }

      M.updateTextFields();
    });
  });

  addProductForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const inventoryId = document.getElementById("productName").value;
    const employeeId = document.getElementById("productEmployee").value;
    const role = document.getElementById("productRole").value;
    const quantity = parseInt(document.getElementById("assignQuantity").value);

    if (!inventoryId) {
      console.error("inventoryId is empty");
      return;
    }

    const invRef = doc(db, "inventory", inventoryId);
    const invSnap = await getDoc(invRef);
    const invData = invSnap.data();

    let employeeCount = 1;
    if (employeeId === "") {
      const q = query(collection(db, "employees"), where("role", "==", role));
      const employeeSnap = await getDocs(q);
      employeeCount = employeeSnap.size;
    }

    const totalAssigned = quantity * employeeCount;

    if (invData.unit_type === "pack") {
      if (invData.quantity < totalAssigned) {
        M.toast({ html: "Not enough stock!", classes: "red rounded" });
        return;
      }
    } else {
      if (invData.stock_quantity < totalAssigned) {
        M.toast({ html: "Not enough stock!", classes: "red rounded" });
        return;
      }
    }

    let newQuantity;
    let newStockQuantity;

    if (invData.unit_type === "pack") {
      const categorySnap = await getDoc(
        doc(db, "categoriesINV", invData.category_id),
      );
      const piecesPerPack = categorySnap.data().pieces_per_pack;

      newQuantity = invData.quantity - totalAssigned;
      newStockQuantity = newQuantity * piecesPerPack;
    } else {
      newQuantity = invData.quantity - totalAssigned;
      newStockQuantity = newQuantity;
    }

    await updateDoc(invRef, {
      quantity: newQuantity,
      stock_quantity: newStockQuantity,
      status: newQuantity <= 0 ? "On Selling" : "Available",
      // Marks this item as "currently assigned to an employee"
      assigned: true,
      last_updated: serverTimestamp(),
    });

    if (employeeId === "") {
      const employeeQuery = query(
        collection(db, "employees"),
        where("role", "==", role),
      );
      const employeeSnap = await getDocs(employeeQuery);

      for (const employee of employeeSnap.docs) {
        await addDoc(collection(db, "products"), {
          name: invData.product_name,
          price: invData.unit_price,
          role,
          employeeId: employee.id,
          stock: quantity,
          inventoryId,
          unit_type: invData.unit_type,
          assigned_at: serverTimestamp(),
        });
      }
    } else {
      await addDoc(collection(db, "products"), {
        name: invData.product_name,
        price: invData.unit_price,
        role,
        employeeId,
        stock: quantity,
        inventoryId,
        unit_type: invData.unit_type,
        assigned_at: serverTimestamp(),
      });
    }

    M.toast({
      html: "Product assigned successfully!",
      classes: "green rounded",
    });

    if (unsubscribeProduct) {
      unsubscribeProduct();
      unsubscribeProduct = null;
    }

    resetAssignProductForm();
  });
}

export async function loadProducts() {
  const tbody = document.querySelector("#productTable tbody");
  const filterRole = document.getElementById("filterRole");
  if (!tbody || !filterRole) return;

  const empSnap = await getDocs(collection(db, "employees"));
  const employeesMap = {};
  empSnap.forEach((docSnap) => {
    employeesMap[docSnap.id] = docSnap.data();
  });

  // Populate "Filter by Role" with only the roles that currently have
  loadRoleFilterOptions(filterRole);

  function renderProducts(employeeId = "", role = "") {
    if (unsubscribeProducts) {
      unsubscribeProducts();
      unsubscribeProducts = null;
    }

    let q = collection(db, "products");

    if (employeeId) {
      const empRole = employeesMap[employeeId].role;
      q = query(collection(db, "products"), where("role", "==", empRole));
    } else if (role) {
      q = query(collection(db, "products"), where("role", "==", role));
    }

    unsubscribeProducts = onSnapshot(q, (querySnapshot) => {
      // Stale-listener guard: if we navigated away from product.html,
      // #productTable's tbody no longer exists in the live DOM.
      if (!tbody.isConnected) return;

      tbody.innerHTML = "";
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();

        if (!employeeId || !data.employeeId || data.employeeId === employeeId) {
          const empData = employeesMap[data.employeeId] || {};
          const empDisplay = empData.fname
            ? `${empData.fname} ${empData.lname} (${empData.role})`
            : "-";

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

      document.querySelectorAll(".delete-btn").forEach((btn) => {
        btn.onclick = async () => {
          const id = btn.dataset.id;

          const confirmed = await confirmDeletion(
            "Delete Product?",
            "This product will be permanently deleted.",
          );

          if (confirmed) {
            try {
              const productRef = doc(db, "products", id);
              const productSnap = await getDoc(productRef);
              if (!productSnap.exists()) {
                throw new Error("Product Not Found!");
              }

              const productData = productSnap.data();

              if (!productData.inventoryId) {
                await deleteDoc(productRef);
                M.toast({
                  html: "Product deleted but stock cannot be restored.",
                  classes: "orange rounded",
                });
                return;
              }

              const inventoryRef = doc(
                db,
                "inventory",
                productData.inventoryId,
              );

              await runTransaction(db, async (transaction) => {
                const inventorySnap = await transaction.get(inventoryRef);
                if (!inventorySnap.exists()) {
                  throw new Error("Inventory not found");
                }

                const invData = inventorySnap.data();
                let restoreQuantity = invData.quantity + productData.stock;
                let restoreStockQuantity;

                if (invData.unit_type === "pack") {
                  const categorySnap = await getDoc(
                    doc(db, "categoriesINV", invData.category_id),
                  );
                  const piecesPerPack = categorySnap.data().pieces_per_pack;
                  restoreStockQuantity = restoreQuantity * piecesPerPack;
                } else {
                  restoreStockQuantity = restoreQuantity;
                }

                transaction.update(inventoryRef, {
                  quantity: restoreQuantity,
                  stock_quantity: restoreStockQuantity,
                  status: restoreQuantity <= 0 ? "On Selling" : "Available",
                  last_updated: serverTimestamp(),
                });

                transaction.delete(productRef);
              });

              // Only revert "assigned" back to false once NO other
              const remainingAssignmentsQuery = query(
                collection(db, "products"),
                where("inventoryId", "==", productData.inventoryId),
              );
              const remainingAssignmentsSnap = await getDocs(
                remainingAssignmentsQuery,
              );

              if (remainingAssignmentsSnap.empty) {
                await updateDoc(inventoryRef, { assigned: false });
              }

              await SyncProductFromFirebase();

              M.toast({
                html: "Product deleted successfully!",
                classes: "green rounded",
              });
              resetAssignProductForm();
            } catch (err) {
              console.error("Delete error:", err);
              M.toast({
                html: "Failed to delete Product.",
                classes: "red rounded",
              });
            }
          }
        };
      });

      document.querySelectorAll(".edit-btn").forEach((btn) => {
        btn.onclick = async (e) => {
          const id = e.target.closest("button").dataset.id;
          const row = e.target.closest("tr");

          document.getElementById("edit-name").value =
            row.children[0].textContent;
          document.getElementById("edit-price").value =
            row.children[1].textContent.replace("₱", "");
          document.getElementById("edit-stock").value =
            row.children[2].textContent;

          M.updateTextFields();

          const modalElem = document.getElementById("modal-edit-product");
          // Reuse the existing instance instead of re-initializing — a
          // fresh M.Modal.init() on an already-initialized modal creates
          // a duplicate overlay and desyncs open/close (same class of
          // bug that hit the Add Product modal in adminBE.js).
          let modalInstance = M.Modal.getInstance(modalElem);
          if (!modalInstance) {
            modalInstance = M.Modal.init(modalElem);
          }
          modalInstance.open();

          const productRef = doc(db, "products", id);
          const productSnap = await getDoc(productRef);
          const oldData = productSnap.data();
          const oldStock = oldData.stock;
          const saveBtn = document.getElementById("edit-save");

          saveBtn.onclick = async () => {
            const newName = document.getElementById("edit-name").value;
            const newPrice = parseFloat(
              document.getElementById("edit-price").value,
            );
            const newStock = parseInt(
              document.getElementById("edit-stock").value,
            );
            const diff = newStock - oldStock;

            const inventoryRef = doc(db, "inventory", oldData.inventoryId);
            const inventorySnap = await getDoc(inventoryRef);
            const inventoryData = inventorySnap.data();

            let updatedQuantity;

            if (diff > 0) {
              if (inventoryData.quantity < diff) {
                M.toast({
                  html: "Not enough inventory stock!",
                  classes: "red rounded",
                });
                return;
              }
              updatedQuantity = inventoryData.quantity - diff;
            } else {
              updatedQuantity = inventoryData.quantity + Math.abs(diff);
            }

            let updatedStockQuantity;

            if (inventoryData.unit_type === "pack") {
              const categorySnap = await getDoc(
                doc(db, "categoriesINV", inventoryData.category_id),
              );
              const piecesPerPack = categorySnap.data().pieces_per_pack;
              updatedStockQuantity = updatedQuantity * piecesPerPack;
            } else {
              updatedStockQuantity = updatedQuantity;
            }

            await updateDoc(doc(db, "products", id), {
              name: newName,
              price: newPrice,
              stock: newStock,
            });

            await updateDoc(inventoryRef, {
              quantity: updatedQuantity,
              stock_quantity: updatedStockQuantity,
              status: updatedQuantity <= 0 ? "On Selling" : "Available",
              last_updated: serverTimestamp(),
            });

            if (unsubscribeProduct) {
              unsubscribeProduct();
              unsubscribeProduct = null;
            }

            loadInventoryOptions(document.getElementById("productRole").value);

            M.toast({
              html: "Successfully Updated!",
              classes: "green rounded",
            });
            modalInstance.close();
          };
        };
      });
    });
  }

  renderProducts();

  filterRole.addEventListener("change", () => {
    const selectedRole = document.getElementById("filterRole").value;
    renderProducts("", selectedRole);
  });
}

// Keeps the "Filter by Role" dropdown in sync with the roles that
// actually have at least one assigned product right now, updating
// live whenever the "products" collection changes.
function loadRoleFilterOptions(filterRoleSelect) {
  if (unsubscribeRoleFilter) {
    unsubscribeRoleFilter();
  }

  unsubscribeRoleFilter = onSnapshot(collection(db, "products"), (snapshot) => {
    // Stale-listener guard: skip if the dropdown was removed from the
    // DOM because the user navigated to a different section.
    if (!filterRoleSelect.isConnected) return;

    const roles = new Set();

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.role) {
        roles.add(data.role.trim());
      }
    });

    // preserve the currently selected filter value across re-renders
    const previousValue = filterRoleSelect.value;

    filterRoleSelect.innerHTML = `<option value="" selected>All Roles</option>`;
    roles.forEach((role) => {
      filterRoleSelect.innerHTML += `<option value="${role}">${role}</option>`;
    });

    if (previousValue && roles.has(previousValue)) {
      filterRoleSelect.value = previousValue;
    }

    reinitSelect(filterRoleSelect);
  });
}

function confirmDeletion(title, message) {
  const modalElement = document.getElementById("modal-delete-category");
  const confirmButton = document.getElementById("confirm-delete-category");
  const cancelButton = document.getElementById("cancel-delete-category");
  const titleElement = document.getElementById("delete-confirmation-title");
  const messageElement = document.getElementById("delete-confirmation-message");

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

// This is the entry point called every single time
export async function initProductPage() {
  M.Modal.init(document.querySelectorAll(".modal"), {
    dismissible: false,
  });

  await loadRoles();

  bindProductFormListeners(); // <-- re-attach listeners to the new DOM
  resetAssignProductForm(); // <-- reset + load dropdown options

  console.log("✅ Product page initialized");
}

// Call this BEFORE navigating away from product.html
export function cleanupProductPage() {
  if (unsubscribeInventoryOptions) {
    unsubscribeInventoryOptions();
    unsubscribeInventoryOptions = null;
  }
  if (unsubscribeProducts) {
    unsubscribeProducts();
    unsubscribeProducts = null;
  }
  if (unsubscribeProduct) {
    unsubscribeProduct();
    unsubscribeProduct = null;
  }
  if (unsubscribeRoleFilter) {
    unsubscribeRoleFilter();
    unsubscribeRoleFilter = null;
  }
}

async function loadRoles() {
  const roleSelect = document.getElementById("productRole");
  const snap = await getDocs(collection(db, "employees"));
  const roles = new Set();

  roleSelect.innerHTML = `<option value="" disabled selected>Choose Role</option>`;

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.role) {
      roles.add(data.role.trim());
    }
  });

  roles.forEach((role) => {
    roleSelect.innerHTML += `<option value="${role}">${role}</option>`;
  });

  reinitSelect(roleSelect);
}