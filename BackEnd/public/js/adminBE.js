// adminBE.js
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
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==================== INVENTORY ==================== //
let unsubscribeInventory = null;
let unsubscribeCategories = null;

let selectedCategoryFilter = "all";
let categoryNameMap = {};

// PAGINATION
const PAGE_SIZE = 10;
let currentPage = 1;
let inventoryRowsCache = [];

function toUpper(value) {
  return (value || "").trim().toUpperCase();
}

function bindLiveUppercase(input) {
  if (!input || input.dataset.uppercaseBound) return;
  input.dataset.uppercaseBound = "true";
  input.addEventListener("input", () => {
    const start = input.selectionStart;
    const end = input.selectionEnd;
    input.value = input.value.toUpperCase();
    if (start !== null && end !== null) {
      input.setSelectionRange(start, end);
    }
  });
}

function toLocalDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function confirmDeletion(title, message) {
  const modalElement = document.getElementById("modal-delete-category");
  const confirmButton = document.getElementById("confirm-delete-category");
  const cancelButton = document.getElementById("cancel-delete-category");
  const titleElement = document.getElementById("delete-confirmation-title");
  const messageElement = document.getElementById("delete-confirmation-message");
  if (!modalElement || !confirmButton || !cancelButton) {
    return Promise.resolve(false);
  }
  const modalInstance = M.Modal.init(modalElement, { dismissible: false });

  if (titleElement) titleElement.textContent = title;
  if (messageElement) messageElement.textContent = message;

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

function confirmRecover(
  title = "Recover product?",
  message = "This will restore the product back to Inventory.",
) {
  const modalElement = document.getElementById("modal-recover-product");
  const confirmButton = document.getElementById("confirm-recover-product");
  const cancelButton = document.getElementById("cancel-recover-product");
  const titleElement = document.getElementById("recover-confirmation-title");
  const messageElement = document.getElementById(
    "recover-confirmation-message",
  );

  if (!modalElement || !confirmButton || !cancelButton) {
    return Promise.resolve(false);
  }

  let modalInstance = M.Modal.getInstance(modalElement);
  if (modalInstance) modalInstance.destroy();
  modalInstance = M.Modal.init(modalElement, { dismissible: false });

  if (titleElement) titleElement.textContent = title;
  if (messageElement) messageElement.textContent = message;

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

export function loadInventory() {
  const tbody = document.getElementById("inventory-table-body");
  const dateInput = document.getElementById("filter-date");

  if (unsubscribeInventory) {
    unsubscribeInventory();
    unsubscribeInventory = null;
  }

  unsubscribeInventory = onSnapshot(
    collection(db, "inventory"),
    async (querySnapshot) => {
      const tbodyNow = document.getElementById("inventory-table-body");
      const dateInputNow = document.getElementById("filter-date");
      if (!tbodyNow) {
        if (unsubscribeInventory) {
          unsubscribeInventory();
          unsubscribeInventory = null;
        }
        return;
      }

      let totalProducts = 0;
      let totalStocks = 0;
      let totalValue = 0;
      const categories = new Set();
      const unitTotals = { pack: 0, kg: 0, liter: 0, other: 0 };
      const rowsHtml = [];

      const selectedCategory = selectedCategoryFilter;
      const selectedDate = dateInputNow ? dateInputNow.value : "";

      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();

        if (selectedCategory !== "all") {
          const selectedName = categoryNameMap[selectedCategory] || "";
          if (data.category !== selectedName) return;
        }

        if (selectedDate) {
          if (!data.created_at) return;
          const docDate = toLocalDateValue(data.created_at.toDate());
          if (docDate !== selectedDate) return;
        }

        totalProducts++;
        totalStocks += data.stock_quantity;
        totalValue += data.total_value;
        categories.add(data.category);

        const bucket =
          data.unit_type === "pack" ||
          data.unit_type === "kg" ||
          data.unit_type === "liter"
            ? data.unit_type
            : "other";
        unitTotals[bucket] += data.stock_quantity;

        let status = "Available";
        const lowStockThreshold = data.low_stock_threshold || 25;

        if (data.quantity <= 0) {
          status = "On Selling";
        } else if (data.stock_quantity <= lowStockThreshold) {
          status = "Low Stock";
        }

        let totalLabel = "Total Pieces";
        let totalDisplay = "";

        if (data.unit_type === "pack") {
          totalLabel = "Total Pieces";
          totalDisplay = `${data.stock_quantity} pcs`;
        } else if (data.unit_type === "kg") {
          totalLabel = "Total Weight";
          const pounds = (data.quantity * 2.2).toFixed(2);
          totalDisplay = `${pounds} lb`;
        } else if (data.unit_type === "liter") {
          totalDisplay = `${data.quantity} L`;
        } else {
          totalLabel = "Total Quantity";
          totalDisplay = `${data.stock_quantity}`;
        }

        const dateAdded = data.created_at
          ? data.created_at.toDate().toLocaleDateString("en-PH", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "-";

        rowsHtml.push(`
  <tr data-category-id="${docSnap.data().category_id}">
    <td data-label="Product Name">${data.product_name}${
      data.plasticColor
        ? ` <span class="plastic-color-badge">(${data.plasticColor} Plastic)</span>`
        : ""
    }</td>
    <td data-label="Category">${data.category}</td>
    <td data-label="Quantity">${data.quantity} ${data.unit_type}</td>
    <td data-label="${totalLabel}">${totalDisplay}</td>
    <td data-label="Unit Price">₱${data.unit_price.toFixed(2)}</td>
    <td data-label="Total Value">₱${data.total_value.toFixed(2)}</td>
     <td data-label="Date">${dateAdded}</td> 
    <td data-label="Status">
        <span class="status ${status.toLowerCase().replace(/\s/g, "-")}">
        ${status}
        </span>
    </td>
    <td data-label="Action">
      <button class="edit-btn btn blue" data-id="${docSnap.id}">
        <i class="material-icons">edit</i>
      </button>
      <button class="delete-btn btn red" data-id="${docSnap.id}">
        <i class="material-icons">delete</i>
      </button>
    </td>
  </tr>
`);
      });

      let totalLabel1 = "Total Stocks";
      let totalDisplay1 = totalStocks;

      if (selectedCategory && selectedCategory !== "all") {
        const categoryDoc = await getDoc(
          doc(db, "categoriesINV", selectedCategory),
        );

        if (categoryDoc.exists()) {
          const unitType = categoryDoc.data().unit_type;

          if (unitType === "pack") {
            totalLabel1 = "Total Pieces";
            totalDisplay1 = `${totalStocks} pcs`;
          } else if (unitType === "kg") {
            totalLabel1 = "Total Weight";
            totalDisplay1 = `${(totalStocks * 2.2).toFixed(2)} lb`;
          } else if (unitType === "liter") {
            totalLabel1 = "Total Volume";
            totalDisplay1 = `${totalStocks} L`;
          } else {
            totalLabel1 = "Total Quantity";
            totalDisplay1 = totalStocks;
          }
        }
      } else {
        const parts = [];
        if (unitTotals.pack) parts.push(`${unitTotals.pack} pcs`);
        if (unitTotals.kg) parts.push(`${unitTotals.kg} kg`);
        if (unitTotals.liter) parts.push(`${unitTotals.liter} L`);
        if (unitTotals.other) parts.push(`${unitTotals.other} qty`);

        totalLabel1 = "Total Stocks";
        totalDisplay1 = parts.length ? parts.join(" • ") : "0";
      }

      const totalProductsEl = document.getElementById("total-products");
      const stocksLabelEl = document.getElementById("stocks-label");
      const totalStocksEl = document.getElementById("total-stocks");
      const totalValueEl = document.getElementById("total-value");
      const totalCategoriesEl = document.getElementById("total-categories");

      if (totalProductsEl) totalProductsEl.textContent = totalProducts;
      if (stocksLabelEl) stocksLabelEl.textContent = totalLabel1;
      if (totalStocksEl) totalStocksEl.textContent = totalDisplay1;
      if (totalValueEl) totalValueEl.textContent = `₱${totalValue.toFixed(2)}`;
      if (totalCategoriesEl) totalCategoriesEl.textContent = categories.size;

      inventoryRowsCache = rowsHtml;
      renderInventoryPage();
    },
  );

  return unsubscribeInventory;
}

// Renders only the current page's slice of inventoryRowsCache.
function renderInventoryPage() {
  const tbodyNow = document.getElementById("inventory-table-body");
  if (!tbodyNow) return;

  const totalPages = Math.max(
    1,
    Math.ceil(inventoryRowsCache.length / PAGE_SIZE),
  );
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageRows = inventoryRowsCache.slice(start, start + PAGE_SIZE);

  tbodyNow.innerHTML = pageRows.join("");

  bindInventoryRowButtons();
  updateInventoryPagination(totalPages);
}

function updateInventoryPagination(totalPages) {
  const prevBtn = document.getElementById("inventory-prev");
  const nextBtn = document.getElementById("inventory-next");
  const pageLabel = document.getElementById("inventory-page");
  const infoLabel = document.getElementById("inventory-info");

  // Kung wala ang pagination buttons, huwag ituloy
  if (!prevBtn || !nextBtn) return;

  prevBtn.disabled = currentPage === 1;
  nextBtn.disabled = currentPage === totalPages;

  if (pageLabel) {
    pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;
  }

  prevBtn.onclick = () => {
    if (currentPage > 1) {
      currentPage--;
      renderInventoryPage();
    }
  };

  nextBtn.onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderInventoryPage();
    }
  };

  if (infoLabel) {
    const totalRecords = inventoryRowsCache.length;

    if (totalRecords === 0) {
      infoLabel.textContent = "Showing: 0 Inventory data records";
    } else {
      const start = (currentPage - 1) * PAGE_SIZE + 1;

      const end = Math.min(currentPage * PAGE_SIZE, totalRecords);

      infoLabel.textContent = `Showing: ${totalRecords} Inventory data records`;
    }
  }
}

