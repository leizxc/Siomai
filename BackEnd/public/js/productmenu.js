import { db, isManagerAccount } from "/js/firebase.js";
import {
  collection,
  updateDoc,
  doc,
  serverTimestamp,
  onSnapshot,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubscribeInventoryOptions = null;
let unsubscribeProductIdPreview = null;
let unsubscribeMenu = null;

function setProductMenuButtonBusy(button, busy, busyText) {
  if (!button) return;
  button.disabled = busy || button.classList.contains("manager-write-locked");
  button.setAttribute("aria-busy", String(busy));
  const progressText = button.querySelector(".product-menu-submit-progress");
  if (progressText && busyText) {
    const spinner = progressText.querySelector(".account-loading-spinner");
    progressText.replaceChildren(spinner || document.createElement("span"), document.createTextNode(busyText));
  }
}

export async function refresh() {
  const form = document.getElementById("addProductMenu");
  if (form) form.reset();

  const previewImg = document.getElementById("previewImage");
  if (previewImg) previewImg.src = "/assets/upload-placeholder.png";

  hideAllDynamicFields();
  resetAllDynamicValues();
  M.updateTextFields();

  reinitSelect(document.getElementById("employeeINV"));
  reinitSelect(document.getElementById("selectCategory"));

  previewNextProductId();
}

function hideAllDynamicFields() {
  const piecesUsedField = document.getElementById("pieces-used-field");
  const packsUsedField = document.getElementById("packs-used-field");
  const kgUsedField = document.getElementById("kg-used-field");
  const kalderoCountField = document.getElementById("kaldero-count-field");

  if (piecesUsedField) piecesUsedField.style.display = "none";
  if (packsUsedField) packsUsedField.style.display = "none";
  if (kgUsedField) kgUsedField.style.display = "none";
  if (kalderoCountField) kalderoCountField.style.display = "none";
}

function resetAllDynamicValues() {
  const piecesUsedInput = document.getElementById("piecesUsed");
  const packsUsedInput = document.getElementById("packsUsed");
  const kgUsedInput = document.getElementById("KgUsed");
  const kalderoCountInput = document.getElementById("kalderocCount");

  if (piecesUsedInput) piecesUsedInput.value = "";
  if (packsUsedInput) packsUsedInput.value = "";
  if (kgUsedInput) kgUsedInput.value = "";
  if (kgUsedInput) kgUsedInput.removeAttribute("max");
  if (packsUsedInput) packsUsedInput.removeAttribute("max");
  if (kalderoCountInput) kalderoCountInput.value = "";
}

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

  return `QC-${String(nextNumber).padStart(6, "0")}`;
}

function reinitSelect(selectEl) {
  if (!selectEl || !selectEl.isConnected) return;
  const instance = M.FormSelect.getInstance(selectEl);
  if (instance) instance.destroy();
  M.FormSelect.init(selectEl);
}

function buildPackQuantityFields(inventory, stock) {
  const unit = (inventory.unit_type || "").toLowerCase();
  const isPack = unit === "pack";

  if (!isPack) {
    return {
      stock_quantity: stock,
      pieces_per_pack: null,
      current_pieces: null,
      current_packs: null,
      initial_pieces: null,
      initial_packs: null,
    };
  }

  const piecesPerPack =
    Number(inventory.quantity) > 0
      ? Number(inventory.stock_quantity) / Number(inventory.quantity)
      : 1;

  return {
    stock_quantity: stock,
    pieces_per_pack: piecesPerPack,
    current_pieces: stock,
    current_packs: Math.ceil(stock / piecesPerPack),
    initial_pieces: stock,
    initial_packs: Math.ceil(stock / piecesPerPack),
  };
}

function buildCurrentQuantityFields(menuData, pieces) {
  const isPack = menuData.unit === "pack";
  const piecesPerPack = Number(menuData.pieces_per_pack) || 1;

  return {
    current_stock: pieces,
    current_pieces: pieces,
    current_packs: isPack ? Math.ceil(pieces / piecesPerPack) : null,
  };
}

function formatQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return "-";
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}

export function loadInventoryOptions(role = "") {
  const select = document.getElementById("employeeINV");
  if (!select) return;

  if (unsubscribeInventoryOptions) unsubscribeInventoryOptions();

  let q = collection(db, "inventory");
  if (role) {
    q = query(collection(db, "inventory"), where("role", "==", role));
  }

  unsubscribeInventoryOptions = onSnapshot(q, (snapshot) => {
    if (!select.isConnected) return;

    select.innerHTML = `<option value="" disabled selected>Inventory Allocation</option>`;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (Number(data.quantity ?? 0) <= 0) return;

      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = data.product_name;
      select.appendChild(option);
    });

    reinitSelect(select);
  });
}

