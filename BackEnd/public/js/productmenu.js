import { db } from "/js/firebase.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
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

export async function refresh() {
  const form = document.getElementById("addProductMenu");
  if (form) form.reset();

  const previewImg = document.getElementById("previewImage");
  if (previewImg) previewImg.src = "/assets/upload-placeholder.png";

  hideAllDynamicFields();
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
      if (data.status === "On Selling") return;

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
  const stockInput = document.getElementById("stock");
  const stockUnit = document.getElementById("stockUnit");
  const priceInput = document.getElementById("price");
  if (!select || !stockInput) return;

  select.onchange = async (e) => {
    const inventoryId = e.target.value;
    if (!inventoryId) return;

    const inventorySnap = await getDoc(doc(db, "inventory", inventoryId));
    if (!inventorySnap.exists()) return;

    const data = inventorySnap.data();
    const unit = (data.unit_type || "").toLowerCase();

    hideAllDynamicFields();
    resetAllDynamicValues();

    let stock = data.stock_quantity;
    let unitLabel = "";

    if (unit === "pack") {
      unitLabel = `${data.quantity} PACKS = ${data.stock_quantity} PCS`;
    } else if (unit === "packs") {
      stock = data.quantity;
      unitLabel = "PACKS";
    } else if (unit === "kaban") {
      stock = data.stock_quantity;
      unitLabel = `${data.quantity} KABAN = ${data.stock_quantity} KG`;
    } else if (unit === "kg") {
      stock = data.quantity;
      unitLabel = "KG";
    } else if (unit === "liter") {
      stock = data.quantity;
      unitLabel = "LITER";
    } else {
      unitLabel = (unit || "").toUpperCase();
    }

    stockInput.value = stock;
    if (stockUnit) stockUnit.value = unitLabel;

    const piecesUsedField = document.getElementById("pieces-used-field");
    const packsUsedField = document.getElementById("packs-used-field");
    const kgUsedField = document.getElementById("kg-used-field");
    const kalderoCountField = document.getElementById("kaldero-count-field");

    if (unit === "pack") {
      if (packsUsedField) packsUsedField.style.display = "block";
    } else if (unit === "packs") {
      if (packsUsedField) packsUsedField.style.display = "block";
      if (kalderoCountField) kalderoCountField.style.display = "block";
      const kalderoLabel = document.getElementById("kaldero-label");
      if (kalderoLabel)
        kalderoLabel.textContent = "Number of Container Reached";
    } else if (unit === "kaban") {
      if (kgUsedField) kgUsedField.style.display = "block";
      if (kalderoCountField) kalderoCountField.style.display = "block";
      const kgLabel = document.getElementById("kg-used-label");
      if (kgLabel) kgLabel.textContent = "Kilograms Used (Rice)";
      const kalderoLabel = document.getElementById("kaldero-label");
      if (kalderoLabel)
        kalderoLabel.textContent = "Number of Container Reached";
    } else if (unit === "kg") {
      if (kgUsedField) kgUsedField.style.display = "block";
      if (kalderoCountField) kalderoCountField.style.display = "block";
      const kalderoLabel = document.getElementById("kaldero-label");
      if (kalderoLabel)
        kalderoLabel.textContent = "Number of Container Reached";
    } else if (unit === "liter") {
      if (kgUsedField) kgUsedField.style.display = "block";
      if (kalderoCountField) kalderoCountField.style.display = "block";
      const kalderoLabel = document.getElementById("kaldero-label");
      if (kalderoLabel)
        kalderoLabel.textContent = "Number of Container Reached";
    }

    M.updateTextFields();
  };
}