// Delete/edit button logic — rebound every time a page is rendered.
function bindInventoryRowButtons() {
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = e.target.closest("button").dataset.id;
      await deleteProduct(id);
    };
  });

  document.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = e.target.closest("button").dataset.id;
      const row = e.target.closest("tr");

      const editNameInput = document.getElementById("edit-name");
      const editCategoryInput = document.getElementById("edit-category");
      const editPacksInput = document.getElementById("edit-packs");
      const editPriceInput = document.getElementById("edit-price");
      if (
        !editNameInput ||
        !editCategoryInput ||
        !editPacksInput ||
        !editPriceInput
      ) {
        return;
      }

      editNameInput.value = row.children[0].textContent;
      editCategoryInput.value = row.dataset.categoryId;
      editPacksInput.value = row.children[2].textContent.replace(/\D/g, "");
      editPriceInput.value = row.children[4].textContent.replace("₱", "");

      bindLiveUppercase(editNameInput);

      const selects = document.querySelectorAll("select");
      if (selects.length) M.FormSelect.init(selects);

      const productSnapForEdit = await getDoc(doc(db, "inventory", id));
      const productDataForEdit = productSnapForEdit.exists()
        ? productSnapForEdit.data()
        : {};

      const editPlasticColorInput =
        document.getElementById("edit-plastic-color");
      if (editPlasticColorInput) {
        editPlasticColorInput.value = productDataForEdit.plasticColor || "";
        bindLiveUppercase(editPlasticColorInput);
      }

      const editCategoryDoc = productDataForEdit.category_id
        ? await getDoc(doc(db, "categoriesINV", productDataForEdit.category_id))
        : null;

      if (editCategoryDoc && editCategoryDoc.exists()) {
        applyCategoryDependentFields(editCategoryDoc.data(), {
          qtyLabel: document.querySelector('label[for="edit-packs"]'),
          qtyInput: document.getElementById("edit-packs"),
          plasticColorField: document.getElementById(
            "edit-plastic-color-field",
          ),
          plasticColorInput: editPlasticColorInput,
        });
      }
      M.updateTextFields();

      editCategoryInput.onchange = async (e) => {
        const newCategoryDoc = await getDoc(
          doc(db, "categoriesINV", e.target.value),
        );
        if (!newCategoryDoc.exists()) return;

        applyCategoryDependentFields(newCategoryDoc.data(), {
          qtyLabel: document.querySelector('label[for="edit-packs"]'),
          qtyInput: document.getElementById("edit-packs"),
          plasticColorField: document.getElementById(
            "edit-plastic-color-field",
          ),
          plasticColorInput: document.getElementById("edit-plastic-color"),
        });
        M.updateTextFields();
      };

      const modalElem = document.getElementById("modal-edit");
      if (!modalElem) return;
      const modalInstance = M.Modal.init(modalElem);
      modalInstance.open();

      const saveBtn = document.getElementById("edit-save");
      if (!saveBtn) return;
      saveBtn.onclick = async () => {
        const newName = toUpper(editNameInput.value);
        const newCategoryId = editCategoryInput.value;
        const newQuantity = parseFloat(editPacksInput.value);
        const newPrice = parseFloat(editPriceInput.value);
        const newPlasticColorEl = document.getElementById("edit-plastic-color");
        const newPlasticColor = newPlasticColorEl
          ? toUpper(newPlasticColorEl.value)
          : "";

        const categoryDoc = await getDoc(
          doc(db, "categoriesINV", newCategoryId),
        );
        const categoryData = categoryDoc.data();
        const unitType = categoryData.unit_type;
        const piecesPerPack = categoryData.pieces_per_pack || 1;

        let newStock =
          unitType === "pack" ? newQuantity * piecesPerPack : newQuantity;
        const newTotalValue = newStock * newPrice;

        const updateData = {
          product_name: newName,
          category_id: newCategoryId,
          category: categoryData.name,
          role: categoryData.role,
          unit_type: unitType,
          quantity: newQuantity,
          stock_quantity: newStock,
          unit_price: newPrice,
          total_value: newTotalValue,
          last_updated: serverTimestamp(),
        };

        if (categoryData.name.toLowerCase() === "pares" && newPlasticColor) {
          updateData.plasticColor = newPlasticColor;
        } else {
          updateData.plasticColor = deleteField();
        }

        await updateDoc(doc(db, "inventory", id), updateData);
        M.toast({
          html: "Product updated successfully!",
          classes: "green rounded",
        });
        modalInstance.close();
      };
    };
  });
}