function bindInventoryAllocationChange() {
  const select = document.getElementById("employeeINV");
  const stockUnit = document.getElementById("stockUnit");
  if (!select || !stockUnit) return;
  let selectedInventory = null;

  const updateInventoryQuantity = () => {
    if (!selectedInventory) return;
    const { data, unit } = selectedInventory;
    const quantity = Number(data.quantity ?? data.stock_quantity ?? 0);
    let label = `${formatQuantity(quantity)} ${(unit || "units").toUpperCase()}`;
    if (unit === "pack") label = `${formatQuantity(quantity)} PACKS = ${formatQuantity(data.stock_quantity)} PCS`;
    else if (unit === "kaban") label = `${formatQuantity(quantity)} KABAN = ${formatQuantity(data.stock_quantity)} KG`;
    else if (unit === "kg" || unit === "kilogram") label = `${formatQuantity(quantity)} KG`;
    else if (unit === "liter") label = `${formatQuantity(quantity)} LITER`;
    stockUnit.value = label;
    M.updateTextFields();
  };

  select.onchange = async (e) => {
    const inventoryId = e.target.value;
    if (!inventoryId) return;
    const inventorySnap = await getDoc(doc(db, "inventory", inventoryId));
    if (!inventorySnap.exists()) return;

    const data = inventorySnap.data();
    const unit = (data.unit_type || "").toLowerCase();
    selectedInventory = { data, unit };
    hideAllDynamicFields();
    resetAllDynamicValues();

    const packsUsedInput = document.getElementById("packsUsed");
    const kgUsedInput = document.getElementById("KgUsed");
    if (packsUsedInput && (unit === "pack" || unit === "packs")) packsUsedInput.max = Number(data.quantity || 0);
    if (kgUsedInput && ["kaban", "kilogram", "kg"].includes(unit)) kgUsedInput.max = Number(data.stock_quantity ?? data.quantity ?? 0);

    const packsUsedField = document.getElementById("packs-used-field");
    const kgUsedField = document.getElementById("kg-used-field");
    const kalderoCountField = document.getElementById("kaldero-count-field");
    const kgLabel = document.getElementById("kg-used-label");
    const kalderoLabel = document.getElementById("kaldero-label");
    if (unit === "pack") {
      if (packsUsedField) packsUsedField.style.display = "block";
      const label = document.querySelector('label[for="packsUsed"]');
      if (label) label.textContent = "Siomai Packs Used";
    } else if (unit === "packs") {
      if (packsUsedField) packsUsedField.style.display = "block";
      const label = document.querySelector('label[for="packsUsed"]');
      if (label) label.textContent = "Palamig Packs Used";
      if (kalderoCountField) kalderoCountField.style.display = "block";
      if (kalderoLabel) kalderoLabel.textContent = "Number of Container Reached";
    } else if (unit === "kaban" || unit === "kilogram") {
      if (kgUsedField) kgUsedField.style.display = "block";
      if (kalderoCountField) kalderoCountField.style.display = "block";
      if (kgLabel) kgLabel.textContent = "Kilograms Used";
      if (kalderoLabel) kalderoLabel.textContent = "Number of Container Reached";
    } else if (unit === "kg") {
      if (kgUsedField) kgUsedField.style.display = "block";
      if (kgLabel) kgLabel.textContent = "Kilograms per Product";
    }
    updateInventoryQuantity();
  };
}
export async function loadroles() {
  const roleSelect = document.getElementById("selectCategory");
  if (!roleSelect) return;

  const managerAccount = await isManagerAccount();
  const snap = await getDocs(collection(db, "employees"));
  const roles = new Set();

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (
      data.role &&
      !(managerAccount && data.role.trim().toLowerCase() === "manager")
    ) roles.add(data.role.trim());
  });

  roleSelect.innerHTML = `<option value="" disabled selected>Select Role</option>`;

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

function previewNextProductId() {
  const productIdInput = document.getElementById("productId");
  if (!productIdInput) return;

  if (unsubscribeProductIdPreview) unsubscribeProductIdPreview();

  const counterRef = doc(db, "counters", "productCode");

  unsubscribeProductIdPreview = onSnapshot(counterRef, (snap) => {
    if (!productIdInput.isConnected) return;
    const current = snap.exists() ? snap.data().lastNumber || 0 : 0;
    const next = current + 1;
    productIdInput.value = `QC-${String(next).padStart(6, "0")}`;
  });
}

async function uploadProductImage() {
  const fileInput = document.getElementById("inputImg");
  const file = fileInput.files[0];
  if (!file) return "";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", "Queen_Cassy_Product_Menu");

  const response = await fetch(
    "https://api.cloudinary.com/v1_1/ht5i99mv/image/upload",
    { method: "POST", body: formData },
  );

  if (!response.ok) {
    const error = await response.json();
    console.error(error);
    throw new Error("Image upload failed.");
  }

  const data = await response.json();
  return data.secure_url;
}

