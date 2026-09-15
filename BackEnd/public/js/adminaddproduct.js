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
import { SyncProductFromFirebase } from "/js/IndexDB.js";

await SyncProductFromFirebase();

// ============================================
// VARIABLES
// ============================================
let unsubscribeInventoryOptions = null;
let unsubscribeProducts = null;
let unsubscribeProduct = null;
let unsubscribeRoleFilter = null;

const PRODUCT_PAGE_SIZE = 10;
let productCurrentPage = 1;
let allProductData = [];

let unsubscribeProductHistory = null;
let historyRowsCache = [];
let historyCurrentPage = 1;
const HISTORY_PAGE_SIZE = 10;

// ============================================
// HELPERS
// ============================================
function isContainerUnit(unit) {
  const u = (unit || "").toLowerCase();
  return u === "kg" || u === "liter";
}

function reinitSelect(selectEl) {
  if (!selectEl || !selectEl.isConnected) return;
  const instance = M.FormSelect.getInstance(selectEl);
  if (instance) instance.destroy();
  M.FormSelect.init(selectEl);
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

function buildAssignedQuantityFields(menuData, pieces) {
  const isPack = menuData.unit === "pack";
  const piecesPerPack = Number(menuData.pieces_per_pack) || 1;

  return {
    stock: pieces,
    pieces: pieces,
    packs: isPack ? Math.ceil(pieces / piecesPerPack) : null,
    pieces_per_pack: piecesPerPack,
    unit: menuData.unit || "piece",
    original_stock: pieces,
    assigned_stock: pieces,
  };
}

// Number of physical containers (kaldero) available for kg/liter products.
// Falls back to 1 (never to the stock number) when no explicit count is saved.
function getMaxAvailableContainers(menuData) {
  const explicitCount = Number(
    menuData.kaldero_count ?? menuData.container_count ?? 0,
  );
  if (explicitCount > 0) return explicitCount;
  return Number(menuData.current_stock || 0) > 0 ? 1 : 0;
}

function updateUnitDisplay(unit) {
  const unitField = document.getElementById("productUnit");
  if (unitField) {
    const unitMap = { pack: "PACK", kg: "KG", liter: "LITER", piece: "PIECE" };
    unitField.value = unitMap[unit] || "-";
  }
}

function hideAllQuantityInputs() {
  const ids = [
    "packs-input-field",
    "container-input-field",
    "pieces-input-field",
    "equivalent-field",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}

// Hides Price + Available Packs/Stock until a product is chosen.
function hideProductDetailFields() {
  const priceField = document.getElementById("product-price-field");
  const packsBox = document.getElementById("available-packs-box");
  const stockBox = document.getElementById("available-stock-box");
  if (priceField) priceField.style.display = "none";
  if (packsBox) packsBox.style.display = "none";
  if (stockBox) stockBox.style.display = "none";
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

// ============================================
// PRODUCT HISTORY
// ============================================
async function saveToProductHistory(productData, productId) {
  try {
    const existingQuery = query(
      collection(db, "productHistoryAssign"),
      where("productId", "==", productId),
      where("status", "==", "Completed"),
    );
    const existingSnap = await getDocs(existingQuery);

    let stockValue = Number(productData.original_stock ?? 0);
    if (stockValue === 0) stockValue = Number(productData.assigned_stock ?? 0);
    if (stockValue === 0)
      stockValue = Number(productData.pieces ?? productData.stock ?? 0);

    const price = Number(productData.price || 0);
    const totalIncome = stockValue * price;
    const capitalPrice = Number(productData.capital_price || 0);
    const totalCapital = stockValue * capitalPrice;
    const productName =
      productData.name || productData.product_name || "Unknown";
    const employeeName = productData.employee_name || "Unknown";

    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      await updateDoc(doc(db, "productHistoryAssign", existingDoc.id), {
        stock: stockValue,
        price: price,
        total_income: totalIncome,
        capital_price: capitalPrice,
        total_capital: totalCapital,
        original_stock: stockValue,
        employee_name: employeeName,
        unit: productData.unit || "pack",
        pieces_per_pack: Number(productData.pieces_per_pack || 60),
        last_updated: serverTimestamp(),
      });
      return;
    }

    const historyData = {
      productId: productId,
      product_name: productName,
      role: productData.role || "Unknown",
      employeeId: productData.employeeId || null,
      employee_name: employeeName,
      price: price,
      stock: stockValue,
      unit: productData.unit || "pack",
      pieces_per_pack: Number(productData.pieces_per_pack || 60),
      total_income: totalIncome,
      capital_price: capitalPrice,
      total_capital: totalCapital,
      status: "Completed",
      completed_at: serverTimestamp(),
      created_at: serverTimestamp(),
      last_updated: serverTimestamp(),
      inventoryId: productData.inventoryId || null,
      original_stock: stockValue,
    };

    await addDoc(collection(db, "productHistoryAssign"), historyData);

    M.toast({
      html: `📦 ${productName} moved to Product History (Sold: ${stockValue}, Income: ₱${totalIncome.toFixed(2)})`,
      classes: "blue rounded",
    });
  } catch (error) {
    console.error("Error saving to product history:", error);
  }
}

export function loadProductHistory() {
  const tbody = document.getElementById("history-assign-table-body");
  if (!tbody) return;

  if (unsubscribeProductHistory) {
    unsubscribeProductHistory();
    unsubscribeProductHistory = null;
  }

  unsubscribeProductHistory = onSnapshot(
    collection(db, "productHistoryAssign"),
    (querySnapshot) => {
      const tbodyNow = document.getElementById("history-assign-table-body");
      if (!tbodyNow) {
        if (unsubscribeProductHistory) {
          unsubscribeProductHistory();
          unsubscribeProductHistory = null;
        }
        return;
      }

      const rowsHtml = [];

      if (querySnapshot.empty) {
        rowsHtml.push(`
          <tr>
            <td colspan="8" class="center-align grey-text" style="padding: 30px 0;">
              <i class="material-icons" style="font-size: 48px; display: block; margin-bottom: 10px;">history</i>
              No completed products yet.
            </td>
          </tr>
        `);
      } else {
        querySnapshot.forEach((docSnap) => {
          const data = docSnap.data();

          const dateCompleted = data.completed_at
            ? data.completed_at.toDate().toLocaleDateString("en-PH", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "-";

          const stockValue = Number(data.original_stock || data.stock || 0);
          const unitType = data.unit || "pack";
          const piecesPerPack = Number(data.pieces_per_pack || 60);

          let stockDisplay = "";
          if (unitType === "pack") {
            const packs = Math.ceil(stockValue / piecesPerPack);
            stockDisplay = `${packs} packs (${stockValue} pcs)`;
          } else {
            stockDisplay = `${stockValue} ${unitType}`;
          }

          const totalIncome = Number(
            data.total_income || data.stock * data.price || 0,
          );
          const price = Number(data.price || 0);

          rowsHtml.push(`
            <tr>
              <td data-label="Product Name"><strong>${data.product_name || "-"}</strong></td>
              <td data-label="Role">${data.role || "-"}</td>
              <td data-label="Employee">${data.employee_name || "-"}</td>
              <td data-label="Stock"><strong>${stockDisplay}</strong></td>
              <td data-label="Price">₱${price.toFixed(2)}</td>
              <td data-label="Naibenta"><strong style="color: #16a34a;">₱${totalIncome.toFixed(2)}</strong></td>
              <td data-label="Date Completed">${dateCompleted}</td>
              <td data-label="Status">
                <span class="status available">Completed</span>
              </td>
            </tr>
          `);
        });
      }

      historyRowsCache = rowsHtml;
      historyCurrentPage = 1;
      renderHistoryPage();
    },
    (error) => {
      console.error("Error loading product history:", error);
    },
  );
}

function renderHistoryPage() {
  const tbody = document.getElementById("history-assign-table-body");
  if (!tbody) return;

  const totalPages = Math.max(
    1,
    Math.ceil(historyRowsCache.length / HISTORY_PAGE_SIZE),
  );
  if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;
  if (historyCurrentPage < 1) historyCurrentPage = 1;

  const start = (historyCurrentPage - 1) * HISTORY_PAGE_SIZE;
  const pageRows = historyRowsCache.slice(start, start + HISTORY_PAGE_SIZE);

  tbody.innerHTML =
    pageRows.length === 0
      ? `<tr><td colspan="8" class="center-align grey-text" style="padding: 30px 0;"><i class="material-icons" style="font-size: 48px; display: block; margin-bottom: 10px;">history</i>No completed products yet.</td></tr>`
      : pageRows.join("");

  const prev = document.getElementById("history-assign-prev");
  const next = document.getElementById("history-assign-next");
  const pageLabel = document.getElementById("history-assign-page");
  const infoLabel = document.getElementById("history-assign-info");

  if (prev && next) {
    prev.disabled = historyCurrentPage === 1;
    next.disabled = historyCurrentPage === totalPages;

    if (pageLabel) {
      pageLabel.textContent = `Page ${historyCurrentPage} of ${totalPages}`;
    }

    prev.onclick = () => {
      if (historyCurrentPage > 1) {
        historyCurrentPage--;
        renderHistoryPage();
      }
    };

    next.onclick = () => {
      if (historyCurrentPage < totalPages) {
        historyCurrentPage++;
        renderHistoryPage();
      }
    };
  }

  if (infoLabel) {
    const totalRecords = historyRowsCache.length;
    infoLabel.textContent =
      totalRecords === 0
        ? "Showing: 0 records"
        : `Showing: ${(historyCurrentPage - 1) * HISTORY_PAGE_SIZE + 1} - ${Math.min(historyCurrentPage * HISTORY_PAGE_SIZE, totalRecords)} of ${totalRecords} records`;
  }
}

export function stopLoadingHistoryAssign() {
  if (unsubscribeProductHistory) {
    unsubscribeProductHistory();
    unsubscribeProductHistory = null;
  }
}

// ============================================
// INVENTORY STOCK ADJUSTMENT
// ============================================
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

async function getCapitalPriceForMenuItem(menuData, transaction = null) {
  const inventoryId = menuData.inventory_id || menuData.inventoryId || null;
  if (!inventoryId) return 0;

  const inventoryRef = doc(db, "inventory", inventoryId);
  const inventorySnap = transaction
    ? await transaction.get(inventoryRef)
    : await getDoc(inventoryRef);

  if (!inventorySnap.exists()) return 0;
  return Number(inventorySnap.data().unit_price || 0);
}

// ============================================
// LOAD INVENTORY OPTIONS
// ============================================
function loadInventoryOptions(role = "") {
  const select = document.getElementById("productName");
  if (!select) return;

  if (unsubscribeInventoryOptions) unsubscribeInventoryOptions();

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

// ============================================
// RESET FORM
// ============================================
function resetAssignProductForm() {
  if (unsubscribeProduct) {
    unsubscribeProduct();
    unsubscribeProduct = null;
  }

  const form = document.getElementById("addProductForm");
  if (!form) return;
  form.reset();

  function safeSetValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  safeSetValue("productPrice", "");
  safeSetValue("productUnit", "-");
  safeSetValue("availablePacks", "0");
  safeSetValue("availableStock", "0");
  safeSetValue("assignPacks", "");
  safeSetValue("assignContainer", "");
  safeSetValue("assignPieces", "");
  safeSetValue("assignEquivalent", "");

  hideProductDetailFields();

  const containerFieldBox = document.getElementById("container-field");
  if (containerFieldBox) containerFieldBox.style.display = "none";

  const containerEl = document.getElementById("container");
  if (containerEl) containerEl.value = "";

  const stockUnitEl = document.getElementById("availableStockUnit");
  if (stockUnitEl) stockUnitEl.textContent = "";

  const stockLabel = document.getElementById("availableStockLabel");
  if (stockLabel) stockLabel.textContent = "Available Pieces";

  const packsLabelResetEl = document.querySelector(
    'label[for="availablePacks"]',
  );
  if (packsLabelResetEl) packsLabelResetEl.textContent = "Available Packs";

  hideAllQuantityInputs();

  const select = document.getElementById("productName");
  if (select) {
    select.innerHTML = `<option value="" disabled selected>Choose Product</option>`;
    M.updateTextFields();
    reinitSelect(select);
  }

  const roleSelect = document.getElementById("productRole");
  if (roleSelect) {
    loadInventoryOptions(roleSelect.value);
  }
}

// ============================================
// BIND FORM LISTENERS
// ============================================
function bindProductFormListeners() {
  const productRole = document.getElementById("productRole");
  const productName = document.getElementById("productName");
  const addProductForm = document.getElementById("addProductForm");

  // ROLE CHANGE
  productRole.addEventListener("change", (e) => {
    const role = e.target.value;

    const productNameSelect = document.getElementById("productName");
    if (productNameSelect) {
      productNameSelect.innerHTML = `<option value="" disabled selected>Choose Product</option>`;
    }

    function safeSetValue(id, value) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }

    safeSetValue("productPrice", "");
    safeSetValue("productUnit", "-");
    safeSetValue("availablePacks", "0");
    safeSetValue("availableStock", "0");
    safeSetValue("assignPacks", "");
    safeSetValue("assignContainer", "");
    safeSetValue("assignPieces", "");
    safeSetValue("assignEquivalent", "");

    hideAllQuantityInputs();
    hideProductDetailFields();

    const containerEl = document.getElementById("container");
    if (containerEl) containerEl.value = "";

    const stockUnitEl = document.getElementById("availableStockUnit");
    if (stockUnitEl) stockUnitEl.textContent = "";

    const stockLabel = document.getElementById("availableStockLabel");
    if (stockLabel) stockLabel.textContent = "Available Pieces";

    const packsLabelResetEl = document.querySelector(
      'label[for="availablePacks"]',
    );
    if (packsLabelResetEl) packsLabelResetEl.textContent = "Available Packs";

    M.updateTextFields();
    loadInventoryOptions(role);
  });

  // PRODUCT SELECT
  productName.addEventListener("change", (e) => {
    const id = e.target.value;
    if (!id) return;

    if (unsubscribeProduct) {
      unsubscribeProduct();
      unsubscribeProduct = null;
    }

    unsubscribeProduct = onSnapshot(doc(db, "productMenu", id), (snap) => {
      if (!snap.exists()) return;

      const data = snap.data();
      const unit = (data.unit || "piece").toLowerCase();
      const pieces = Number(data.current_pieces ?? data.current_stock) || 0;
      const currentStock = Number(data.current_stock ?? 0) || 0;
      const piecesPerPack = Number(data.pieces_per_pack) || 1;
      const price = Number(data.price || 0);

      updateUnitDisplay(unit);

      // Reveal price + stock fields now that a product is selected
      const priceField = document.getElementById("product-price-field");
      if (priceField) priceField.style.display = "block";
      const stockBox = document.getElementById("available-stock-box");
      if (stockBox) stockBox.style.display = "flex";

      const priceEl = document.getElementById("productPrice");
      if (priceEl) priceEl.value = price;

      const stockEl = document.getElementById("availableStock");
      if (stockEl) stockEl.value = pieces;

      hideAllQuantityInputs();

      const stockLabel = document.getElementById("availableStockLabel");
      const stockUnitEl = document.getElementById("availableStockUnit");
      const containerField = document.getElementById("container-field");
      const containerEl = document.getElementById("container");

      const packsInput = document.getElementById("assignPacks");
      const containerInput = document.getElementById("assignContainer");
      const piecesInput = document.getElementById("assignPieces");
      const equivalentInput = document.getElementById("assignEquivalent");

      if (packsInput) packsInput.value = "";
      if (containerInput) containerInput.value = "";
      if (piecesInput) piecesInput.value = "";
      if (equivalentInput) equivalentInput.value = "";

      if (unit === "pack") {
        const availablePacks = Math.floor(pieces / piecesPerPack);
        const packsEl = document.getElementById("availablePacks");
        if (packsEl) packsEl.value = availablePacks;

        const packsLabelEl = document.querySelector(
          'label[for="availablePacks"]',
        );
        if (packsLabelEl) packsLabelEl.textContent = "Available Packs";

        if (stockLabel) stockLabel.textContent = "Available Pieces";
        if (stockUnitEl) stockUnitEl.textContent = "PACK";

        const packsBox = document.getElementById("available-packs-box");
        if (packsBox) packsBox.style.display = "flex";

        const packsField = document.getElementById("packs-input-field");
        if (packsField) packsField.style.display = "block";

        if (packsInput) {
          packsInput.dataset.unit = "pack";
          packsInput.dataset.piecesPerPack = piecesPerPack;
          packsInput.max = availablePacks;
          packsInput.step = "1";
          packsInput.required = true;
          packsInput.disabled = false;
        }

        const containerFieldInput = document.getElementById(
          "container-input-field",
        );
        if (containerFieldInput) containerFieldInput.style.display = "none";

        const piecesField = document.getElementById("pieces-input-field");
        if (piecesField) piecesField.style.display = "none";

        if (containerInput) containerInput.required = false;
        if (piecesInput) piecesInput.required = false;

        const equivField = document.getElementById("equivalent-field");
        if (equivField) equivField.style.display = "block";

        if (containerField) containerField.style.display = "none";
        if (containerEl) containerEl.value = "";
      } else if (unit === "kg" || unit === "liter") {
        const displayUnit = unit === "kg" ? "KG" : "LITER";
        const maxContainers = getMaxAvailableContainers(data);

        const packsEl = document.getElementById("availablePacks");
        if (packsEl) packsEl.value = maxContainers;

        const packsLabelEl = document.querySelector(
          'label[for="availablePacks"]',
        );
        if (packsLabelEl) packsLabelEl.textContent = "Available Containers";

        if (stockLabel) stockLabel.textContent = "Available Stock";
        if (stockUnitEl) stockUnitEl.textContent = displayUnit;

        const packsBox = document.getElementById("available-packs-box");
        if (packsBox) packsBox.style.display = "flex";

        const containerFieldInput = document.getElementById(
          "container-input-field",
        );
        if (containerFieldInput) containerFieldInput.style.display = "block";

        if (containerInput) {
          containerInput.dataset.unit = unit;
          containerInput.dataset.maxContainers = maxContainers;
          containerInput.max = maxContainers;
          containerInput.min = "0";
          containerInput.step = "1";
          containerInput.required = true;
          containerInput.disabled = false;
        }

        const packsField = document.getElementById("packs-input-field");
        if (packsField) packsField.style.display = "none";

        const piecesField = document.getElementById("pieces-input-field");
        if (piecesField) piecesField.style.display = "none";

        if (packsInput) packsInput.required = false;
        if (piecesInput) piecesInput.required = false;

        const equivField = document.getElementById("equivalent-field");
        if (equivField) equivField.style.display = "block";

        if (containerField) {
          if (maxContainers > 0) {
            containerField.style.display = "block";
            if (containerEl) containerEl.value = maxContainers;
          } else {
            containerField.style.display = "none";
            if (containerEl) containerEl.value = "";
          }
        }
      } else {
        const packsEl = document.getElementById("availablePacks");
        if (packsEl) packsEl.value = "0";

        if (stockLabel) stockLabel.textContent = "Available Pieces";
        if (stockUnitEl) stockUnitEl.textContent = "PIECE";

        const packsBox = document.getElementById("available-packs-box");
        if (packsBox) packsBox.style.display = "none";

        const piecesField = document.getElementById("pieces-input-field");
        if (piecesField) piecesField.style.display = "block";

        if (piecesInput) {
          piecesInput.dataset.unit = "piece";
          piecesInput.max = currentStock;
          piecesInput.step = "1";
          piecesInput.required = true;
          piecesInput.disabled = false;
        }

        const packsField = document.getElementById("packs-input-field");
        if (packsField) packsField.style.display = "none";

        const containerFieldInput = document.getElementById(
          "container-input-field",
        );
        if (containerFieldInput) containerFieldInput.style.display = "none";

        if (packsInput) packsInput.required = false;
        if (containerInput) containerInput.required = false;

        const equivField = document.getElementById("equivalent-field");
        if (equivField) equivField.style.display = "block";

        if (containerField) containerField.style.display = "none";
        if (containerEl) containerEl.value = "";
      }

      M.updateTextFields();
    });
  });

  // QUANTITY INPUT LISTENER
  document
    .querySelectorAll("#assignPacks, #assignContainer, #assignPieces")
    .forEach((input) => {
      input.addEventListener("input", (e) => {
        const inputEl = e.target;
        const unit = inputEl.dataset.unit || "";
        const equivalentInput = document.getElementById("assignEquivalent");
        let value = Number(inputEl.value) || 0;
        let maxValue = Number(inputEl.max) || 0;

        if (value > maxValue) {
          inputEl.value = maxValue;
          value = maxValue;
        }
        if (value < 0) {
          inputEl.value = 0;
          value = 0;
        }

        let equivalent = value;

        if (unit === "pack") {
          const piecesPerPack = Number(inputEl.dataset.piecesPerPack) || 1;
          equivalent = value * piecesPerPack;
        }

        if (equivalentInput) equivalentInput.value = equivalent;

        M.updateTextFields();
      });
    });

  function getSelectedUnit() {
    const packsField = document.getElementById("packs-input-field");
    const containerField = document.getElementById("container-input-field");
    const piecesField = document.getElementById("pieces-input-field");

    if (packsField && packsField.style.display !== "none") return "pack";
    if (containerField && containerField.style.display !== "none")
      return "container";
    if (piecesField && piecesField.style.display !== "none") return "piece";
    return "pack";
  }

  // FORM SUBMIT
  addProductForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const menuId = document.getElementById("productName").value;
    const employeeId = document.getElementById("productEmployee").value;
    const role = document.getElementById("productRole").value;

    const unit = getSelectedUnit();
    let enteredQty = 0;

    if (unit === "pack") {
      enteredQty = Number(document.getElementById("assignPacks").value) || 0;
    } else if (unit === "container") {
      enteredQty =
        Number(document.getElementById("assignContainer").value) || 0;
    } else if (unit === "piece") {
      enteredQty = Number(document.getElementById("assignPieces").value) || 0;
    }

    if (!menuId) {
      M.toast({ html: "Please select a product.", classes: "red rounded" });
      return;
    }

    if (enteredQty <= 0) {
      M.toast({
        html: "Please enter a valid quantity.",
        classes: "red rounded",
      });
      return;
    }

    const submitBtn = addProductForm.querySelector(
      "button[type='submit'], input[type='submit']",
    );
    if (submitBtn) submitBtn.disabled = true;

    try {
      const menuRef = doc(db, "productMenu", menuId);

      if (!employeeId) {
        // ==========================================
        // SHARED ASSIGNMENT ("All Employees")
        // Every employee under the selected role gets the FULL
        // entered quantity (not divided). Existing rows for that
        // employee + product get merged; new rows are created for
        // employees who don't have one yet.
        // ==========================================
        const empRoleSnap = await getDocs(
          query(collection(db, "employees"), where("role", "==", role)),
        );
        const targetEmployees = [];
        empRoleSnap.forEach((docSnap) => {
          const d = docSnap.data();
          targetEmployees.push({
            id: docSnap.id,
            fname: d.fname,
            lname: d.lname,
          });
        });

        if (targetEmployees.length === 0) {
          throw new Error("No employees found for this role.");
        }

        // Pre-fetch existing product row per target employee (outside
        // the transaction — Firestore transactions can't run queries).
        const existingRowMap = {};
        for (const emp of targetEmployees) {
          const rowSnap = await getDocs(
            query(
              collection(db, "products"),
              where("inventoryId", "==", menuId),
              where("employeeId", "==", emp.id),
            ),
          );
          existingRowMap[emp.id] = rowSnap.empty ? null : rowSnap.docs[0].id;
        }

        const result = await runTransaction(db, async (transaction) => {
          const menuSnap = await transaction.get(menuRef);
          if (!menuSnap.exists()) {
            throw new Error("Selected product no longer exists.");
          }

          const menuData = menuSnap.data();
          const menuUnit = (menuData.unit || "piece").toLowerCase();
          const isContainer = isContainerUnit(menuUnit);
          const piecesPerPack = Number(menuData.pieces_per_pack) || 1;

          const capitalPrice = await getCapitalPriceForMenuItem(
            menuData,
            transaction,
          );

          const piecesPerEmployee =
            menuUnit === "pack" ? enteredQty * piecesPerPack : enteredQty;

          const currentStock = Number(menuData.current_stock || 0);
          const maxContainers = isContainer
            ? getMaxAvailableContainers(menuData)
            : null;

          const maxByStock = Math.floor(currentStock / piecesPerEmployee);
          const maxByContainers = isContainer
            ? Math.floor(maxContainers / piecesPerEmployee)
            : Infinity;
          const servableCount = Math.min(
            targetEmployees.length,
            maxByStock,
            maxByContainers,
          );

          if (servableCount <= 0) {
            throw new Error("Not enough stock to assign to any employee.");
          }

          const servedEmployees = targetEmployees.slice(0, servableCount);
          const totalPiecesUsed = piecesPerEmployee * servableCount;
          const updatedStock = currentStock - totalPiecesUsed;

          // Read every existing row first — ALL reads in a Firestore
          // transaction must happen before ANY writes.
          const existingSnaps = {};
          for (const emp of servedEmployees) {
            const existingId = existingRowMap[emp.id];
            if (existingId) {
              const ref = doc(db, "products", existingId);
              existingSnaps[emp.id] = {
                ref,
                snap: await transaction.get(ref),
              };
            }
          }

          // All reads are done — writes can start now.
          transaction.update(menuRef, {
            ...buildCurrentQuantityFields(menuData, updatedStock),
            ...(isContainer
              ? {
                  kaldero_count: Math.max(0, maxContainers - totalPiecesUsed),
                  container_count: Math.max(0, maxContainers - totalPiecesUsed),
                }
              : {}),
            status: updatedStock <= 0 ? "On Selling" : "Available",
            assigned: true,
            last_updated: serverTimestamp(),
          });

          for (const emp of servedEmployees) {
            const existing = existingSnaps[emp.id];
            if (existing && existing.snap.exists()) {
              const oldData = existing.snap.data();
              const oldPieces = Number(oldData.pieces ?? oldData.stock ?? 0);
              const oldCapital = Number(oldData.capital_price || 0);
              const mergedPieces = oldPieces + piecesPerEmployee;
              const mergedCapitalPrice =
                mergedPieces > 0
                  ? (oldPieces * oldCapital +
                      piecesPerEmployee * capitalPrice) /
                    mergedPieces
                  : capitalPrice;

              transaction.update(existing.ref, {
                capital_price: mergedCapitalPrice,
                ...buildAssignedQuantityFields(menuData, mergedPieces),
                last_updated: serverTimestamp(),
              });
            } else {
              const newRef = doc(collection(db, "products"));
              transaction.set(newRef, {
                name: menuData.product_name || "Unknown",
                price: Number(menuData.price || 0),
                capital_price: capitalPrice,
                role: role || menuData.category || "Unknown",
                category:
                  menuData.inv_category || menuData.category || "Unknown",
                employeeId: emp.id,
                inventoryId: menuId,
                ...buildAssignedQuantityFields(menuData, piecesPerEmployee),
                created_at: serverTimestamp(),
                last_updated: serverTimestamp(),
              });
            }
          }

          return {
            piecesToAssign: totalPiecesUsed,
            servedCount: servableCount,
            totalEmployees: targetEmployees.length,
          };
        });

        await adjustLinkedInventoryStock(menuId, -result.piecesToAssign);
        await SyncProductFromFirebase();

        if (result.servedCount < result.totalEmployees) {
          M.toast({
            html: `Not enough stock for everyone. Assigned to ${result.servedCount} of ${result.totalEmployees} employees.`,
            classes: "orange rounded",
          });
        } else {
          M.toast({
            html: `Assigned to all ${result.servedCount} employees!`,
            classes: "green rounded",
          });
        }

        resetAssignProductForm();
        return;
      }

      // ==========================================
      // SPECIFIC-EMPLOYEE ASSIGNMENT
      // Merge into that employee's existing row for this product,
      // or create a new one if they don't have one yet.
      // ==========================================
      const existingQuery = query(
        collection(db, "products"),
        where("inventoryId", "==", menuId),
        where("employeeId", "==", employeeId),
      );
      const existingSnap = await getDocs(existingQuery);
      const existingProductId = existingSnap.empty
        ? null
        : existingSnap.docs[0].id;

      const result = await runTransaction(db, async (transaction) => {
        const menuSnap = await transaction.get(menuRef);
        if (!menuSnap.exists()) {
          throw new Error("Selected product no longer exists.");
        }

        const existingProductRef = existingProductId
          ? doc(db, "products", existingProductId)
          : null;
        const existingProductSnap = existingProductRef
          ? await transaction.get(existingProductRef)
          : null;

        const menuData = menuSnap.data();
        const menuUnit = (menuData.unit || "piece").toLowerCase();
        const isContainer = isContainerUnit(menuUnit);
        const piecesPerPack = Number(menuData.pieces_per_pack) || 1;

        const newCapitalPrice = await getCapitalPriceForMenuItem(
          menuData,
          transaction,
        );

        const piecesToAssign =
          menuUnit === "pack" ? enteredQty * piecesPerPack : enteredQty;

        if (isContainer) {
          const maxContainers = getMaxAvailableContainers(menuData);
          if (piecesToAssign > maxContainers) {
            throw new Error(
              `Not enough containers! Available: ${maxContainers}`,
            );
          }
        }

        const currentStock = Number(menuData.current_stock || 0);
        if (piecesToAssign > currentStock) {
          throw new Error("Not enough inventory stock!");
        }

        const updatedStock = currentStock - piecesToAssign;

        transaction.update(menuRef, {
          ...buildCurrentQuantityFields(menuData, updatedStock),
          ...(isContainer
            ? {
                kaldero_count: Math.max(
                  0,
                  getMaxAvailableContainers(menuData) - piecesToAssign,
                ),
                container_count: Math.max(
                  0,
                  getMaxAvailableContainers(menuData) - piecesToAssign,
                ),
              }
            : {}),
          status: updatedStock <= 0 ? "On Selling" : "Available",
          assigned: true,
          last_updated: serverTimestamp(),
        });

        if (existingProductSnap && existingProductSnap.exists()) {
          const oldData = existingProductSnap.data();
          const oldPieces = Number(oldData.pieces ?? oldData.stock ?? 0);
          const oldCapital = Number(oldData.capital_price || 0);

          const mergedPieces = oldPieces + piecesToAssign;
          const mergedCapitalPrice =
            mergedPieces > 0
              ? (oldPieces * oldCapital + piecesToAssign * newCapitalPrice) /
                mergedPieces
              : newCapitalPrice;

          transaction.update(existingProductRef, {
            capital_price: mergedCapitalPrice,
            ...buildAssignedQuantityFields(menuData, mergedPieces),
            last_updated: serverTimestamp(),
          });

          return { menuData, piecesToAssign, merged: true };
        }

        const newProductRef = doc(collection(db, "products"));
        transaction.set(newProductRef, {
          name: menuData.product_name || "Unknown",
          price: Number(menuData.price || 0),
          capital_price: newCapitalPrice,
          role: role || menuData.category || "Unknown",
          category: menuData.inv_category || menuData.category || "Unknown",
          employeeId: employeeId,
          inventoryId: menuId,
          ...buildAssignedQuantityFields(menuData, piecesToAssign),
          created_at: serverTimestamp(),
          last_updated: serverTimestamp(),
        });

        return { menuData, piecesToAssign, merged: false };
      });

      await adjustLinkedInventoryStock(menuId, -result.piecesToAssign);
      await SyncProductFromFirebase();

      M.toast({
        html: "Product assigned successfully!",
        classes: "green rounded",
      });

      resetAssignProductForm();
    } catch (error) {
      console.error("Assign product error:", error);
      M.toast({
        html: error.message || "Failed to assign product.",
        classes: "red rounded",
      });
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

// ============================================
// LOAD ROLES
// ============================================
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

// ============================================
// LOAD CATEGORY FILTER OPTIONS
// ============================================
// filterRole element still uses the old ID, but it now filters by
// product CATEGORY (not employee role) so kg/liter items don't get
// lumped together just because they share a unit type.
function loadCategoryFilterOptions(filterCategorySelect) {
  if (unsubscribeRoleFilter) unsubscribeRoleFilter();

  unsubscribeRoleFilter = onSnapshot(collection(db, "products"), (snapshot) => {
    if (!filterCategorySelect.isConnected) return;

    const categories = new Set();
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const cat = (data.category || data.role || "").trim();
      if (cat) categories.add(cat);
    });

    const previousValue = filterCategorySelect.value;

    if (categories.size === 0) {
      filterCategorySelect.innerHTML = `<option value="" disabled selected>No categories yet</option>`;
      reinitSelect(filterCategorySelect);
      return;
    }

    filterCategorySelect.innerHTML = "";
    let selectedExists = false;
    categories.forEach((category) => {
      if (category === previousValue) selectedExists = true;
      filterCategorySelect.innerHTML += `<option value="${category}">${category}</option>`;
    });

    if (selectedExists) {
      filterCategorySelect.value = previousValue;
      reinitSelect(filterCategorySelect);
    } else {
      const firstCategory = filterCategorySelect.querySelector("option")?.value;
      filterCategorySelect.value = firstCategory;
      reinitSelect(filterCategorySelect);
      filterCategorySelect.dispatchEvent(new Event("change"));
    }
  });
}

// ============================================
// LOAD PRODUCTS
// ============================================
export async function loadProducts() {
  const tbody = document.querySelector("#productTable tbody");
  const filterRole = document.getElementById("filterRole");
  const searchInput = document.getElementById("searchAssignProduct");
  const clearBtn = document.getElementById("clearAssignSearch");

  if (!tbody || !filterRole) return;

  const empSnap = await getDocs(collection(db, "employees"));
  const employeesMap = {};
  empSnap.forEach((docSnap) => {
    employeesMap[docSnap.id] = docSnap.data();
  });

  loadCategoryFilterOptions(filterRole);

  let searchTimeout = null;

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
            const isContainer = isContainerUnit(menuData.unit);

            transaction.update(menuRef, {
              ...buildCurrentQuantityFields(menuData, restoredStock),
              ...(isContainer
                ? {
                    kaldero_count:
                      getMaxAvailableContainers(menuData) + restoredPieces,
                    container_count:
                      getMaxAvailableContainers(menuData) + restoredPieces,
                  }
                : {}),
              status: restoredStock <= 0 ? "On Selling" : "Available",
              last_updated: serverTimestamp(),
            });

            transaction.delete(productRef);
          });

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
          const rawStock = document.getElementById("edit-stock").value;

          const newStock = isContainerUnit(oldData.unit)
            ? parseFloat(rawStock)
            : parseInt(rawStock, 10);

          const diff = newStock - oldStock;

          const menuRef = doc(db, "productMenu", oldData.inventoryId);
          const menuSnap = await getDoc(menuRef);
          const menuData = menuSnap.data();
          const isContainer = isContainerUnit(oldData.unit);

          if (isContainer && diff > 0) {
            const maxContainers = getMaxAvailableContainers(menuData);
            if (diff > maxContainers) {
              M.toast({
                html: `Not enough containers! Available: ${maxContainers}`,
                classes: "red rounded",
              });
              return;
            }
          }

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
            ...(isContainer
              ? {
                  kaldero_count: Math.max(
                    0,
                    getMaxAvailableContainers(menuData) - diff,
                  ),
                  container_count: Math.max(
                    0,
                    getMaxAvailableContainers(menuData) - diff,
                  ),
                }
              : {}),
            status: updatedStock <= 0 ? "On Selling" : "Available",
            last_updated: serverTimestamp(),
          });

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

  function getFilteredData() {
    const searchTerm = searchInput
      ? searchInput.value.toLowerCase().trim()
      : "";
    const selectedCategory = filterRole.value;

    let filteredData = allProductData;

    if (selectedCategory) {
      filteredData = filteredData.filter((item) => {
        const cat = (item.data.category || item.data.role || "").trim();
        return cat === selectedCategory;
      });
    }

    if (searchTerm) {
      filteredData = filteredData.filter((item) => {
        const productName = (item.data.name || "").toLowerCase();
        const role = (item.data.role || "").toLowerCase();
        const category = (item.data.category || "").toLowerCase();
        const employee = (item.empDisplay || "").toLowerCase();
        const price = String(item.data.price || "");
        return (
          productName.includes(searchTerm) ||
          role.includes(searchTerm) ||
          category.includes(searchTerm) ||
          employee.includes(searchTerm) ||
          price.includes(searchTerm)
        );
      });
    }

    return filteredData;
  }

  function updateTableHeaders(filteredData) {
    const packsHeaderEl = document.querySelector(
      "#productTable thead th:nth-child(3)",
    );
    const piecesHeaderEl = document.querySelector(
      "#productTable thead th:nth-child(4)",
    );
    if (!packsHeaderEl || !piecesHeaderEl) return;

    const sampleUnit = (filteredData[0]?.data.unit || "").toLowerCase();

    if (sampleUnit === "kg") {
      packsHeaderEl.textContent = "Container";
      piecesHeaderEl.textContent = "KG";
    } else if (sampleUnit === "liter") {
      packsHeaderEl.textContent = "Container";
      piecesHeaderEl.textContent = "Liter";
    } else {
      packsHeaderEl.textContent = "Packs";
      piecesHeaderEl.textContent = "Pieces";
    }
  }

  function renderProductPage() {
    if (!tbody.isConnected) return;

    const filteredData = getFilteredData();
    updateTableHeaders(filteredData);
    const totalRecords = filteredData.length;
    const totalPages = Math.max(1, Math.ceil(totalRecords / PRODUCT_PAGE_SIZE));

    if (productCurrentPage > totalPages) productCurrentPage = totalPages;
    if (productCurrentPage < 1) productCurrentPage = 1;

    const start = (productCurrentPage - 1) * PRODUCT_PAGE_SIZE;
    const pageItems = filteredData.slice(start, start + PRODUCT_PAGE_SIZE);

    let rowsHtml = "";
    for (const item of pageItems) {
      const { id, data, empDisplay } = item;
      const piecesValue = data.pieces ?? data.stock ?? 0;
      const priceValue = Number(data.price || 0);

      const capitalPriceValue = Number(data.capital_price || 0);
      const totalCapital = piecesValue * capitalPriceValue;

      const packsDisplay =
        data.unit === "pack"
          ? Math.ceil(piecesValue / (data.pieces_per_pack || 1))
          : isContainerUnit(data.unit)
            ? piecesValue
            : "-";

      rowsHtml += `
        <tr>
          <td data-label="Product Name">${data.name}</td>
          <td data-label="Price">₱${priceValue.toFixed(2)}</td>
          <td data-label="Packs">${packsDisplay}</td>
          <td data-label="Pieces">${piecesValue}</td>
          <td data-label="Role">${data.role}</td>
          <td data-label="Employee">${empDisplay}</td>
          <td data-label="Capital"><strong style="color: #16a34a;">₱${totalCapital.toFixed(2)}</strong></td>
          <td data-label="Action">
            <button class="btn blue edit-btn" data-id="${id}"><i class="material-icons">edit</i></button>
            <button class="btn red delete-btn" data-id="${id}"><i class="material-icons">delete</i></button>
          </td>
        </tr>
      `;
    }

    if (!rowsHtml) {
      const searchTerm = searchInput ? searchInput.value : "";
      rowsHtml = `
        <tr>
          <td colspan="8" class="center-align grey-text" style="padding: 30px 0;">
            <i class="material-icons" style="font-size: 48px; display: block; margin-bottom: 10px;">search</i>
            ${searchTerm ? `No products found matching "<strong>${searchTerm}</strong>"` : "No products found."}
          </td>
        </tr>
      `;
    }

    tbody.innerHTML = rowsHtml;

    const showingCountEl = document.getElementById("productShowingCount");
    if (showingCountEl) showingCountEl.textContent = pageItems.length;

    const paginationLinks = document.querySelectorAll("#productPagination a");
    const prevBtn = paginationLinks[0];
    const nextBtn = paginationLinks[1];

    if (prevBtn) {
      prevBtn.classList.toggle("disabled", productCurrentPage <= 1);
      prevBtn.onclick = (e) => {
        e.preventDefault();
        if (productCurrentPage <= 1) return;
        productCurrentPage--;
        renderProductPage();
      };
    }

    if (nextBtn) {
      nextBtn.classList.toggle("disabled", productCurrentPage >= totalPages);
      nextBtn.onclick = (e) => {
        e.preventDefault();
        if (productCurrentPage >= totalPages) return;
        productCurrentPage++;
        renderProductPage();
      };
    }

    const pageNumberEl = document.getElementById("productPageNumber");
    if (pageNumberEl)
      pageNumberEl.textContent = `Page ${productCurrentPage} of ${totalPages}`;

    bindRowButtons();
  }

  function renderProducts(employeeId = "") {
    if (unsubscribeProducts) {
      unsubscribeProducts();
      unsubscribeProducts = null;
    }

    let q = collection(db, "products");

    unsubscribeProducts = onSnapshot(q, async (querySnapshot) => {
      if (!tbody.isConnected) return;

      allProductData = [];

      for (const docSnap of querySnapshot.docs) {
        const data = docSnap.data();
        const currentStock = Number(data.pieces ?? data.stock ?? 0);
        const productId = docSnap.id;

        if (currentStock === 0 && data.employeeId) {
          try {
            let originalStock = Number(
              data.original_stock ?? data.assigned_stock ?? 0,
            );

            if (originalStock === 0) {
              try {
                const productRef = doc(db, "products", productId);
                const productSnap = await getDoc(productRef);
                if (productSnap.exists()) {
                  const prodData = productSnap.data();
                  originalStock = Number(
                    prodData.original_stock ??
                      prodData.assigned_stock ??
                      prodData.pieces ??
                      prodData.stock ??
                      0,
                  );
                }
              } catch (e) {
                console.error("Error getting product data:", e);
              }
            }

            if (originalStock === 0 && data.inventoryId) {
              try {
                const menuRef = doc(db, "productMenu", data.inventoryId);
                const menuSnap = await getDoc(menuRef);
                if (menuSnap.exists()) {
                  const menuData = menuSnap.data();
                  const piecesPerPack = Number(menuData.pieces_per_pack || 60);
                  const packs = Number(menuData.quantity || 1);
                  originalStock = piecesPerPack * packs;
                }
              } catch (e) {
                console.error("Error getting menu data:", e);
              }
            }

            const empData = employeesMap[data.employeeId] || {};
            const employeeName = empData.fname
              ? `${empData.fname} ${empData.lname}`.trim()
              : "Unknown";

            await saveToProductHistory(
              {
                ...data,
                employee_name: employeeName,
                pieces: originalStock,
                stock: originalStock,
                original_stock: originalStock,
              },
              productId,
            );

            await deleteDoc(doc(db, "products", productId));
            continue;
          } catch (error) {
            console.error("Error processing product:", error);
          }
        }

        if (currentStock === 0) continue;

        if (employeeId && data.employeeId && data.employeeId !== employeeId)
          continue;

        const empData = employeesMap[data.employeeId] || {};
        const empDisplay = empData.fname
          ? `${empData.fname} ${empData.lname}`
          : "-";

        allProductData.push({ id: docSnap.id, data, empDisplay });
      }

      productCurrentPage = 1;
      renderProductPage();
    });
  }

  renderProducts();

  filterRole.removeEventListener("change", handleCategoryChange);
  filterRole.addEventListener("change", handleCategoryChange);

  function handleCategoryChange() {
    productCurrentPage = 1;
    renderProductPage();
  }

  if (searchInput) {
    searchInput.removeEventListener("input", handleSearch);
    searchInput.addEventListener("input", handleSearch);
  }

  function handleSearch() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      productCurrentPage = 1;
      renderProductPage();
      if (clearBtn)
        clearBtn.style.display = searchInput.value.length > 0 ? "flex" : "none";
    }, 300);
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
      productCurrentPage = 1;
      renderProductPage();
    }
  }
}