export function stopLoadingInventory() {
  if (unsubscribeInventory) {
    unsubscribeInventory();
    unsubscribeInventory = null;
  }
}

//delete category
export async function deleteCategory(categoryId) {
  if (!categoryId || categoryId == "all") {
    M.toast({ html: "Please select a category", classes: "red rounded" });
    return;
  }

  const q = query(
    collection(db, "inventory"),
    where("category_id", "==", categoryId),
  );

  const result = await getDocs(q);

  if (!result.empty) {
    M.toast({
      html: "Cannot Delete. This Category still contains products.",
      classes: "red rounded",
    });
    return;
  }

  if (
    !(await confirmDeletion(
      "Delete category?",
      "This category will be permanently deleted. You cannot delete a category that still has products.",
    ))
  )
    return;

  await deleteDoc(doc(db, "categoriesINV", categoryId));

  M.toast({ html: "Category Deleted", classes: "green rounded" });
}

export async function addProduct(
  productName,
  categoryId,
  quantity,
  unitPrice,
  plasticColor = "",
  extraFields = {},
) {
  const categoryDoc = await getDoc(doc(db, "categoriesINV", categoryId));
  const categoryData = categoryDoc.data();
  const unitType = categoryDoc.data().unit_type;
  const piecesPerPack = categoryDoc.data().pieces_per_pack || 1;

  let stockQty = 0;
  let totalValue = 0;

  if (unitType === "pack") {
    stockQty = quantity * piecesPerPack;
    totalValue = stockQty * unitPrice;
  } else if (unitType === "kg") {
    stockQty = quantity;
    totalValue = quantity * unitPrice;
  } else if (unitType === "liter") {
    stockQty = quantity;
    totalValue = quantity * unitPrice;
  } else {
    stockQty = quantity;
    totalValue = quantity * unitPrice;
  }

  const normalizedProductName = toUpper(productName);
  const normalizedPlasticColor = toUpper(plasticColor);

  const dupQuery = query(
    collection(db, "inventory"),
    where("category_id", "==", categoryId),
    where("product_name", "==", normalizedProductName),
  );
  const dupResult = await getDocs(dupQuery);
  if (!dupResult.empty) {
    M.toast({
      html: "Product already exists in this category.",
      classes: "red rounded",
    });
    return;
  }

  const productData = {
    product_name: normalizedProductName,
    category_id: categoryId,
    category: categoryData.name,
    role: categoryData.role,
    unit_type: unitType,
    quantity: quantity,
    stock_quantity: stockQty,
    unit_price: unitPrice,
    total_value: totalValue,
    status: "Available",
    created_at: serverTimestamp(),
    last_updated: serverTimestamp(),
  };

  if (normalizedPlasticColor) {
    productData.plasticColor = normalizedPlasticColor;
  }

  if (extraFields && Object.keys(extraFields).length) {
    Object.assign(productData, extraFields);
  }

  await addDoc(collection(db, "inventory"), productData);
  M.toast({
    html: "New product added successfully!",
    classes: "green rounded",
  });
}