export function addproductmenu() {
  const form = document.getElementById("addProductMenu");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.dataset.submitting === "true") return;
    form.dataset.submitting = "true";

    const saveBtn = document.getElementById("save-menu");

    try {
      const inventoryId = document.getElementById("employeeINV").value;
      const productName = document
        .getElementById("inputProduct")
        .value.trim()
        .toUpperCase();
      const role = document.getElementById("selectCategory").value;
      const price = Number(document.getElementById("price").value);

      if (!inventoryId || !productName || !role) {
        M.toast({
          html: "Please complete all fields.",
          classes: "red rounded",
        });
        return;
      }

      if (price <= 0) {
        M.toast({
          html: "Please enter a valid price.",
          classes: "red rounded",
        });
        return;
      }

      setProductMenuButtonBusy(saveBtn, true, "Saving...");

      const inventorySnap = await getDoc(doc(db, "inventory", inventoryId));
      if (!inventorySnap.exists()) {
        M.toast({ html: "Inventory not found.", classes: "red rounded" });
        return;
      }

      const inventory = inventorySnap.data();
      const unit = (inventory.unit_type || "").toLowerCase();
      let stock = Number(inventory.stock_quantity ?? inventory.quantity ?? 0);
      if (unit === "pack") {
        const packs = Number(document.getElementById("packsUsed").value);
        const piecesPerPack = Number(inventory.quantity) > 0
          ? Number(inventory.stock_quantity) / Number(inventory.quantity)
          : 1;
        stock = packs * piecesPerPack;
      } else if (unit === "packs") {
        stock = Number(document.getElementById("packsUsed").value);
      } else if (["kaban", "kilogram", "kg"].includes(unit)) {
        stock = Number(document.getElementById("KgUsed").value);
      } else if (unit === "liter") {
        stock = Number(inventory.quantity ?? inventory.stock_quantity ?? 0);
      }
      if (!(stock > 0)) {
        M.toast({ html: "Please enter a valid quantity.", classes: "red rounded" });
        return;
      }

      let piecesUsed = null;
      let packsUsed = null;
      let kgUsed = null;
      let kalderoCount = null;

      if (unit === "pack") {
        packsUsed = Number(document.getElementById("packsUsed").value);
        if (!(packsUsed > 0) || packsUsed > Number(inventory.quantity || 0)) {
          M.toast({
            html: "Enter a valid number of Siomai packs within available stock.",
            classes: "red rounded",
          });
          return;
        }
      } else if (unit === "packs") {
        packsUsed = Number(document.getElementById("packsUsed").value);
        kalderoCount = Number(document.getElementById("kalderocCount").value);
        if (!(packsUsed > 0) || packsUsed > Number(inventory.quantity || 0) || !(kalderoCount > 0)) {
          M.toast({
            html: "Please complete all fields.",
            classes: "red rounded",
          });
          return;
        }
      } else if (unit === "kaban" || unit === "kilogram") {
        kgUsed = Number(document.getElementById("KgUsed").value);
        kalderoCount = Number(document.getElementById("kalderocCount").value);
        if (!(kgUsed > 0) || kgUsed > Number(inventory.stock_quantity || 0) || !(kalderoCount > 0)) {
          M.toast({
            html: "Please complete all fields.",
            classes: "red rounded",
          });
          return;
        }
      } else if (unit === "kg") {
        kgUsed = Number(document.getElementById("KgUsed").value);
        if (!(kgUsed > 0) || kgUsed > Number(inventory.quantity || 0)) {
          M.toast({ html: "Please enter Kilograms per Product.", classes: "red rounded" });
          return;
        }
      }
      // LITER: walang required extra fields (reverted to original simple behavior).

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

      const productCode = await generateProductCode();
      const imageURL = await uploadProductImage();
      const productRef = doc(collection(db, "productMenu"));
      await runTransaction(db, async (transaction) => {
        const currentInventorySnap = await transaction.get(
          doc(db, "inventory", inventoryId),
        );
        if (!currentInventorySnap.exists()) throw new Error("Inventory not found.");

        const currentInventory = currentInventorySnap.data();
        const availableQuantity = Number(currentInventory.quantity ?? 0);
        const availableStock = Number(
          currentInventory.stock_quantity ?? currentInventory.quantity ?? 0,
        );
        let quantityUsed = availableQuantity;
        let inventoryStockUsed = availableStock;
        let menuStock = stock;

        if (unit === "pack") {
          const piecesPerPack = availableQuantity > 0
            ? availableStock / availableQuantity
            : 1;
          quantityUsed = packsUsed;
          inventoryStockUsed = packsUsed * piecesPerPack;
          menuStock = inventoryStockUsed;
        } else if (unit === "packs") {
          quantityUsed = packsUsed;
          inventoryStockUsed = packsUsed;
          menuStock = packsUsed;
        } else if (unit === "kaban") {
          const weightPerKaban = Number(currentInventory.weight_per_kaban || 0);
          inventoryStockUsed = kgUsed;
          quantityUsed = weightPerKaban > 0 ? kgUsed / weightPerKaban : 0;
          menuStock = kgUsed;
        } else if (unit === "kilogram" || unit === "kg") {
          quantityUsed = kgUsed;
          inventoryStockUsed = kgUsed;
          menuStock = kgUsed;
        }

        if (
          !(quantityUsed > 0) ||
          quantityUsed > availableQuantity ||
          inventoryStockUsed > availableStock ||
          !(menuStock > 0)
        ) {
          throw new Error("Inventory quantity changed or is insufficient. Refresh and try again.");
        }

        const remainingQuantity = Math.max(0, availableQuantity - quantityUsed);
        const remainingStock = Math.max(0, availableStock - inventoryStockUsed);
        const unitPrice = Number(currentInventory.unit_price || 0);
        const remainingValue = unit === "kaban"
          ? remainingQuantity * unitPrice
          : remainingStock * unitPrice;
        transaction.update(doc(db, "inventory", inventoryId), {
          quantity: remainingQuantity,
          stock_quantity: remainingStock,
          total_value: remainingValue,
          status: remainingQuantity > 0 ? "Available" : "Out of Stock",
          last_updated: serverTimestamp(),
        });

        const quantityFields = buildPackQuantityFields(currentInventory, menuStock);
        transaction.set(productRef, {
          product_code: productCode,
          product_name: productName,
          pieces_used: piecesUsed,
          packs_used: packsUsed,
          kg_used: kgUsed,
          kaldero_count: kalderoCount,
          category: role,
          inv_category:
            currentInventory.inv_category || currentInventory.category || "Uncategorized",
          inventory_id: inventoryId,
          inventory_name: currentInventory.product_name,
          initial_stock: menuStock,
          product_stock_limit: menuStock,
          current_stock: menuStock,
          ...quantityFields,
          unit: currentInventory.unit_type,
          weight_per_kaban: Number(currentInventory.weight_per_kaban || 0),
          price,
          image_url: imageURL,
          status: "Available",
          created_at: serverTimestamp(),
        });
      });

      M.toast({ html: "Product Menu Saved!", classes: "green rounded" });
      form.reset();
      refresh();
    } catch (error) {
      console.error(error);
      M.toast({
        html: error.message || "Error saving product.",
        classes: "red rounded",
      });
    } finally {
      setProductMenuButtonBusy(saveBtn, false);
      delete form.dataset.submitting;
    }
  });
}

