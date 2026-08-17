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

let unsubscribeInventoryOptions = null;
let unsubscribeProducts = null;
let unsubscribeProduct = null;
let unsubscribeRoleFilter = null;

function reinitSelect(selectEl) {
  if (!selectEl || !selectEl.isConnected) return;

  const instance = M.FormSelect.getInstance(selectEl);
  if (instance) instance.destroy();

  M.FormSelect.init(selectEl);
}

// current_stock stays in pieces for the assignment calculation. These extra
// fields keep the Product Menu document readable as both packs and pieces.
function buildCurrentQuantityFields(menuData, pieces) {
  const isPack = menuData.unit === "pack";
  const piecesPerPack = Number(menuData.pieces_per_pack) || 1;

  return {
    current_stock: pieces,
    current_pieces: pieces,
    current_packs: isPack ? Math.ceil(pieces / piecesPerPack) : null,
  };
}

// Employee products keep pieces for sales, with packs shown alongside them.
function buildAssignedQuantityFields(menuData, pieces) {
  const isPack = menuData.unit === "pack";
  const piecesPerPack = Number(menuData.pieces_per_pack) || 1;

  return {
    stock: pieces,
    pieces,
    packs: isPack ? Math.ceil(pieces / piecesPerPack) : null,
    pieces_per_pack: piecesPerPack,
    unit: menuData.unit || "piece",
  };
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
  document.getElementById("availablePacks").value = "";
  document.getElementById("availableStock").value = "";
  document.getElementById("assignPacks").value = "";
  document.getElementById("assignPieces").value = "";
  const stockUnitEl = document.getElementById("availableStockUnit");
  if (stockUnitEl) stockUnitEl.textContent = "";

  const select = document.getElementById("productName");
  select.innerHTML = `<option value="" disabled selected>Choose Product</option>`;

  M.updateTextFields();
  reinitSelect(select);

  loadInventoryOptions(document.getElementById("productRole").value);
}

function loadInventoryOptions(role = "") {
  const select = document.getElementById("productName");
  if (!select) return;

  if (unsubscribeInventoryOptions) unsubscribeInventoryOptions();

  // "ALL" = shared across every role
  let q = collection(db, "productMenu");
  if (role) {
    q = query(
      collection(db, "productMenu"),
      where("category", "in", [role, "ALL"]),
    );
  }

  unsubscribeInventoryOptions = onSnapshot(q, (snapshot) => {
    if (!select.isConnected) return;

    select.innerHTML = `<option value="" disabled selected>Choose Product</option>`;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.status !== "Available") return;

      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = data.product_name;
      select.appendChild(option);
    });

    reinitSelect(select);
  });
}

// Keeps the linked "inventory" doc's stock in sync with productMenu.
// deltaPieces is ALWAYS expressed in pieces (that's the unit productMenu
// tracks its stock in) — negative on assign, positive on restore/delete.
//
// IMPORTANT: for "pack" unit_type inventory items, inventory.quantity is
// stored in PACKS, not pieces (see adminBE.js: stock_quantity = quantity *
// pieces_per_pack). So deltaPieces must be converted to packs before it's
// applied to inventory.quantity — applying it directly (as pieces) was the
// bug that made inventory.quantity crash into deeply negative numbers.
async function adjustLinkedInventoryStock(inventoryId, deltaPieces) {
  if (!inventoryId) return;

  const inventoryRef = doc(db, "inventory", inventoryId);
  const inventorySnap = await getDoc(inventoryRef);
  if (!inventorySnap.exists()) return;

  const invData = inventorySnap.data();

  let piecesPerPack = 1;
  let deltaInInventoryUnit = deltaPieces;

  if (invData.unit_type === "pack") {
    const categorySnap = await getDoc(
      doc(db, "categoriesINV", invData.category_id),
    );
    piecesPerPack = categorySnap.exists()
      ? categorySnap.data().pieces_per_pack || 1
      : 1;
    // Convert the pieces delta into packs before touching quantity.
    deltaInInventoryUnit = deltaPieces / piecesPerPack;
  }

  const newQuantity = (invData.quantity || 0) + deltaInInventoryUnit;

  const newStockQuantity =
    invData.unit_type === "pack" ? newQuantity * piecesPerPack : newQuantity;

  await updateDoc(inventoryRef, {
    quantity: newQuantity,
    stock_quantity: newStockQuantity,
    status: newQuantity <= 0 ? "On Selling" : "Available",
    last_updated: serverTimestamp(),
  });
}