export async function deleteProduct(id) {
  const linkedMenuQuery = query(
    collection(db, "productMenu"),
    where("inventory_id", "==", id), // FIXED: may id na
  );
  const linkedMenuSnap = await getDocs(linkedMenuQuery);
  if (!linkedMenuSnap.empty) {
    M.toast({
      html: "Cannot archive: this item is still linked to Product Menu entries. Delete those first.",
      classes: "red rounded",
    });
    return;
  }

  if (
    !(await confirmDeletion(
      "Archive product?",
      "This product will be moved to Archive. You can recover it within 7 days.",
    ))
  )
    return;

  const productRef = doc(db, "inventory", id);
  const productSnap = await getDoc(productRef);
  if (!productSnap.exists()) {
    M.toast({ html: "Product not found.", classes: "red rounded" });
    return;
  }

  const data = productSnap.data();
  await addDoc(collection(db, "archivedInventory"), {
    ...data,
    original_id: id,
    archived_at: serverTimestamp(),
    archived_by: "Manager",
  });
  await deleteDoc(productRef);

  M.toast({
    html: "Product archived. Recoverable for 7 days.",
    classes: "green rounded",
  });
}

// ==================== CATEGORIES ==================== //
export function loadCategories() {
  const selects = document.querySelectorAll(
    "#product-category, #edit-category, #menu-product-category",
  );
  const pillsContainer = document.getElementById("filter-category-pills");

  bindDeleteCategoryButton();
  bindAddCategoryButton();

  if (unsubscribeCategories) {
    unsubscribeCategories();
    unsubscribeCategories = null;
  }

  unsubscribeCategories = onSnapshot(
    collection(db, "categoriesINV"),
    (snapshot) => {
      const pillsContainerNow = document.getElementById(
        "filter-category-pills",
      );
      const selectsNow = document.querySelectorAll(
        "#product-category, #edit-category, #menu-product-category",
      );

      if (!pillsContainerNow && selectsNow.length === 0) {
        if (unsubscribeCategories) {
          unsubscribeCategories();
          unsubscribeCategories = null;
        }
        return;
      }

      categoryNameMap = {};
      snapshot.forEach((docSnap) => {
        categoryNameMap[docSnap.id] = docSnap.data().name;
      });

      selectsNow.forEach((sel) => {
        sel.innerHTML = `<option value="" disabled selected>Choose Category</option>`;

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const option = document.createElement("option");
          option.value = docSnap.id;
          option.textContent = data.name;
          option.dataset.unitType = data.unit_type;
          option.dataset.piecesPerPack = data.pieces_per_pack || 1;
          sel.appendChild(option);
        });
      });

      if (selectsNow.length) M.FormSelect.init(selectsNow);

      if (pillsContainerNow) {
        renderCategoryPills(pillsContainerNow, snapshot);
      }
    },
  );
}

export function stopLoadingCategories() {
  if (unsubscribeCategories) {
    unsubscribeCategories();
    unsubscribeCategories = null;
  }
}