function initUppercaseProductName() {
  const input = document.getElementById("inputProduct");
  if (!input) return;
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase();
  });
}

function syncCategoryFilter(menuDocs) {
  const select = document.getElementById("filterCategory");
  if (!select) return;

  const categories = new Set();
  menuDocs.forEach(({ data }) => {
    const category = String(data.inv_category || data.category || "").trim();
    if (category) categories.add(category);
  });

  const previousValue = select.value;
  select.innerHTML = "";
  if (categories.size === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No categories yet";
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
  } else {
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      select.appendChild(option);
    });
    select.value = categories.has(previousValue)
      ? previousValue
      : select.options[0].value;
  }

  reinitSelect(select);
  select.dispatchEvent(new Event("change"));
}

function confirmDeletion(title, message) {
  const modalElement = document.getElementById("modal-delete-category");
  if (!modalElement) return Promise.resolve(window.confirm(message));

  const confirmButton = document.getElementById("confirm-delete-category");
  const cancelButton = document.getElementById("cancel-delete-category");
  const modalInstance = M.Modal.getInstance(modalElement);
  const titleElement = document.getElementById("delete-confirmation-title");
  const messageElement = document.getElementById("delete-confirmation-message");

  if (modalInstance) {
    if (modalInstance.isOpen) modalInstance.close();
    modalInstance.destroy();
  }
  const activeModal = M.Modal.init(modalElement, { dismissible: false });
  titleElement.textContent = title;
  messageElement.textContent = message;

  return new Promise((resolve) => {
    cancelButton.onclick = () => {
      activeModal.close();
      resolve(false);
    };
    confirmButton.onclick = () => {
      setProductMenuButtonBusy(confirmButton, true, "Deleting...");
      resolve(true);
    };
    activeModal.open();
  });
}