// ============================================
// INIT PRODUCT PAGE
// ============================================
export async function initProductPage() {
  const modals = document.querySelectorAll(".modal");
  modals.forEach((modal) => {
    const instance = M.Modal.getInstance(modal);
    if (instance) instance.destroy();
    M.Modal.init(modal, { dismissible: false });
  });

  await loadRoles();

  bindProductFormListeners();
  resetAssignProductForm();

  const clearBtn = document.getElementById("clearAssignSearch");
  if (clearBtn) clearBtn.style.display = "none";

  const historyBtn = document.getElementById("btn-product-history-assign");
  if (historyBtn) {
    historyBtn.replaceWith(historyBtn.cloneNode(true));
    const newHistoryBtn = document.getElementById("btn-product-history-assign");

    newHistoryBtn.addEventListener("click", () => {
      const modalEl = document.getElementById("modal-product-history-assign");
      if (!modalEl) return;

      let instance = M.Modal.getInstance(modalEl);
      if (!instance) {
        instance = M.Modal.init(modalEl, {
          dismissible: true,
          onOpenEnd: () => {
            loadProductHistory();
          },
          onCloseEnd: () => {
            stopLoadingHistoryAssign();
          },
        });
      } else {
        loadProductHistory();
      }
      instance.open();
    });
  }
}

// ============================================
// CLEANUP
// ============================================
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
  if (unsubscribeProductHistory) {
    unsubscribeProductHistory();
    unsubscribeProductHistory = null;
  }

  const searchInput = document.getElementById("searchAssignProduct");
  const clearBtn = document.getElementById("clearAssignSearch");
  if (searchInput) searchInput.oninput = null;
  if (clearBtn) clearBtn.onclick = null;
}