function renderCategoryPills(container, snapshot) {
  container.innerHTML = "";

  const allPill = document.createElement("button");
  allPill.type = "button";
  allPill.className =
    "category-pill" + (selectedCategoryFilter === "all" ? " active" : "");
  allPill.textContent = "All Categories";
  allPill.dataset.id = "all";
  allPill.onclick = () => selectCategoryPill("all");
  container.appendChild(allPill);

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();

    const pill = document.createElement("button");
    pill.type = "button";
    pill.className =
      "category-pill" +
      (selectedCategoryFilter === docSnap.id ? " active" : "");
    pill.textContent = data.name;
    pill.dataset.id = docSnap.id;
    pill.onclick = () => selectCategoryPill(docSnap.id);
    container.appendChild(pill);
  });

  syncDeleteCategoryButtonState();
}

function selectCategoryPill(categoryId) {
  selectedCategoryFilter = categoryId;
  currentPage = 1;

  document.querySelectorAll(".category-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.id === categoryId);
  });

  syncDeleteCategoryButtonState();
  loadInventory();
}

function syncDeleteCategoryButtonState() {
  const deleteBtn = document.getElementById("delete-category-btn");
  if (deleteBtn) {
    deleteBtn.disabled = selectedCategoryFilter === "all";
  }
}

function bindDeleteCategoryButton() {
  const deleteBtn = document.getElementById("delete-category-btn");
  if (!deleteBtn) return;

  deleteBtn.onclick = async () => {
    if (selectedCategoryFilter === "all") return;
    await deleteCategory(selectedCategoryFilter);
  };
}

function bindSaveCategoryButton() {
  const saveCategoryBtn = document.getElementById("save-category");
  if (!saveCategoryBtn) return;

  saveCategoryBtn.onclick = async () => {
    const nameInput = document.getElementById("new-category-name");
    const roleInput = document.getElementById("category-role");
    const unitInput = document.getElementById("new-category-unit");
    const piecesInput = document.getElementById("pieces-per-pack");
    if (!nameInput || !roleInput || !unitInput || !piecesInput) return;

    const name = toUpper(nameInput.value);
    const role = roleInput.value;
    const unitType = unitInput.value;
    const piecesPerPack = piecesInput.value;

    if (!name || !unitType) {
      M.toast({
        html: "Please enter name and unit type",
        classes: "red rounded",
      });
      return;
    }

    const dupQuery = query(
      collection(db, "categoriesINV"),
      where("name", "==", name),
    );
    const dupResult = await getDocs(dupQuery);
    if (!dupResult.empty) {
      M.toast({
        html: "Category already exists.",
        classes: "red rounded",
      });
      return;
    }

    const categoryData = { name, role, unit_type: unitType };
    if (unitType === "pack" && piecesPerPack) {
      categoryData.pieces_per_pack = parseInt(piecesPerPack);
    }

    await addDoc(collection(db, "categoriesINV"), categoryData);
    M.toast({ html: "Category added!", classes: "green rounded" });

    nameInput.value = "";
    unitInput.value = "";
    piecesInput.value = "";

    const modalElem = document.getElementById("modal-add-category");
    if (modalElem) {
      const modalInstance = M.Modal.getInstance(modalElem);
      if (modalInstance) modalInstance.close();
    }

    roleInput.selectedIndex = 0;

    const selects = document.querySelectorAll("select");
    if (selects.length) M.FormSelect.init(selects);
  };
}

// ==================== FILTERS ==================== //
function bindFilterDateInput() {
  const filterDateInput = document.getElementById("filter-date");
  if (!filterDateInput) return;

  filterDateInput.onchange = () => {
    currentPage = 1;
    loadInventory();
  };
}

function bindNewCategoryUnitSelect() {
  const newCategoryUnitSelect = document.getElementById("new-category-unit");
  if (!newCategoryUnitSelect) return;

  newCategoryUnitSelect.onchange = (e) => {
    const field = document.getElementById("pieces-per-pack-field");
    if (!field) return;
    if (e.target.value === "pack") {
      field.style.display = "block";
    } else {
      field.style.display = "none";
    }
    const selects = document.querySelectorAll("select");
    if (selects.length) M.FormSelect.init(selects);
  };
}

function bindAddCategoryButton() {
  const addCategoryBtn = document.getElementById("btn-add-categories");
  if (!addCategoryBtn) return;

  addCategoryBtn.onclick = async () => {
    await loadRoles();

    const modalElem = document.getElementById("modal-add-category");
    if (!modalElem) return;

    const modalInstance = M.Modal.init(modalElem, {
      onOpenEnd() {
        const selects = document.querySelectorAll("select");
        if (selects.length) M.FormSelect.init(selects);
      },

      onCloseEnd() {
        const nameInput = document.getElementById("new-category-name");
        const piecesInput = document.getElementById("pieces-per-pack");
        const roleInput = document.getElementById("category-role");
        const unitInput = document.getElementById("new-category-unit");
        const piecesField = document.getElementById("pieces-per-pack-field");

        if (nameInput) nameInput.value = "";
        if (piecesInput) piecesInput.value = "";
        if (roleInput) roleInput.selectedIndex = 0;
        if (unitInput) unitInput.selectedIndex = 0;
        if (piecesField) piecesField.style.display = "none";

        M.updateTextFields();
        const selects = document.querySelectorAll("select");
        if (selects.length) M.FormSelect.init(selects);
      },
    });

    modalInstance.open();
  };
}