export async function loadmenu() {
  const tbody = document.querySelector("#menutable tbody");
  const filterCategory = document.getElementById("filterCategory");
  const searchInput = document.getElementById("searchProductMenu");
  const clearBtn = document.getElementById("clearSearchBtn");

  if (!tbody || !filterCategory) return;

  const PAGE_SIZE = 10;
  let currentPage = 1;
  let allMenuData = [];
  let searchTimeout = null;

  function bindRowButtons() {
    tbody.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.onclick = async () => {
        if (btn.dataset.submitting === "true") return;
        btn.dataset.submitting = "true";
        const id = btn.dataset.id;
        setProductMenuButtonBusy(btn, true, "Checking...");
        try {
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

          setProductMenuButtonBusy(document.getElementById("confirm-delete-category"), true, "Deleting...");
          await runTransaction(db, async (transaction) => {
            const menuRef = doc(db, "productMenu", id);
            const menuSnap = await transaction.get(menuRef);
            if (!menuSnap.exists()) throw new Error("Product menu item not found.");

            const menu = menuSnap.data();
            const inventoryId = menu.inventory_id;
            let inventoryRef = null;
            let inventory = null;
            if (inventoryId) {
              inventoryRef = doc(db, "inventory", inventoryId);
              const inventorySnap = await transaction.get(inventoryRef);
              if (!inventorySnap.exists()) {
                throw new Error("Linked inventory was not found. Product menu was not deleted.");
              }
              inventory = inventorySnap.data();
            }

            if (inventory) {
              const unit = String(menu.unit || inventory.unit_type || "").toLowerCase();
              const remainingMenuStock = Math.max(
                0,
                Number(menu.current_stock ?? menu.current_pieces ?? menu.initial_stock ?? 0),
              );
              let quantityToRestore = remainingMenuStock;
              let stockToRestore = remainingMenuStock;

              if (unit === "pack") {
                const piecesPerPack =
                  Number(menu.pieces_per_pack) ||
                  (Number(inventory.quantity) > 0
                    ? Number(inventory.stock_quantity) / Number(inventory.quantity)
                    : 1);
                quantityToRestore = remainingMenuStock / piecesPerPack;
              } else if (unit === "kaban") {
                const weightPerKaban = Number(
                  menu.weight_per_kaban || inventory.weight_per_kaban || 0,
                );
                if (!(weightPerKaban > 0)) {
                  throw new Error("Missing weight per kaban. Product menu was not deleted.");
                }
                quantityToRestore = remainingMenuStock / weightPerKaban;
              }

              const restoredQuantity = Number(inventory.quantity || 0) + quantityToRestore;
              const restoredStock = Number(
                inventory.stock_quantity ?? inventory.quantity ?? 0,
              ) + stockToRestore;
              const unitPrice = Number(inventory.unit_price || 0);
              const unitValue = unit === "kaban"
                ? restoredQuantity * unitPrice
                : restoredStock * unitPrice;
              transaction.update(inventoryRef, {
                quantity: restoredQuantity,
                stock_quantity: restoredStock,
                total_value: unitValue,
                status: "Available",
                last_updated: serverTimestamp(),
              });
            }

            transaction.delete(menuRef);
          });
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
        } finally {
          setProductMenuButtonBusy(document.getElementById("confirm-delete-category"), false);
          const deleteModal = M.Modal.getInstance(document.getElementById("modal-delete-category"));
          if (deleteModal?.isOpen) deleteModal.close();
          deleteModal?.destroy();
          if (btn.isConnected) {
            delete btn.dataset.submitting;
            setProductMenuButtonBusy(btn, false);
          }
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
        document.getElementById("edit-menu-price").value = data.price ?? "";
        const isLechonMenu = /let?chon/i.test(data.product_name || "");
        const lechonPricesPanel = document.getElementById("edit-menu-lechon-prices");
        if (lechonPricesPanel) lechonPricesPanel.hidden = !isLechonMenu;
        if (isLechonMenu) {
          document.getElementById("edit-menu-lechon-quarter").value = data.lechonPrices?.quarter ?? data.lechonPrices?.["1/4 kg"] ?? 250;
          document.getElementById("edit-menu-lechon-half").value = data.lechonPrices?.half ?? data.lechonPrices?.["1/2 kg"] ?? 500;
          document.getElementById("edit-menu-lechon-one").value = data.lechonPrices?.one ?? data.lechonPrices?.["1 kg"] ?? 900;
        }
        M.updateTextFields();

        const modalElem = document.getElementById("modal-edit-menu");
        if (!modalElem) return;

        let modalInstance = M.Modal.getInstance(modalElem);
        if (!modalInstance) modalInstance = M.Modal.init(modalElem);
        modalInstance.open();

        const saveBtn = document.getElementById("edit-menu-save");
        saveBtn.onclick = async () => {
          if (saveBtn.dataset.submitting === "true") return;
          const newName = document
            .getElementById("edit-menu-name")
            .value.trim()
            .toUpperCase();
          const newPrice = Number(
            document.getElementById("edit-menu-price").value,
          );

          if (!newName || !Number.isFinite(newPrice) || newPrice < 0) {
            M.toast({
              html: "Please enter valid values.",
              classes: "red rounded",
            });
            return;
          }

          let lechonPrices = null;
          if (isLechonMenu) {
            lechonPrices = {
              quarter: Number(document.getElementById("edit-menu-lechon-quarter").value),
              half: Number(document.getElementById("edit-menu-lechon-half").value),
              one: Number(document.getElementById("edit-menu-lechon-one").value),
            };
            if (Object.values(lechonPrices).some((price) => !Number.isFinite(price) || price < 0)) {
              M.toast({ html: "Please enter valid prices for all lechon sizes.", classes: "red rounded" });
              return;
            }
          }

          saveBtn.dataset.submitting = "true";
          setProductMenuButtonBusy(saveBtn, true, "Updating...");
          try {
            const menuUpdate = {
              product_name: newName,
              price: newPrice,
              last_updated: serverTimestamp(),
            };
            if (lechonPrices) menuUpdate.lechonPrices = lechonPrices;
            await updateDoc(menuRef, menuUpdate);

            const assignedProducts = await getDocs(query(
              collection(db, "products"),
              where("inventoryId", "==", id),
            ));
            const assignedUpdate = {
              price: newPrice,
              capital_price: newPrice,
              ...(lechonPrices ? { lechonPrices } : {}),
              last_updated: serverTimestamp(),
            };
            await Promise.all(assignedProducts.docs.map((productSnap) =>
              updateDoc(doc(db, "products", productSnap.id), assignedUpdate),
            ));
            M.toast({
              html: "Product menu and assigned product prices updated!",
              classes: "green rounded",
            });
            modalInstance.close();
          } catch (err) {
            console.error("Update error:", err);
            M.toast({
              html: "Failed to update product.",
              classes: "red rounded",
            });
          } finally {
            delete saveBtn.dataset.submitting;
            setProductMenuButtonBusy(saveBtn, false);
          }
        };
      };
    });
  }

  function getFilteredData() {
    const searchTerm = searchInput
      ? searchInput.value.toLowerCase().trim()
      : "";
    const selectedCategory = filterCategory.value;

    let filteredData = allMenuData;

    if (
      selectedCategory &&
      selectedCategory !== "ALL" &&
      selectedCategory !== ""
    ) {
      filteredData = filteredData.filter(
        (item) => item.data.inv_category === selectedCategory,
      );
    }

    if (searchTerm) {
      filteredData = filteredData.filter((item) => {
        const productCode = (item.data.product_code || "").toLowerCase();
        const productName = (item.data.product_name || "").toLowerCase();
        const inventoryName = (item.data.inventory_name || "").toLowerCase();
        const invCategory = (item.data.inv_category || "").toLowerCase();
        const category = (item.data.category || "").toLowerCase();
        const inventoryId = (item.inventoryProductId || "").toLowerCase();

        return (
          productCode.includes(searchTerm) ||
          productName.includes(searchTerm) ||
          inventoryName.includes(searchTerm) ||
          invCategory.includes(searchTerm) ||
          category.includes(searchTerm) ||
          inventoryId.includes(searchTerm)
        );
      });
    }

    return filteredData;
  }

  function updateMenuTableHeaders(filteredData) {
    const thAvailableStock = document.getElementById("th-available-stock");
    const thPacks = document.getElementById("th-packs");
    const thPieces = document.getElementById("th-pieces");
    const thContainer = document.getElementById("th-container");
    const thKgUsed = document.getElementById("th-kg-used");
    if (!thPacks || !thPieces || !thContainer) return;

    const sampleUnit = (filteredData[0]?.data.unit || "").toLowerCase();

    if (sampleUnit === "pack") {
      if (thAvailableStock) thAvailableStock.style.display = "none";
      thPacks.style.display = "none";
      thPieces.style.display = "";
      thContainer.style.display = "none";
      if (thKgUsed) thKgUsed.style.display = "none";
      thPacks.textContent = "Packs";
      thPieces.textContent = "Packs Used";
    } else if (sampleUnit === "packs") {
      if (thAvailableStock) thAvailableStock.style.display = "";
      thPacks.style.display = "";
      thPieces.style.display = "none";
      thContainer.style.display = "";
      if (thKgUsed) thKgUsed.style.display = "none";
      thPacks.textContent = "Packs Used";
      thContainer.textContent = "Container";
    } else if (
      sampleUnit === "kaban" ||
      sampleUnit === "kilogram"
    ) {
      if (thAvailableStock) thAvailableStock.style.display = "";
      thPacks.style.display = "none";
      thPieces.style.display = "none";
      thContainer.style.display = "";
      thContainer.textContent = "Container";
      if (thKgUsed) {
        thKgUsed.style.display = "";
        thKgUsed.textContent = "KG Used";
      }
    } else if (sampleUnit === "kg") {
      if (thAvailableStock) thAvailableStock.style.display = "";
      thPacks.style.display = "none";
      thPieces.style.display = "none";
      thContainer.style.display = "none";
      if (thKgUsed) {
        thKgUsed.style.display = "";
        thKgUsed.textContent = "KG per Product";
      }
    } else if (sampleUnit === "liter") {
      if (thAvailableStock) thAvailableStock.style.display = "";
      thPacks.style.display = "none";
      thPieces.style.display = "none";
      thContainer.style.display = "none";
      if (thKgUsed) thKgUsed.style.display = "none";
    } else {
      thPacks.style.display = "none";
      thPieces.style.display = "none";
      thContainer.style.display = "none";
      if (thKgUsed) thKgUsed.style.display = "none";
    }
  }

  function renderMenuPage() {
    const filteredData = getFilteredData();
    updateMenuTableHeaders(filteredData);

    const totalRecords = filteredData.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = filteredData.slice(start, start + PAGE_SIZE);

    let rowsHtml = "";
    for (const item of pageData) {
      rowsHtml += item.html;
    }

    if (!rowsHtml) {
      const searchTerm = searchInput ? searchInput.value : "";
      rowsHtml = `
        <tr>
          <td colspan="10" class="center-align grey-text" style="padding: 30px 0;">
            <i class="material-icons" style="font-size: 48px; display: block; margin-bottom: 10px;">search</i>
            ${searchTerm ? `No products found matching "<strong>${searchTerm}</strong>"` : "No products found in this category."}
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = rowsHtml;
    bindRowButtons();
    updatePaginationControls(totalPages, totalRecords);
  }

  function updatePaginationControls(totalPages, totalRecords) {
    const prevBtn = document.getElementById("menu-prev");
    const nextBtn = document.getElementById("menu-next");
    const pageLabel = document.getElementById("menu-page");
    const infoLabel = document.getElementById("menu-info");

    if (!prevBtn || !nextBtn) return;

    prevBtn.disabled = currentPage === 1;
    nextBtn.disabled = currentPage === totalPages;

    if (pageLabel)
      pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;

    prevBtn.onclick = null;
    nextBtn.onclick = null;

    prevBtn.onclick = () => {
      if (currentPage > 1) {
        currentPage--;
        renderMenuPage();
      }
    };

    nextBtn.onclick = () => {
      if (currentPage < totalPages) {
        currentPage++;
        renderMenuPage();
      }
    };

    if (infoLabel) {
      if (totalRecords === 0) {
        infoLabel.textContent = "Showing: 0 Product Menu records";
      } else {
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, totalRecords);
        infoLabel.textContent = `Showing: ${start} - ${end} of ${totalRecords} Product Menu records`;
      }
    }
  }

  function generateRowHtml(id, data, inventoryProductId) {
    let quantityColumns = "";

    if (data.unit === "pack") {
      quantityColumns = `
        <td data-label="Packs" style="display: none"></td>
        <td data-label="Packs Used">${formatQuantity(data.packs_used)}</td>
      `;
    } else if (data.unit === "packs") {
      quantityColumns = `
        <td data-label="Packs Used">${formatQuantity(data.packs_used)}</td>
        <td data-label="Container">${formatQuantity(data.kaldero_count)}</td>
      `;
    } else if (data.unit === "kaban" || data.unit === "kilogram") {
      quantityColumns = `
        <td data-label="Container">${formatQuantity(data.kaldero_count)}</td>
        <td data-label="KG Used">${formatQuantity(data.kg_used)}</td>
      `;
    } else if (data.unit === "kg") {
      quantityColumns = `<td data-label="KG per Product">${formatQuantity(data.kg_used)}</td>`;
    } else if (data.unit === "liter") {
      quantityColumns = "";
    }
    const currentStock = Number(data.current_stock ?? data.current_pieces ?? 0) || 0;
    const hasAssignedStock =
      data.assigned === true ||
      String(data.status || "").toLowerCase() === "on selling";
    const menuStatus = hasAssignedStock || currentStock <= 0
      ? "On Selling"
      : "Available";
    const statusClass = menuStatus.toLowerCase() === "available" ? "available" : "on-selling";
    const unit = String(data.unit || "").toLowerCase();
    let availableQuantity;
    if (unit === "pack") {
      const piecesPerPack = Number(data.pieces_per_pack) || 1;
      availableQuantity = `${formatQuantity(Math.floor(currentStock / piecesPerPack))} packs`;
    } else if (["packs", "kaban", "kilogram"].includes(unit)) {
      const containers = Number(data.kaldero_count ?? data.container_count ?? 0) || 0;
      availableQuantity = `${formatQuantity(containers)} containers`;
    } else if (unit === "kg") {
      availableQuantity = `${formatQuantity(currentStock)} kg`;
    } else {
      if (thAvailableStock) thAvailableStock.style.display = "";
      availableQuantity = `${formatQuantity(currentStock)} ${data.unit || "units"}`;
    }
    return `
      <tr>
        <td data-label="Product Code"><strong>${data.product_code || "-"}</strong></td>
        <td data-label="Inventory ID">${inventoryProductId}</td>
        <td data-label="Inventory Name">${data.inventory_name || "-"}</td>
        <td data-label="Product Name">${data.product_name || "-"}</td>
        <td data-label="Category">${data.inv_category || data.category || "-"}</td>
        <td data-label="Status"><span class="status ${statusClass}">${menuStatus}</span></td>
        <td data-label="Available Stock"${unit === "pack" ? ' style="display: none"' : ""}>${availableQuantity}</td>
        ${quantityColumns}
        <td data-label="Price">₱${Number(data.price || 0).toFixed(2)}</td>
        <td data-label="Action">
          <button class="edit-btn btn blue waves-effect waves-light" data-id="${id}">
            <i class="material-icons">edit</i>
          </button>
          <button class="delete-btn btn red waves-effect waves-light" data-id="${id}" aria-busy="false">
            <span class="product-menu-submit-label"><i class="material-icons">delete</i></span>
            <span class="product-menu-submit-progress"><span class="account-loading-spinner" aria-hidden="true"></span>Checking...</span>
          </button>
        </td>
      </tr>
    `;
  }

  function renderMenu() {
    if (unsubscribeMenu) unsubscribeMenu();

    let q = collection(db, "productMenu");

    unsubscribeMenu = onSnapshot(q, async (snapshot) => {
      if (!tbody.isConnected) return;

      const menuDocs = [];
      snapshot.forEach((docSnap) => {
        menuDocs.push({ id: docSnap.id, data: docSnap.data() });
      });
      syncCategoryFilter(menuDocs);

      const inventoryIds = new Set();
      menuDocs.forEach(({ data }) => {
        if (data.inventory_id) inventoryIds.add(data.inventory_id);
      });

      const inventoryMap = new Map();
      for (const invId of inventoryIds) {
        try {
          const invRef = doc(db, "inventory", invId);
          const invSnap = await getDoc(invRef);
          if (invSnap.exists()) inventoryMap.set(invId, invSnap.data());
        } catch (err) {
          console.error("Error fetching inventory:", err);
        }
      }

      allMenuData = [];
      for (const { id, data } of menuDocs) {
        let inventoryProductId = "-";
        if (data.inventory_id && inventoryMap.has(data.inventory_id)) {
          const invData = inventoryMap.get(data.inventory_id);
          inventoryProductId = invData.product_id || "-";
        }

        const html = generateRowHtml(id, data, inventoryProductId);
        allMenuData.push({ id, data, inventoryProductId, html });
      }

      currentPage = 1;
      renderMenuPage();
    });
  }

  renderMenu();

  if (searchInput) {
    searchInput.removeEventListener("input", handleSearch);
    searchInput.removeEventListener("keypress", handleKeyPress);
    searchInput.addEventListener("input", handleSearch);
    searchInput.addEventListener("keypress", handleKeyPress);
  }

  function handleSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      currentPage = 1;
      renderMenuPage();
      if (clearBtn)
        clearBtn.style.display = searchInput.value.length > 0 ? "flex" : "none";
    }, 300);
  }

  function handleKeyPress(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (searchTimeout) {
        clearTimeout(searchTimeout);
        searchTimeout = null;
      }
      currentPage = 1;
      renderMenuPage();
      if (clearBtn)
        clearBtn.style.display = searchInput.value.length > 0 ? "flex" : "none";
    }
  }

  if (clearBtn) {
    clearBtn.removeEventListener("click", handleClearSearch);
    clearBtn.addEventListener("click", handleClearSearch);
  }

  function handleClearSearch() {
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
      clearBtn.style.display = "none";
      currentPage = 1;
      renderMenuPage();
    }
  }

  filterCategory.removeEventListener("change", handleCategoryChange);
  filterCategory.addEventListener("change", handleCategoryChange);

  function handleCategoryChange() {
    currentPage = 1;
    renderMenuPage();
  }
}

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

  const prevBtn = document.getElementById("menu-prev");
  const nextBtn = document.getElementById("menu-next");
  if (prevBtn) {
    prevBtn.onclick = null;
    prevBtn.disabled = true;
  }
  if (nextBtn) {
    nextBtn.onclick = null;
    nextBtn.disabled = true;
  }

  const searchInput = document.getElementById("searchProductMenu");
  const clearBtn = document.getElementById("clearSearchBtn");
  if (searchInput) {
    searchInput.oninput = null;
    searchInput.onkeypress = null;
  }
  if (clearBtn) clearBtn.onclick = null;
}

export async function initProductPage() {
  loadInventoryOptions();
  loadroles();

  previewNextProductId();
  addproductmenu();
  loadmenu();
  initUppercaseProductName();
  bindInventoryAllocationChange();

  const infoLabel = document.getElementById("menu-info");
  if (infoLabel) infoLabel.textContent = "Showing: 0 Product Menu records";

  const clearBtn = document.getElementById("clearSearchBtn");
  if (clearBtn) clearBtn.style.display = "none";
}
