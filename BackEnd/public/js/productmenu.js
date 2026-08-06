import { db } from "/js/firebase.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  doc,
  serverTimestamp,
  onSnapshot,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

//global listener state
let unsubscribeInventoryOptions = null;
let unsubscribeProductIdPreview = null; //global listener state para sa live preview ng susunod na Product ID
let unsubscribeMenu = null;

//refresh
export async function refresh() {
  const form = document.getElementById("addProductMenu");

  if (form) {
    form.reset();
  }

  const previewImg = document.getElementById("previewImage");
  if (previewImg) previewImg.src = "/assets/upload-placeholder.png";

  M.updateTextFields();

  reinitSelect(document.getElementById("employeeINV"));
  reinitSelect(document.getElementById("selectCategory"));

  previewNextProductId();
}

// Kada tawag, tumataas ang counter (walang duplicate na product code).
// Tinatawag lang ito pag-Save, hindi pag-preview.
async function generateProductCode() {
  const counterRef = doc(db, "counters", "productCode");

  const nextNumber = await runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const current = counterSnap.exists()
      ? counterSnap.data().lastNumber || 0
      : 0;
    const next = current + 1;

    transaction.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });

  return QC-$;{String(nextNumber).padStart(6, "0")};
}

// Kailangan i-destroy at i-init ulit ang Materialize select, dahil hindi
// ito automatic nag-re-refresh kapag dumagdag ng options after i-init.
function reinitSelect(selectEl) {
  if (!selectEl || !selectEl.isConnected) return;

  const instance = M.FormSelect.getInstance(selectEl);
  if (instance) {
    instance.destroy();
  }
  M.FormSelect.init(selectEl);
}

//invetory allocation
export function loadInventoryOptions(role = "") {
  const select = document.getElementById("employeeINV");
  if (!select) return;

  if (unsubscribeInventoryOptions) {
    unsubscribeInventoryOptions();
  }
  let q = collection(db, "inventory");
  if (role) {
    q = query(collection(db, "inventory"), where("role", "==", role));
  }

  unsubscribeInventoryOptions = onSnapshot(q, (snapshot) => {
    if (!select.isConnected) return;

    select.innerHTML = <option value="" disabled selected>Inventory Allocation</option>;

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

// Kapag pumili ng inventory item, i-auto-fill ang "stock" field base sa
// available stock nung napiling item (pwede pa ring baguhin bago i-save).
function bindInventoryAllocationChange() {
  const select = document.getElementById("employeeINV");
  const stockInput = document.getElementById("stock");
  const stockUnit = document.getElementById("stockUnit");
  if (!select || !stockInput) return;

  select.onchange = async (e) => {
    const inventoryId = e.target.value;
    if (!inventoryId) return;

    const inventorySnap = await getDoc(doc(db, "inventory", inventoryId));
    if (!inventorySnap.exists()) return;

    const data = inventorySnap.data();

    // pack = bilangin sa dami ng packs, hindi sa total pieces
    let stock = data.stock_quantity;
    let unit = data.unit_type;

    if (unit === "pack") {
      stock = data.quantity;
      unit = "PACK";
    } else if (unit === "kg") {
      stock = data.quantity;
      unit = "KG";
    } else if (unit === "liter") {
      stock = data.quantity;
      unit = "LITER";
    }

    stockInput.value = stock;
    if (stockUnit) stockUnit.value = unit;

    M.updateTextFields();
  };
}

//load roles
export async function loadroles() {
  const roleSelect = document.getElementById("selectCategory");

  if (!roleSelect) return;
  const snap = await getDocs(collection(db, "employees"));
  const roles = new Set();

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.role) {
      roles.add(data.role.trim());
    }
  });

  roleSelect.innerHTML = <option value="" disabled selected>Select Role</option>;

  // Hiwalay na option: hindi tied sa isang specific role, makikita sa
  // Assign Product page kahit anong role ang piliin doon.
  const sharedOption = document.createElement("option");
  sharedOption.value = "ALL";
  sharedOption.textContent = "Shared Across All Roles";
  roleSelect.appendChild(sharedOption);

  roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    roleSelect.appendChild(option);
  });

  reinitSelect(roleSelect);
}

// "Preview" lang ito ng susunod na ID (hindi tumataas ang counter dito).
// Kada may na-save na product (kahit ibang admin), live na nag-uupdate ito
// dahil naka-onSnapshot sa counter doc mismo.
function previewNextProductId() {
  const productIdInput = document.getElementById("productId");
  if (!productIdInput) return;

  if (unsubscribeProductIdPreview) {
    unsubscribeProductIdPreview();
  }

  const counterRef = doc(db, "counters", "productCode");

  unsubscribeProductIdPreview = onSnapshot(counterRef, (snap) => {
    if (!productIdInput.isConnected) return;

    const current = snap.exists() ? snap.data().lastNumber || 0 : 0;
    const next = current + 1;

    productIdInput.value = QC-$;{String(next).padStart(6, "0")};
  });
}