function applyCategoryDependentFields(categoryData, els) {
  const { qtyLabel, qtyInput, plasticColorField, plasticColorInput } = els;
  const unitType = categoryData.unit_type;
  const piecesPerPack = categoryData.pieces_per_pack || 1;
  const categoryName = categoryData.name || "";

  if (qtyLabel && qtyInput) {
    if (unitType === "pack") {
      qtyLabel.textContent = `Number of Packs (×${piecesPerPack} pieces each)`;
      qtyInput.placeholder = "Enter number of packs";
    } else if (unitType === "kg") {
      qtyLabel.textContent = "Weight (in kilograms)";
      qtyInput.placeholder = "Enter weigh in kg";
    } else if (unitType === "liter") {
      qtyLabel.textContent = "Volume (L)";
      qtyInput.placeholder = "Enter Liters";
    } else {
      qtyLabel.textContent = "Quantity";
      qtyInput.placeholder = "Enter quantity";
    }
  }

  if (plasticColorField) {
    if (categoryName.toLowerCase() === "pares") {
      plasticColorField.style.display = "block";
    } else {
      plasticColorField.style.display = "none";
      if (plasticColorInput) plasticColorInput.value = "";
    }
  }
}

function bindProductCategorySelect() {
  const productCategorySelect = document.getElementById("product-category");
  if (!productCategorySelect) return;

  productCategorySelect.onchange = async (e) => {
    const categoryId = e.target.value;
    if (!categoryId) return;

    const categoryDoc = await getDoc(doc(db, "categoriesINV", categoryId));
    const categoryData = categoryDoc.data();

    applyCategoryDependentFields(categoryData, {
      qtyLabel: document.querySelector('label[for="product-packs"]'),
      qtyInput: document.getElementById("product-packs"),
      plasticColorField: document.getElementById("product-plastic-color-field"),
      plasticColorInput: document.getElementById("product-plastic-color"),
    });

    M.updateTextFields();
  };
}

function bindInventoryPageButtons() {
  bindSaveCategoryButton();
  bindFilterDateInput();
  bindNewCategoryUnitSelect();
  bindProductCategorySelect();
  bindArchiveHistoryButtons(); // ← ADD THIS

  bindLiveUppercase(document.getElementById("new-category-name"));
  bindLiveUppercase(document.getElementById("product-plastic-color"));
}

export async function loadRoles() {
  const roleSelect = document.getElementById("category-role");

  if (!roleSelect) return;

  const snap = await getDocs(collection(db, "employees"));

  const roles = new Set();

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.role) {
      roles.add(data.role.trim());
    }
  });

  roleSelect.innerHTML = `<option value="" disabled selected>Choose Role</option>`;

  roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    roleSelect.appendChild(option);
  });

  M.FormSelect.init(roleSelect);
}

// ARCHIVE/PRODUCT
const ARCHIVE_DAYS = 7;

function daysSince(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") return Infinity;
  const ms = Date.now() - timestamp.toDate().getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24)); // IMPORTANT: 1000 not 100
}

async function moveArchiveToHistory(archiveId, data) {
  const { original_id, archived_at, archived_by, ...productData } = data;
  await addDoc(collection(db, "productHistory"), {
    ...productData,
    original_id: original_id || null,
    archived_at: archived_at || null,
    permanently_removed_at: serverTimestamp(),
    archived_by: archived_by || "Manager",
  });
  await deleteDoc(doc(db, "archivedInventory", archiveId));
}

export async function processExpiredArchives() {
  try {
    const snap = await getDocs(collection(db, "archivedInventory"));
    let moved = 0;
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      if (daysSince(data.archived_at) > ARCHIVE_DAYS) {
        await moveArchiveToHistory(docSnap.id, data);
        moved++;
      }
    }
    if (moved > 0) {
      M.toast({
        html: `${moved} expired archive(s) moved to Product History.`,
        classes: "blue rounded",
      });
    }
  } catch (err) {
    console.error("processExpiredArchives error:", err);
  }
}

export async function recoverArchivedProduct(archiveId) {
  const archiveRef = doc(db, "archivedInventory", archiveId);
  const snap = await getDoc(archiveRef);
  if (!snap.exists()) {
    M.toast({ html: "Archived item not found.", classes: "red rounded" });
    return;
  }

  const data = snap.data();
  const age = daysSince(data.archived_at);
  if (age > ARCHIVE_DAYS) {
    M.toast({
      html: "Recovery period expired. Moving to Product History.",
      classes: "red rounded",
    });
    await moveArchiveToHistory(archiveId, data); // FIXED: was archiveId.data
    return;
  }

  const { original_id, archived_at, archived_by, ...productData } = data;

  const dupQuery = query(
    collection(db, "inventory"),
    where("category_id", "==", productData.category_id),
    where("product_name", "==", productData.product_name),
  );
  const dupResult = await getDocs(dupQuery);
  if (!dupResult.empty) {
    M.toast({
      html: "Cannot recover: same product name already exists in this category.",
      classes: "red rounded",
    });
    return;
  }

  await addDoc(collection(db, "inventory"), {
    ...productData,
    last_updated: serverTimestamp(),
    status: productData.quantity <= 0 ? "On Selling" : "Available",
  });
  await deleteDoc(archiveRef);

  M.toast({
    html: "Product recovered to Inventory!",
    classes: "green rounded",
  });
}

