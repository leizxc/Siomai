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
//refresh all input types
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
  const stockUnitElReset = document.getElementById("availableStockUnit");
  if (stockUnitElReset) stockUnitElReset.textContent = "";

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

  let q = collection(db, "productMenu");

  if (role) {
    // "ALL" = "Shared Across All Roles" sa productmenu.js — dapat lumabas
    // ito kahit anong role ang napili, kaya "in" hindi basta "==".
    q = query(
      collection(db, "productMenu"),
      where("category", "in", [role, "ALL"]),
    );
  }

  unsubscribeInventoryOptions = onSnapshot(q, (snapshot) => {
    // Guard against a stale snapshot firing after the user navigated away
    if (!select.isConnected) return;

    select.innerHTML = `<option value="" disabled selected>Choose Product</option>`;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();

      if (data.status !== "Available") return;

      const option = document.createElement("option");
      option.value = docSnap.id; // productMenu id
      option.textContent = data.product_name;

      select.appendChild(option);
    });

    reinitSelect(select);
  });
}

// Ibinabawas o ibinabalik ang stock ng ORIGINAL na linked inventory doc
// (yung inventory_id na naka-store sa productMenu doc), para manatiling
// sync ang dalawang collections. delta: negative = bawas (pag-assign),
// positive = dagdag (pag-restore/delete/undo). Parehong unit ang delta
// dito sa inventory.quantity (packs/kg/liter/quantity) — tumutugma ito
// dahil galing mismo dito ang unang stock na kinopya papunta sa
// productMenu (via bindInventoryAllocationChange sa productmenu.js).
async function adjustLinkedInventoryStock(inventoryId, delta) {
  if (!inventoryId) return;

  const inventoryRef = doc(db, "inventory", inventoryId);
  const inventorySnap = await getDoc(inventoryRef);
  if (!inventorySnap.exists()) return;

  const invData = inventorySnap.data();
  const newQuantity = (invData.quantity || 0) + delta;

  let newStockQuantity;
  if (invData.unit_type === "pack") {
    const categorySnap = await getDoc(
      doc(db, "categoriesINV", invData.category_id),
    );
    const piecesPerPack = categorySnap.exists()
      ? categorySnap.data().pieces_per_pack || 1
      : 1;
    newStockQuantity = newQuantity * piecesPerPack;
  } else {
    newStockQuantity = newQuantity;
  }

  await updateDoc(inventoryRef, {
    quantity: newQuantity,
    stock_quantity: newStockQuantity,
    status: newQuantity <= 0 ? "On Selling" : "Available",
    last_updated: serverTimestamp(),
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
    const stockUnitElRole = document.getElementById("availableStockUnit");
    if (stockUnitElRole) stockUnitElRole.textContent = "";

    M.updateTextFields();
    loadInventoryOptions(role);
  });

  productName.addEventListener("change", (e) => {
    const id = e.target.value;
    if (!id) return;

    if (unsubscribeProduct) {
      unsubscribeProduct();
    }

    unsubscribeProduct = onSnapshot(doc(db, "productMenu", id), (snap) => {
      const priceEl = document.getElementById("productPrice");
      const stockEl = document.getElementById("availableStock");
      const stockUnitEl = document.getElementById("availableStockUnit");
      // Same stale-listener guard as elsewhere: bail if the page was
      // navigated away from before this snapshot callback fired.
      if (!priceEl || !priceEl.isConnected) return;
      if (!snap.exists()) return;

      const data = snap.data();
      priceEl.value = data.price;
      stockEl.value = data.current_stock;
      if (stockUnitEl) {
        stockUnitEl.textContent = data.unit ? data.unit.toUpperCase() : "";
      }

      M.updateTextFields();
    });
  });

  addProductForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const menuId = document.getElementById("productName").value;
    const employeeId = document.getElementById("productEmployee").value;
    const role = document.getElementById("productRole").value;
    const quantity = parseInt(document.getElementById("assignQuantity").value);

    if (!menuId) {
      console.error("menuId is empty");
      return;
    }

    const menuRef = doc(db, "productMenu", menuId);
    const menuSnap = await getDoc(menuRef);

    if (!menuSnap.exists()) {
      M.toast({ html: "Product not found.", classes: "red rounded" });
      return;
    }

    const menuData = menuSnap.data();

    let employeeCount = 1;
    if (employeeId === "") {
      const q = query(collection(db, "employees"), where("role", "==", role));
      const employeeSnap = await getDocs(q);
      employeeCount = employeeSnap.size;
    }

    const totalAssigned = quantity * employeeCount;

    // productMenu tracks a flat current_stock — hindi na kailangan ang
    // pack/kg/liter distinction dito (nasa "inventory" na lang yun).
    if (menuData.current_stock < totalAssigned) {
      M.toast({ html: "Not enough stock!", classes: "red rounded" });
      return;
    }

    const newStock = menuData.current_stock - totalAssigned;

    await updateDoc(menuRef, {
      current_stock: newStock,
      status: newStock <= 0 ? "On Selling" : "Available",
      // Marks this item as "currently assigned to an employee"
      assigned: true,
      last_updated: serverTimestamp(),
    });

    // Ibawas din sa ORIGINAL na inventory doc, dahil naka-connect dito
    // ang productMenu entry (via inventory_id).
    await adjustLinkedInventoryStock(menuData.inventory_id, -totalAssigned);

    if (employeeId === "") {
      const employeeQuery = query(
        collection(db, "employees"),
        where("role", "==", role),
      );
      const employeeSnap = await getDocs(employeeQuery);

      for (const employee of employeeSnap.docs) {
        await addDoc(collection(db, "products"), {
          name: menuData.product_name,
          price: menuData.price,
          role,
          employeeId: employee.id,
          stock: quantity,
          inventoryId: menuId, // now points to a productMenu doc id
          assigned_at: serverTimestamp(),
        });
      }
    } else {
      await addDoc(collection(db, "products"), {
        name: menuData.product_name,
        price: menuData.price,
        role,
        employeeId,
        stock: quantity,
        inventoryId: menuId, // now points to a productMenu doc id
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

              // productData.inventoryId now points to a productMenu doc.
              const menuRef = doc(db, "productMenu", productData.inventoryId);
              const menuCheckSnap = await getDoc(menuRef);

              // Orphaned reference — matandang data bago ma-migrate papunta
              // sa productMenu collection, o na-delete na yung linked entry.
              // Burahin na lang ang products doc, wala nang i-re-restore.
              if (!menuCheckSnap.exists()) {
                await deleteDoc(productRef);
                M.toast({
                  html: "Product deleted, but linked menu entry was already gone (stock not restored).",
                  classes: "orange rounded",
                });
                return;
              }

              await runTransaction(db, async (transaction) => {
                const menuSnap = await transaction.get(menuRef);
                if (!menuSnap.exists()) {
                  throw new Error("Product menu entry not found");
                }

                const menuData = menuSnap.data();
                const restoredStock =
                  (menuData.current_stock || 0) + productData.stock;

                transaction.update(menuRef, {
                  current_stock: restoredStock,
                  status: restoredStock <= 0 ? "On Selling" : "Available",
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
                await updateDoc(menuRef, { assigned: false });
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

            // productData.inventoryId now points to a productMenu doc.
            const menuRef = doc(db, "productMenu", oldData.inventoryId);
            const menuSnap = await getDoc(menuRef);
            const menuData = menuSnap.data();

            let updatedStock;

            if (diff > 0) {
              if (menuData.current_stock < diff) {
                M.toast({
                  html: "Not enough inventory stock!",
                  classes: "red rounded",
                });
                return;
              }
              updatedStock = menuData.current_stock - diff;
            } else {
              updatedStock = menuData.current_stock + Math.abs(diff);
            }

            await updateDoc(doc(db, "products", id), {
              name: newName,
              price: newPrice,
              stock: newStock,
            });

            await updateDoc(menuRef, {
              current_stock: updatedStock,
              status: updatedStock <= 0 ? "On Selling" : "Available",
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