//img function to firebase
async function uploadProductImage() {
  const fileInput = document.getElementById("inputImg");
  const file = fileInput.files[0];

  if (!file) return "";

  const formData = new FormData();

  formData.append("file", file);
  formData.append("upload_preset", "Queen_Cassy_Product_Menu");

  const response = await fetch(
    "https://api.cloudinary.com/v1_1/ht5i99mv/image/upload",
    {
      method: "POST",
      body: formData,
    },
  );

  if (!response.ok) {
    const error = await response.json();
    console.error(error);
    throw new Error("Image upload failed.");
  }

  const data = await response.json();

  return data.secure_url;
}

//save button
export function addproductmenu() {
  const form = document.getElementById("addProductMenu");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const saveBtn = document.getElementById("save-menu");

    try {
      const inventoryId = document.getElementById("employeeINV").value;
      const productName = document
        .getElementById("inputProduct")
        .value.trim()
        .toUpperCase();
      const role = document.getElementById("selectCategory").value;
      const stock = Number(document.getElementById("stock").value);
      const price = Number(document.getElementById("price").value);

      if (!inventoryId || !productName || !role || stock <= 0 || price <= 0) {
        M.toast({
          html: "Please complete all fields.",
          classes: "red rounded",
        });
        return;
      }

      if (saveBtn) saveBtn.disabled = true;

      //checking kung may kaparehas na name product
      const existingProduct = await getDocs(
        query(
          collection(db, "productMenu"),
          where("product_name", "==", productName),
        ),
      );
      if (!existingProduct.empty) {
        M.toast({
          html: "Product name already exists.",
          classes: "red rounded",
        });
        refresh();
        return;
      }

      // Permanent Product Code
      const productCode = await generateProductCode();

      //img
      const imageURL = await uploadProductImage();

      // Inventory Details
      const inventorySnap = await getDoc(doc(db, "inventory", inventoryId));

      if (!inventorySnap.exists()) {
        M.toast({ html: "Inventory not found.", classes: "red rounded" });
        return;
      }

      const inventory = inventorySnap.data();

      // Save Firestore
      await addDoc(collection(db, "productMenu"), {
        product_code: productCode,
        product_name: productName,
        category: role,
        inventory_id: inventoryId,
        inventory_name: inventory.product_name,
        initial_stock: stock,
        current_stock: stock,
        unit: inventory.unit_type,
        price: price,
        image_url: imageURL,
        status: "Available",
        created_at: serverTimestamp(),
      });

      M.toast({ html: "Product Menu Saved!", classes: "green rounded" });

      form.reset();
      refresh();
    } catch (error) {
      console.error(error);

      M.toast({
        html: "Error saving product.",
        classes: "red rounded",
      });
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
}

//gawing upper case din habang nag ttype
function initUppercaseProductName() {
  const input = document.getElementById("inputProduct");

  if (!input) return;

  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase();
  });
}

//filter function
async function loadCategoryFilter() {
  const select = document.getElementById("filterCategory");

  if (!select) return;

  const snap = await getDocs(collection(db, "employees"));

  const categories = new Set();

  select.innerHTML = <option value="">All Categories</option>;

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.role) {
      categories.add(data.role.trim());
    }
  });

  categories.forEach((category) => {
    const option = document.createElement("option");

    option.value = category;
    option.textContent = category;

    select.appendChild(option);
  });

  reinitSelect(select);
}