// ---------- Archive History ----------
let unsubscribeArchive = null;
let archiveRowsCache = [];
let archiveCurrentPage = 1;

export function loadArchiveHistory() {
  const tbody = document.getElementById("archive-table-body");
  if (!tbody) {
    console.warn("archive-table-body not found");
    return;
  }

  if (unsubscribeArchive) {
    unsubscribeArchive();
    unsubscribeArchive = null;
  }

  processExpiredArchives().catch(console.error);

  unsubscribeArchive = onSnapshot(
    collection(db, "archivedInventory"), // FIXED spelling
    (querySnapshot) => {
      const tbodyNow = document.getElementById("archive-table-body");
      if (!tbodyNow) {
        if (unsubscribeArchive) {
          unsubscribeArchive();
          unsubscribeArchive = null;
        }
        return;
      }

      const rowsHtml = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const age = daysSince(data.archived_at);
        const canRecover = age <= ARCHIVE_DAYS;
        const daysLeft = Math.max(0, ARCHIVE_DAYS - age);

        const dateArchived = data.archived_at
          ? data.archived_at.toDate().toLocaleDateString("en-PH", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "-";

        let totalDisplay = "";
        if (data.unit_type === "pack") {
          totalDisplay = `${data.stock_quantity} pcs`;
        } else if (data.unit_type === "kg") {
          totalDisplay = `${(data.quantity * 2.2).toFixed(2)} lb`;
        } else if (data.unit_type === "liter") {
          totalDisplay = `${data.quantity} L`;
        } else {
          totalDisplay = `${data.stock_quantity ?? 0}`;
        }

        rowsHtml.push(`
          <tr>
            <td>${data.product_name || "-"}${
              data.plasticColor
                ? ` <span class="plastic-color-badge">(${data.plasticColor} Plastic)</span>`
                : ""
            }</td>
            <td>${data.category || "-"}</td>
            <td>${data.quantity ?? 0} ${data.unit_type || ""}</td>
            <td>${totalDisplay}</td>
            <td>₱${(data.unit_price || 0).toFixed(2)}</td>
            <td>₱${(data.total_value || 0).toFixed(2)}</td>
            <td>${dateArchived}</td>
            <td>
              <span class="status ${canRecover ? "available" : "low-stock"}">
                ${canRecover ? `${daysLeft} day(s) left` : "Expired"}
              </span>
            </td>
            <td>
              ${
                canRecover
                  ? `<button class="recover-btn btn green waves-effect" data-id="${docSnap.id}" title="Recover">
                       <i class="material-icons">restore</i>
                     </button>`
                  : `<button class="btn grey" disabled title="Expired">
                       <i class="material-icons">block</i>
                     </button>`
              }
            </td>
          </tr>
        `);
      });

      archiveRowsCache = rowsHtml;
      archiveCurrentPage = 1;
      renderArchivePage();
    },
  );
}

function renderArchivePage() {
  const tbody = document.getElementById("archive-table-body");
  if (!tbody) return;

  const totalPages = Math.max(
    1,
    Math.ceil(archiveRowsCache.length / PAGE_SIZE),
  );
  if (archiveCurrentPage > totalPages) archiveCurrentPage = totalPages;
  if (archiveCurrentPage < 1) archiveCurrentPage = 1;

  const start = (archiveCurrentPage - 1) * PAGE_SIZE;
  const pageRows = archiveRowsCache.slice(start, start + PAGE_SIZE);

  tbody.innerHTML =
    pageRows.join("") ||
    `<tr><td colspan="9" class="center-align grey-text">No archived products</td></tr>`;

  document.querySelectorAll(".recover-btn").forEach((btn) => {
    btn.onclick = async (e) => {
      const id = e.target.closest("button").dataset.id;
      const ok = await confirmRecover(); // ← bagong modal
      if (ok) await recoverArchivedProduct(id);
    };
  });

  const prev = document.getElementById("archive-prev");
  const next = document.getElementById("archive-next");
  const pageLabel = document.getElementById("archive-page");
  const infoLabel = document.getElementById("archive-info");

  if (prev && next) {
    prev.disabled = archiveCurrentPage === 1;
    next.disabled = archiveCurrentPage === totalPages;
    if (pageLabel) {
      pageLabel.textContent = `Page ${archiveCurrentPage} of ${totalPages}`;
      pageLabel.style.display = "inline";
    }
    prev.onclick = () => {
      if (archiveCurrentPage > 1) {
        archiveCurrentPage--;
        renderArchivePage();
      }
    };
    next.onclick = () => {
      if (archiveCurrentPage < totalPages) {
        archiveCurrentPage++;
        renderArchivePage();
      }
    };
  }

  if (infoLabel) {
    infoLabel.textContent =
      archiveRowsCache.length === 0
        ? "0 archived"
        : `${archiveRowsCache.length} archived item(s)`;
  }
}

export function stopLoadingArchive() {
  if (unsubscribeArchive) {
    unsubscribeArchive();
    unsubscribeArchive = null;
  }
}

// ---------- Product History ----------
let unsubscribeHistory = null;
let historyRowsCache = [];
let historyCurrentPage = 1;