export async function loadroles() {
  const roleSelect = document.getElementById("selectCategory");
  if (!roleSelect) return;

  const snap = await getDocs(collection(db, "employees"));
  const roles = new Set();

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.role) roles.add(data.role.trim());
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

      if (!inventoryId || !productName || !role || stock <= 0) {
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

      if (saveBtn) saveBtn.disabled = true;

      const inventorySnap = await getDoc(doc(db, "inventory", inventoryId));
      if (!inventorySnap.exists()) {
        M.toast({ html: "Inventory not found.", classes: "red rounded" });
        return;
      }

      const inventory = inventorySnap.data();
      const unit = (inventory.unit_type || "").toLowerCase();

      let piecesUsed = null;
      let packsUsed = null;
      let kgUsed = null;
      let kalderoCount = null;

      if (unit === "pack") {
        packsUsed = Number(document.getElementById("packsUsed").value);
        if (packsUsed <= 0) {
          M.toast({ html: "Please enter Packs Used.", classes: "red rounded" });
          return;
        }
      } else if (unit === "packs") {
        packsUsed = Number(document.getElementById("packsUsed").value);
        kalderoCount = Number(document.getElementById("kalderocCount").value);
        if (packsUsed <= 0 || kalderoCount <= 0) {
          M.toast({
            html: "Please complete all fields.",
            classes: "red rounded",
          });
          return;
        }
      } else if (unit === "kaban") {
        kgUsed = Number(document.getElementById("KgUsed").value);
        kalderoCount = Number(document.getElementById("kalderocCount").value);
        if (kgUsed <= 0 || kalderoCount <= 0) {
          M.toast({
            html: "Please complete all fields.",
            classes: "red rounded",
          });
          return;
        }
      } else if (unit === "kg") {
        kgUsed = Number(document.getElementById("KgUsed").value);
        kalderoCount = Number(document.getElementById("kalderocCount").value);
        if (kgUsed <= 0 || kalderoCount <= 0) {
          M.toast({
            html: "Please complete all fields.",
            classes: "red rounded",
          });
          return;
        }
      } else if (unit === "liter") {
        kgUsed = Number(document.getElementById("KgUsed").value);
        kalderoCount = Number(document.getElementById("kalderocCount").value);
        if (kgUsed <= 0 || kalderoCount <= 0) {
          M.toast({
            html: "Please complete all fields.",
            classes: "red rounded",
          });
          return;
        }
      }

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
      const quantityFields = buildPackQuantityFields(inventory, stock);

      await addDoc(collection(db, "productMenu"), {
        product_code: productCode,
        product_name: productName,
        pieces_used: piecesUsed,
        packs_used: packsUsed,
        kg_used: kgUsed,
        kaldero_count: kalderoCount,
        category: role,
        inv_category:
          inventory.inv_category || inventory.category || "Uncategorized",
        inventory_id: inventoryId,
        inventory_name: inventory.product_name,
        initial_stock: stock,
        current_stock: stock,
        ...quantityFields,
        unit: inventory.unit_type,
        weight_per_kaban: Number(inventory.weight_per_kaban || 0),
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
      M.toast({ html: "Error saving product.", classes: "red rounded" });
    } finally {
      if (saveBtn) saveBtn.disabled = false;
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

async function loadCategoryFilter() {
  const select = document.getElementById("filterCategory");
  if (!select) return;

  const snap = await getDocs(collection(db, "categoriesINV"));
  const categories = new Set();

  snap.forEach((docSnap) => {
    const data = docSnap.data();
    if (data.name) categories.add(data.name.trim());
  });

  select.innerHTML = "";
  let defaultCategory = null;

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    if (!defaultCategory) {
      option.selected = true;
      defaultCategory = category;
    }
    select.appendChild(option);
  });

  reinitSelect(select);
  if (defaultCategory) select.value = defaultCategory;
  return defaultCategory;
}

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
        const id = btn.dataset.id;

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
        if (!modalInstance) modalInstance = M.Modal.init(modalElem);
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
              ...buildCurrentQuantityFields(data, newStock),
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
    const thPacks = document.getElementById("th-packs");
    const thPieces = document.getElementById("th-pieces");
    const thContainer = document.getElementById("th-container");
    if (!thPacks || !thPieces || !thContainer) return;

    const sampleUnit = (filteredData[0]?.data.unit || "").toLowerCase();

    if (sampleUnit === "pack") {
      thPacks.style.display = "";
      thPieces.style.display = "";
      thContainer.style.display = "none";
      thPacks.textContent = "Packs Used";
      thPieces.textContent = "Pieces Used";
    } else if (sampleUnit === "packs") {
      thPacks.style.display = "";
      thPieces.style.display = "none";
      thContainer.style.display = "";
      thPacks.textContent = "Packs Used";
      thContainer.textContent = "Container";
    } else if (
      sampleUnit === "kaban" ||
      sampleUnit === "kg" ||
      sampleUnit === "liter"
    ) {
      thPacks.style.display = "none";
      thPieces.style.display = "none";
      thContainer.style.display = "";
      thContainer.textContent = "Container";
    } else {
      thPacks.style.display = "none";
      thPieces.style.display = "none";
      thContainer.style.display = "none";
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
      const packs = Math.ceil(
        (data.current_pieces ?? data.current_stock) /
          (data.pieces_per_pack || 1),
      );
      const pieces = data.current_pieces ?? data.current_stock ?? 0;

      quantityColumns = `
        <td data-label="Packs Used">${formatQuantity(data.packs_used ?? packs)}</td>
        <td data-label="Pieces Used">${formatQuantity(data.pieces_used ?? pieces)}</td>
      `;
    } else if (data.unit === "packs") {
      quantityColumns = `
        <td data-label="Packs Used">${formatQuantity(data.packs_used)}</td>
        <td data-label="Container">${formatQuantity(data.kaldero_count)}</td>
      `;
    } else if (data.unit === "kaban") {
      quantityColumns = `
        <td data-label="Container">${formatQuantity(data.kaldero_count)}</td>
      `;
    } else if (data.unit === "kg" || data.unit === "liter") {
      quantityColumns = `
        <td data-label="Container">${formatQuantity(data.kaldero_count)}</td>
      `;
    }

    return `
      <tr>
        <td data-label="Product Code"><strong>${data.product_code || "-"}</strong></td>
        <td data-label="Inventory ID">${inventoryProductId}</td>
        <td data-label="Inventory Name">${data.inventory_name || "-"}</td>
        <td data-label="Product Name">${data.product_name || "-"}</td>
        <td data-label="Category">${data.inv_category || data.category || "-"}</td>
        ${quantityColumns}
        <td data-label="Price">₱${Number(data.price || 0).toFixed(2)}</td>
        <td data-label="Action">
          <button class="edit-btn btn blue waves-effect waves-light" data-id="${id}">
            <i class="material-icons">edit</i>
          </button>
          <button class="delete-btn btn red waves-effect waves-light" data-id="${id}">
            <i class="material-icons">delete</i>
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

  await loadCategoryFilter();

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