function bindProductFormListeners() {
  const productRole = document.getElementById("productRole");
  const productName = document.getElementById("productName");
  const addProductForm = document.getElementById("addProductForm");

  productRole.addEventListener("change", (e) => {
    document.getElementById("productName").innerHTML =
      `<option value="" disabled selected>Choose Product</option>`;
    document.getElementById("productPrice").value = "";
    document.getElementById("availablePacks").value = "";
    document.getElementById("availableStock").value = "";
    document.getElementById("assignPacks").value = "";
    document.getElementById("assignPieces").value = "";
    const stockUnitEl = document.getElementById("availableStockUnit");
    if (stockUnitEl) stockUnitEl.textContent = "";

    M.updateTextFields();
    loadInventoryOptions(e.target.value);
  });

  productName.addEventListener("change", (e) => {
    const id = e.target.value;
    if (!id) return;

    if (unsubscribeProduct) unsubscribeProduct();

    unsubscribeProduct = onSnapshot(doc(db, "productMenu", id), (snap) => {
      const priceEl = document.getElementById("productPrice");
      const stockEl = document.getElementById("availableStock");
      const stockUnitEl = document.getElementById("availableStockUnit");
      if (!priceEl || !priceEl.isConnected) return;
      if (!snap.exists()) return;

      const data = snap.data();
      const pieces = Number(data.current_pieces ?? data.current_stock) || 0;
      const piecesPerPack = Number(data.pieces_per_pack) || 1;
      priceEl.value = data.price;
      stockEl.value = pieces;
      document.getElementById("availablePacks").value =
        data.unit === "pack" ? Math.ceil(pieces / piecesPerPack) : "";
      const assignPacksInput = document.getElementById("assignPacks");
      assignPacksInput.dataset.piecesPerPack = piecesPerPack;
      assignPacksInput.dataset.unit = data.unit || "";
      assignPacksInput.max =
        data.unit === "pack" ? Math.floor(pieces / piecesPerPack) : pieces;
      if (stockUnitEl)
        stockUnitEl.textContent = data.unit ? data.unit.toUpperCase() : "";

      M.updateTextFields();
    });
  });

  document.getElementById("assignPacks").addEventListener("input", (e) => {
    const packs = Number(e.target.value) || 0;
    const piecesPerPack = Number(e.target.dataset.piecesPerPack) || 1;
    document.getElementById("assignPieces").value = packs * piecesPerPack;
    M.updateTextFields();
  });

  addProductForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const menuId = document.getElementById("productName").value;
    const employeeId = document.getElementById("productEmployee").value;
    const role = document.getElementById("productRole").value;
    const packsToAssign = Number(document.getElementById("assignPacks").value);

    if (!menuId) return;

    const menuRef = doc(db, "productMenu", menuId);
    const menuSnap = await getDoc(menuRef);
    if (!menuSnap.exists()) {
      M.toast({ html: "Product not found.", classes: "red rounded" });
      return;
    }

    const menuData = menuSnap.data();
    const piecesPerPack = Number(menuData.pieces_per_pack) || 1;
    const quantity = packsToAssign * piecesPerPack;

    if (!Number.isInteger(packsToAssign) || packsToAssign <= 0) {
      M.toast({
        html: "Enter a valid number of packs.",
        classes: "red rounded",
      });
      return;
    }

    let targetEmployees = [{ id: employeeId }];
    if (employeeId === "") {
      const q = query(collection(db, "employees"), where("role", "==", role));
      const employeeSnap = await getDocs(q);
      targetEmployees = employeeSnap.docs;
    }

    if (targetEmployees.length === 0) {
      M.toast({
        html: "No employees found for this role.",
        classes: "red rounded",
      });
      return;
    }

    const totalAssigned = quantity * targetEmployees.length;

    if (menuData.current_stock < totalAssigned) {
      M.toast({ html: "Not enough stock!", classes: "red rounded" });
      return;
    }

    const newStock = menuData.current_stock - totalAssigned;

    await updateDoc(menuRef, {
      ...buildCurrentQuantityFields(menuData, newStock),
      status: newStock <= 0 ? "On Selling" : "Available",
      assigned: true,
      last_updated: serverTimestamp(),
    });

    // totalAssigned is in pieces — adjustLinkedInventoryStock converts it
    // to the inventory item's own unit (packs, kg, liter, etc.) internally.
    await adjustLinkedInventoryStock(menuData.inventory_id, -totalAssigned);

    // Reuse an existing employee/product row instead of creating duplicates.
    // One productMenu item may have only one row per employee.
    const assignedProductsSnap = await getDocs(
      query(collection(db, "products"), where("inventoryId", "==", menuId)),
    );
    const existingByEmployee = new Map();
    assignedProductsSnap.forEach((productSnap) => {
      const product = productSnap.data();
      if (product.employeeId && !existingByEmployee.has(product.employeeId)) {
        existingByEmployee.set(product.employeeId, productSnap);
      }
    });

    for (const employee of targetEmployees) {
      const existingProduct = existingByEmployee.get(employee.id);

      if (existingProduct) {
        const existingData = existingProduct.data();
        const updatedPieces =
          (Number(existingData.pieces ?? existingData.stock) || 0) + quantity;

        await updateDoc(existingProduct.ref, {
          name: menuData.product_name,
          price: menuData.price,
          role,
          ...buildAssignedQuantityFields(menuData, updatedPieces),
          last_updated: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "products"), {
          name: menuData.product_name,
          price: menuData.price,
          role,
          employeeId: employee.id,
          ...buildAssignedQuantityFields(menuData, quantity),
          inventoryId: menuId,
          assigned_at: serverTimestamp(),
        });
      }
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

  loadRoleFilterOptions(filterRole);

  function bindRowButtons() {
    tbody.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;

        const confirmed = await confirmDeletion(
          "Delete Product?",
          "This product will be permanently deleted.",
        );
        if (!confirmed) return;

        try {
          const productRef = doc(db, "products", id);
          const productSnap = await getDoc(productRef);
          if (!productSnap.exists()) throw new Error("Product Not Found!");

          const productData = productSnap.data();

          if (!productData.inventoryId) {
            await deleteDoc(productRef);
            M.toast({
              html: "Product deleted but stock cannot be restored.",
              classes: "orange rounded",
            });
            return;
          }

          const menuRef = doc(db, "productMenu", productData.inventoryId);
          const menuCheckSnap = await getDoc(menuRef);

          // Orphaned reference — linked menu entry is already gone
          if (!menuCheckSnap.exists()) {
            await deleteDoc(productRef);
            M.toast({
              html: "Product deleted (stock not restored — menu entry was gone).",
              classes: "orange rounded",
            });
            return;
          }

          const restoredPieces =
            Number(productData.pieces ?? productData.stock) || 0;

          await runTransaction(db, async (transaction) => {
            const menuSnap = await transaction.get(menuRef);
            if (!menuSnap.exists())
              throw new Error("Product menu entry not found");

            const menuData = menuSnap.data();
            const restoredStock =
              (menuData.current_stock || 0) + restoredPieces;

            transaction.update(menuRef, {
              ...buildCurrentQuantityFields(menuData, restoredStock),
              status: restoredStock <= 0 ? "On Selling" : "Available",
              last_updated: serverTimestamp(),
            });

            transaction.delete(productRef);
          });

          // Restore the same pieces back to the linked inventory item —
          // this was missing before, which is why inventory never went
          // back up after unassigning/deleting a product.
          await adjustLinkedInventoryStock(
            productData.inventoryId,
            restoredPieces,
          );

          const remainingQuery = query(
            collection(db, "products"),
            where("inventoryId", "==", productData.inventoryId),
          );
          const remainingSnap = await getDocs(remainingQuery);
          if (remainingSnap.empty) {
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
      };
    });

    tbody.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        const id = e.target.closest("button").dataset.id;
        const row = e.target.closest("tr");

        document.getElementById("edit-name").value =
          row.children[0].textContent;
        document.getElementById("edit-price").value =
          row.children[1].textContent.replace("₱", "");
        document.getElementById("edit-stock").value =
          row.children[3].textContent;

        M.updateTextFields();

        const modalElem = document.getElementById("modal-edit-product");
        let modalInstance = M.Modal.getInstance(modalElem);
        if (!modalInstance) modalInstance = M.Modal.init(modalElem);
        modalInstance.open();

        const productRef = doc(db, "products", id);
        const productSnap = await getDoc(productRef);
        const oldData = productSnap.data();
        const oldStock = Number(oldData.pieces ?? oldData.stock) || 0;
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
            ...buildAssignedQuantityFields(oldData, newStock),
          });

          await updateDoc(menuRef, {
            ...buildCurrentQuantityFields(menuData, updatedStock),
            status: updatedStock <= 0 ? "On Selling" : "Available",
            last_updated: serverTimestamp(),
          });

          // Mirror the same change onto the linked inventory item — an
          // increase in assigned stock (diff > 0) pulls more from
          // inventory; a decrease returns pieces back to inventory.
          // This was missing before, so editing an assigned product's
          // stock never touched inventory at all.
          await adjustLinkedInventoryStock(oldData.inventoryId, -diff);

          if (unsubscribeProduct) {
            unsubscribeProduct();
            unsubscribeProduct = null;
          }

          loadInventoryOptions(document.getElementById("productRole").value);

          M.toast({ html: "Successfully Updated!", classes: "green rounded" });
          modalInstance.close();
        };
      };
    });
  }

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
      if (!tbody.isConnected) return;

      tbody.innerHTML = "";
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        if (employeeId && data.employeeId && data.employeeId !== employeeId)
          return;

        const empData = employeesMap[data.employeeId] || {};
        const empDisplay = empData.fname
          ? `${empData.fname} ${empData.lname}`
          : "-";

        const row = document.createElement("tr");
        row.innerHTML = `
          <td data-label="Product Name">${data.name}</td>
          <td data-label="Price">₱${parseFloat(data.price).toFixed(2)}</td>
          <td data-label="Packs">${
            data.unit === "pack"
              ? Math.ceil(
                  (data.pieces ?? data.stock) / (data.pieces_per_pack || 1),
                )
              : "-"
          }</td>
          <td data-label="Pieces">${data.pieces ?? data.stock}</td>
          <td data-label="Role">${data.role}</td>
          <td data-label="Employee">${empDisplay}</td>
          <td data-label="Action">
            <button class="btn blue edit-btn" data-id="${docSnap.id}"><i class="material-icons">edit</i></button>
            <button class="btn red delete-btn" data-id="${docSnap.id}"><i class="material-icons">delete</i></button>
          </td>
        `;
        tbody.appendChild(row);
      });

      bindRowButtons();
    });
  }

  renderProducts();

  filterRole.addEventListener("change", () => {
    renderProducts("", document.getElementById("filterRole").value);
  });
}

function loadRoleFilterOptions(filterRoleSelect) {
  if (unsubscribeRoleFilter) unsubscribeRoleFilter();

  unsubscribeRoleFilter = onSnapshot(collection(db, "products"), (snapshot) => {
    if (!filterRoleSelect.isConnected) return;

    const roles = new Set();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.role) roles.add(data.role.trim());
    });

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

async function loadRoles() {
  const roleSelect = document.getElementById("productRole");
  const snap = await getDocs(collection(db, "employees"));
  const roles = new Set();

  roleSelect.innerHTML = `<option value="" disabled selected>Choose Role</option>`;

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.role) roles.add(data.role.trim());
  });

  roles.forEach((role) => {
    roleSelect.innerHTML += `<option value="${role}">${role}</option>`;
  });

  reinitSelect(roleSelect);
}

export async function initProductPage() {
  M.Modal.init(document.querySelectorAll(".modal"), { dismissible: false });

  await loadRoles();

  bindProductFormListeners();
  resetAssignProductForm();
}

// Call before navigating away from product.html
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