export function loadProductHistory() {
  const tbody = document.getElementById("history-table-body");
  if (!tbody) {
    console.warn("history-table-body not found");
    return;
  }

  if (unsubscribeHistory) {
    unsubscribeHistory();
    unsubscribeHistory = null;
  }

  unsubscribeHistory = onSnapshot(
    collection(db, "productHistory"),
    (querySnapshot) => {
      const tbodyNow = document.getElementById("history-table-body");
      if (!tbodyNow) {
        if (unsubscribeHistory) {
          unsubscribeHistory();
          unsubscribeHistory = null;
        }
        return;
      }

      const rowsHtml = [];
      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const dateRemoved = data.permanently_removed_at
          ? data.permanently_removed_at.toDate().toLocaleDateString("en-PH", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "-";
        const dateArchived = data.archived_at
          ? data.archived_at.toDate().toLocaleDateString("en-PH", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })
          : "-";

        let totalDisplay = "";
        if (data.unit_type === "pack") {
          totalDisplay = `${data.stock_quantity} pcs`;
        } else if (data.unit_type === "kg") {
          totalDisplay = `${(data.quantity * 2.2).toFixed(2)} lb`;
        } else if (data.unit_type === "liter") {
          totalDisplay = `${data.quantity} L`;
        } else {
          totalDisplay = `${data.stock_quantity ?? 0}`;
        }

        rowsHtml.push(`
          <tr>
            <td>${data.product_name || "-"}${
              data.plasticColor
                ? ` <span class="plastic-color-badge">(${data.plasticColor} Plastic)</span>`
                : ""
            }</td>
            <td>${data.category || "-"}</td>
            <td>${data.quantity ?? 0} ${data.unit_type || ""}</td>
            <td>${totalDisplay}</td>
            <td>₱${(data.unit_price || 0).toFixed(2)}</td>
            <td>₱${(data.total_value || 0).toFixed(2)}</td>
            <td>${dateArchived}</td>
            <td>${dateRemoved}</td>
          </tr>
        `);
      });

      historyRowsCache = rowsHtml;
      historyCurrentPage = 1;
      renderHistoryPage();
    },
  );
}

function renderHistoryPage() {
  const tbody = document.getElementById("history-table-body");
  if (!tbody) return;

  const totalPages = Math.max(
    1,
    Math.ceil(historyRowsCache.length / PAGE_SIZE),
  );
  if (historyCurrentPage > totalPages) historyCurrentPage = totalPages;
  if (historyCurrentPage < 1) historyCurrentPage = 1;

  const start = (historyCurrentPage - 1) * PAGE_SIZE;
  const pageRows = historyRowsCache.slice(start, start + PAGE_SIZE);

  tbody.innerHTML =
    pageRows.join("") ||
    `<tr><td colspan="8" class="center-align grey-text">No permanent product history yet</td></tr>`;

  const prev = document.getElementById("history-prev");
  const next = document.getElementById("history-next");
  const pageLabel = document.getElementById("history-page");
  const infoLabel = document.getElementById("history-info");

  if (prev && next) {
    prev.disabled = historyCurrentPage === 1;
    next.disabled = historyCurrentPage === totalPages;
    if (pageLabel) {
      pageLabel.textContent = `Page ${historyCurrentPage} of ${totalPages}`;
      pageLabel.style.display = "inline";
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
    infoLabel.textContent =
      historyRowsCache.length === 0
        ? "0 records"
        : `${historyRowsCache.length} record(s)`;
  }
}

export function stopLoadingHistory() {
  if (unsubscribeHistory) {
    unsubscribeHistory();
    unsubscribeHistory = null;
  }
}

function bindArchiveHistoryButtons() {
  const archiveBtn = document.getElementById("btn-archive-history");
  if (archiveBtn) {
    archiveBtn.onclick = () => {
      const modalEl = document.getElementById("modal-archive-history");
      if (!modalEl) {
        console.error("modal-archive-history not found");
        return;
      }
      let instance = M.Modal.getInstance(modalEl);
      if (!instance) {
        instance = M.Modal.init(modalEl, {
          dismissible: true,
          onCloseEnd() {
            stopLoadingArchive();
          },
        });
      }
      loadArchiveHistory();
      instance.open();
    };
  } else {
    console.warn("btn-archive-history not found");
  }

  const historyBtn = document.getElementById("btn-product-history");
  if (historyBtn) {
    historyBtn.onclick = () => {
      const modalEl = document.getElementById("modal-product-history");
      if (!modalEl) {
        console.error("modal-product-history not found");
        return;
      }
      let instance = M.Modal.getInstance(modalEl);
      if (!instance) {
        instance = M.Modal.init(modalEl, {
          dismissible: true,
          onCloseEnd() {
            stopLoadingHistory();
          },
        });
      }
      loadProductHistory();
      instance.open();
    };
  } else {
    console.warn("btn-product-history not found");
  }
}


export async function initInventoryPage() {
  currentPage = 1;
  processExpiredArchives().catch(console.error); // ← ADD THIS
  loadInventory();
  loadCategories();
  bindInventoryPageButtons();
}

export function stopInventoryPage() {
  stopLoadingInventory();
  stopLoadingCategories();
}
