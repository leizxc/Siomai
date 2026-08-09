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
// delta: negative on assign, positive on restore/delete.
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

function bindProductFormListeners() {
  const productRole = document.getElementById("productRole");
  const productName = document.getElementById("productName");
  const addProductForm = document.getElementById("addProductForm");

  productRole.addEventListener("change", (e) => {
    document.getElementById("productName").innerHTML =
      `<option value="" disabled selected>Choose Product</option>`;
    document.getElementById("productPrice").value = "";
    document.getElementById("availableStock").value = "";
    document.getElementById("assignQuantity").value = "";
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
      priceEl.value = data.price;
      stockEl.value = data.current_stock;
      if (stockUnitEl)
        stockUnitEl.textContent = data.unit ? data.unit.toUpperCase() : "";

      M.updateTextFields();
    });
  });

  addProductForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const menuId = document.getElementById("productName").value;
    const employeeId = document.getElementById("productEmployee").value;
    const role = document.getElementById("productRole").value;
    const quantity = parseInt(document.getElementById("assignQuantity").value);

    if (!menuId) return;

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

    if (menuData.current_stock < totalAssigned) {
      M.toast({ html: "Not enough stock!", classes: "red rounded" });
      return;
    }

    const newStock = menuData.current_stock - totalAssigned;

    await updateDoc(menuRef, {
      current_stock: newStock,
      status: newStock <= 0 ? "On Selling" : "Available",
      assigned: true,
      last_updated: serverTimestamp(),
    });

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
          inventoryId: menuId,
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
        inventoryId: menuId,
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

          await runTransaction(db, async (transaction) => {
            const menuSnap = await transaction.get(menuRef);
            if (!menuSnap.exists())
              throw new Error("Product menu entry not found");

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
          row.children[2].textContent;

        M.updateTextFields();

        const modalElem = document.getElementById("modal-edit-product");
        let modalInstance = M.Modal.getInstance(modalElem);
        if (!modalInstance) modalInstance = M.Modal.init(modalElem);
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
          <td data-label="Stock">${data.stock}</td>
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