// Parehong modal na ginagamit din sa Inventory/Product Assign pages
// (modal-delete-category) — reused dito, hindi na gumawa ng bago.
function confirmDeletion(title, message) {
  const modalElement = document.getElementById("modal-delete-category");
  if (!modalElement) return Promise.resolve(window.confirm(message));

  const confirmButton = document.getElementById("confirm-delete-category");
  const cancelButton = document.getElementById("cancel-delete-category");
  const titleElement = document.getElementById("delete-confirmation-title");
  const messageElement = document.getElementById("delete-confirmation-message");

  const modalInstance = M.Modal.init(modalElement, { dismissible: false });

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

//table function
export async function loadmenu() {
  const tbody = document.querySelector("#menutable tbody");
  const filterCategory = document.getElementById("filterCategory");

  if (!tbody || !filterCategory) return;

  function bindRowButtons() {
    tbody.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;

        // Bawal tanggalin ang Product Menu entry kung naka-assign pa ito
        // sa isa o higit pang empleyado. Direkta itong tinitingnan sa
        // "products" collection (hindi lang sa "assigned" flag ng
        // productMenu doc) para sigurado — ito rin ang parehong source
        // of truth na ginagamit sa product.js pag-uunassign.
        const assignedQuery = query(
          collection(db, "products"),
          where("inventoryId", "==", id),
        );
        const assignedSnap = await getDocs(assignedQuery);
        if (!assignedSnap.empty) {
          M.toast({
            html: "Cannot delete: this product is still assigned to employee(s). Unassign it first.",
            classes: "red rounded",
          });
          return;
        }

        const confirmed = await confirmDeletion(
          "Delete Product?",
          "This product menu entry will be permanently deleted.",
        );
        if (!confirmed) return;

        try {
          // Tandaan: hindi binabawasan ng addproductmenu() ang linked
          // inventory doc pag-Save, kaya walang dapat i-restore pag-Delete
          // — burahin lang natin ang productMenu doc mismo.
          await deleteDoc(doc(db, "productMenu", id));
          M.toast({
            html: "Product menu entry deleted.",
            classes: "green rounded",
          });
        } catch (err) {
          console.error("Delete error:", err);
          M.toast({
            html: "Failed to delete product.",
            classes: "red rounded",
          });
        }
      };
    });

    tbody.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.id;

        const menuRef = doc(db, "productMenu", id);
        const menuSnap = await getDoc(menuRef);
        if (!menuSnap.exists()) return;

        const data = menuSnap.data();

        document.getElementById("edit-menu-name").value =
          data.product_name || "";
        document.getElementById("edit-menu-stock").value =
          data.current_stock ?? "";
        document.getElementById("edit-menu-price").value = data.price ?? "";
        M.updateTextFields();

        const modalElem = document.getElementById("modal-edit-menu");
        if (!modalElem) return;

        let modalInstance = M.Modal.getInstance(modalElem);
        if (!modalInstance) {
          modalInstance = M.Modal.init(modalElem);
        }
        modalInstance.open();

        const saveBtn = document.getElementById("edit-menu-save");
        saveBtn.onclick = async () => {
          const newName = document
            .getElementById("edit-menu-name")
            .value.trim()
            .toUpperCase();
          const newStock = Number(
            document.getElementById("edit-menu-stock").value,
          );
          const newPrice = Number(
            document.getElementById("edit-menu-price").value,
          );

          if (!newName || newStock < 0 || newPrice < 0) {
            M.toast({
              html: "Please enter valid values.",
              classes: "red rounded",
            });
            return;
          }

          try {
            await updateDoc(menuRef, {
              product_name: newName,
              current_stock: newStock,
              price: newPrice,
              last_updated: serverTimestamp(),
            });

            M.toast({
              html: "Product menu updated!",
              classes: "green rounded",
            });
            modalInstance.close();
          } catch (err) {
            console.error("Update error:", err);
            M.toast({
              html: "Failed to update product.",
              classes: "red rounded",
            });
          }
        };
      };
    });
  }

  function renderMenu() {
    // Stop previous listener
    if (unsubscribeMenu) {
      unsubscribeMenu();
    }

    const selectedCategory = filterCategory.value;

    let q = collection(db, "productMenu");

    if (selectedCategory) {
      // Match the exact category AND anything marked "ALL" (Shared
      // Across All Roles) — shared items are meant to show up under
      // every specific category filter, not just under "All
      // Categories". Firestore's "in" operator lets us match either
      // value in a single query without needing a composite index.
      q = query(
        collection(db, "productMenu"),
        where("category", "in", [selectedCategory, "ALL"]),
      );
    }
    // When selectedCategory is "" (All Categories), leave q unfiltered —
    // that already returns every entry, "ALL"-tagged or not.

    unsubscribeMenu = onSnapshot(q, (snapshot) => {
      if (!tbody.isConnected) return;

      tbody.innerHTML = "";

      snapshot.forEach((docSnap) => {
        const data = docSnap.data();

        const tr = document.createElement("tr");

        tr.innerHTML = `
    <td data-label="Product Code">${data.product_code}</td>
    <td data-label="Inventory Name">${data.inventory_name}</td>
    <td data-label="Product Name">${data.product_name}</td>
    <td data-label="Category">${data.category}</td>
    <td data-label="Stock">${data.current_stock}</td>
    <td data-label="Unit">${data.unit ? data.unit.toUpperCase() : "-"}</td>
    <td data-label="Price">₱${Number(data.price).toFixed(2)}</td>
    <td data-label="Action">
              <button class="edit-btn btn blue" data-id="${docSnap.id}">
                <i class="material-icons">edit</i>
              </button>
              <button class="delete-btn btn red" data-id="${docSnap.id}">
                <i class="material-icons">delete</i>
              </button>
            </td>
`;

        tbody.appendChild(tr);
      });

      bindRowButtons();
    });
  }

  // Initial load
  renderMenu();

  // Reload kapag nag-filter
  filterCategory.addEventListener("change", renderMenu);
}

// Call this BEFORE navigating away from productMenu.html
export function cleanupProductMenuPage() {
  if (unsubscribeInventoryOptions) {
    unsubscribeInventoryOptions();
    unsubscribeInventoryOptions = null;
  }
  if (unsubscribeProductIdPreview) {
    unsubscribeProductIdPreview();
    unsubscribeProductIdPreview = null;
  }
  if (unsubscribeMenu) {
    unsubscribeMenu();
    unsubscribeMenu = null;
  }
}

//export function to functionalnav.js
export async function initProductPage() {
  loadInventoryOptions();
  loadroles();
  loadCategoryFilter();
  previewNextProductId();
  addproductmenu();
  loadmenu();
  initUppercaseProductName();
  bindInventoryAllocationChange();
}