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

// Kasalukuyang napiling category pill ("all" o isang categoriesINV doc id).
let selectedCategoryFilter = "all";

// Nagma-map ng categoriesINV doc id papunta sa pangalan ng category.
let categoryNameMap = {};

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

export function loadInventory() {
  const tbody = document.getElementById("inventory-table-body");
  const dateInput = document.getElementById("filter-date");

  // Isang listener lang dapat ang kumokontrol sa table na ito.
  if (unsubscribeInventory) {
    unsubscribeInventory();
  }

  unsubscribeInventory = onSnapshot(
    collection(db, "inventory"),
    async (querySnapshot) => {
      tbody.innerHTML = "";

      let totalProducts = 0;
      let totalStocks = 0;
      let totalValue = 0;
      const categories = new Set();

      // Magkaiba ang unit types (pcs/kg/L) kaya hiwalay ang pag-total per type.
      const unitTotals = { pack: 0, kg: 0, liter: 0, other: 0 };

      const selectedCategory = selectedCategoryFilter;
      const selectedDate = dateInput.value;

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

        // Kapag pasado sa filter, saka lang magre-render

        totalProducts++;
        totalStocks += data.stock_quantity;
        totalValue += data.total_value;
        categories.add(data.category);

        const bucket =
          data.unit_type === "pack" || data.unit_type === "kg" || data.unit_type === "liter"
            ? data.unit_type
            : "other";
        unitTotals[bucket] += data.stock_quantity;

        //status
        let status = "Available";
        // Optional na per-product override mula sa Add Product Menu page.
        const lowStockThreshold = data.low_stock_threshold || 25;

        if (data.quantity <= 0) {
          status = "On Selling";
        } else if (data.stock_quantity <= lowStockThreshold) {
          status = "Low Stock";
        }

        //  Dinamikong display para sa quantity at total pieces
        const displayQty =
          data.unit_type === "pack"
            ? `${data.quantity} packs`
            : `${data.quantity} ${data.unit_type}`;

        const totalPiecesDisplay =
          data.unit_type === "pack"
            ? `${data.stock_quantity} pcs`
            : data.unit_type === "kg"
              ? `${data.quantity} kg`
              : `${data.stock_quantity}`;

        // Alamin ang label at value base sa unit type
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
          const vol = "Total Volume";
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

        // I-render ang row
        tbody.innerHTML += `
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
`;
      });

      //para sa summary card ng total quantity
      let totalLabel1 = "Total Stocks";
      let totalDisplay1 = totalStocks;

      //kung may specific category na napili, i-adjust ang label base sa unit type
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
        // Sa "All Categories" view, ipapakita ang breakdown dahil magkaiba ang units.
        const parts = [];
        if (unitTotals.pack) parts.push(`${unitTotals.pack} pcs`);
        if (unitTotals.kg) parts.push(`${unitTotals.kg} kg`);
        if (unitTotals.liter) parts.push(`${unitTotals.liter} L`);
        if (unitTotals.other) parts.push(`${unitTotals.other} qty`);

        totalLabel1 = "Total Stocks";
        totalDisplay1 = parts.length ? parts.join(" • ") : "0";
      }

      // I-update ang summary cards
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

      // Logic ng delete button
      document.querySelectorAll(".delete-btn").forEach((btn) => {
        btn.onclick = async (e) => {
          const id = e.target.closest("button").dataset.id;
          await deleteProduct(id);
        };
      });

      // Logic ng edit button
      document.querySelectorAll(".edit-btn").forEach((btn) => {
        btn.onclick = async (e) => {
          const id = e.target.closest("button").dataset.id;
          const row = e.target.closest("tr");

          document.getElementById("edit-name").value =
            row.children[0].textContent;
          document.getElementById("edit-category").value =
            row.dataset.categoryId; //  doc ID
          document.getElementById("edit-packs").value =
            row.children[2].textContent.replace(/\D/g, "");
          document.getElementById("edit-price").value =
            row.children[4].textContent.replace("₱", "");

          M.FormSelect.init(document.querySelectorAll("select"));

          // Prefill at toggle ang quantity label at plastic color field base sa category.
          const productSnapForEdit = await getDoc(doc(db, "inventory", id));
          const productDataForEdit = productSnapForEdit.exists()
            ? productSnapForEdit.data()
            : {};

          const editPlasticColorInput = document.getElementById(
            "edit-plastic-color",
          );
          if (editPlasticColorInput) {
            editPlasticColorInput.value = productDataForEdit.plasticColor || "";
          }

          const editCategoryDoc = productDataForEdit.category_id
            ? await getDoc(doc(db, "categoriesINV", productDataForEdit.category_id))
            : null;

          if (editCategoryDoc && editCategoryDoc.exists()) {
            applyCategoryDependentFields(editCategoryDoc.data(), {
              qtyLabel: document.querySelector('label[for="edit-packs"]'),
              qtyInput: document.getElementById("edit-packs"),
              plasticColorField: document.getElementById("edit-plastic-color-field"),
              plasticColorInput: editPlasticColorInput,
            });
          }
          M.updateTextFields();

          // Live-update ang label/plastic color kapag binago ang category habang nag-e-edit.
          document.getElementById("edit-category").onchange = async (e) => {
            const newCategoryDoc = await getDoc(
              doc(db, "categoriesINV", e.target.value),
            );
            if (!newCategoryDoc.exists()) return;

            applyCategoryDependentFields(newCategoryDoc.data(), {
              qtyLabel: document.querySelector('label[for="edit-packs"]'),
              qtyInput: document.getElementById("edit-packs"),
              plasticColorField: document.getElementById("edit-plastic-color-field"),
              plasticColorInput: document.getElementById("edit-plastic-color"),
            });
            M.updateTextFields();
          };

          const modalElem = document.getElementById("modal-edit");
          const modalInstance = M.Modal.init(modalElem);
          modalInstance.open();

          const saveBtn = document.getElementById("edit-save");
          saveBtn.onclick = async () => {
            const newName = document.getElementById("edit-name").value.trim();
            const newCategoryId =
              document.getElementById("edit-category").value; //  doc ID
            const newQuantity = parseFloat(
              document.getElementById("edit-packs").value,
            );
            const newPrice = parseFloat(
              document.getElementById("edit-price").value,
            );
            const newPlasticColorEl = document.getElementById("edit-plastic-color");
            const newPlasticColor = newPlasticColorEl
              ? newPlasticColorEl.value.trim()
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
              category_id: newCategoryId, //  store doc ID
              category: categoryData.name, //  store readable name
              role: categoryData.role,
              unit_type: unitType,
              quantity: newQuantity,
              stock_quantity: newStock,
              unit_price: newPrice,
              total_value: newTotalValue,
              last_updated: serverTimestamp(),
            };

            // Pares lang pwedeng may plastic color, kaya tinatanggal ito sa ibang category.
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
    },
  );
}

//delete category
export async function deleteCategory(categoryId) {
  if (!categoryId || categoryId == "all") {
    M.toast({ html: "Please select a category", classes: "red rounded" });
    return;
  }

  // check kung ginagamit pa
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

//

// Optional lang ang plasticColor at extraFields, kaya walang epekto sa existing callers.
export async function addProduct(productName, categoryId, quantity, unitPrice, plasticColor = "", extraFields = {}) {
  const categoryDoc = await getDoc(doc(db, "categoriesINV", categoryId));
  const categoryData = categoryDoc.data();
  const unitType = categoryDoc.data().unit_type;
  const piecesPerPack = categoryDoc.data().pieces_per_pack || 1;

  let stockQty = 0;
  let totalValue = 0;

  //formula based on digital timbangan
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

  const productData = {
    product_name: productName,
    category_id: categoryId, // Firestore doc ID
    category: categoryData.name, // readable name
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

  // I-store lang ang field kung may kulay talagang binigay.
  if (plasticColor && plasticColor.trim()) {
    productData.plasticColor = plasticColor.trim();
  }

  // I-merge ang mga optional extra fields mula sa Add Product Menu page.
  if (extraFields && Object.keys(extraFields).length) {
    Object.assign(productData, extraFields);
  }

  await addDoc(collection(db, "inventory"), productData);
  M.toast({
    html: "New product added successfully!",
    classes: "green rounded",
  });
}

// Delete product
export async function deleteProduct(id) {
  if (
    !(await confirmDeletion(
      "Delete product?",
      "This product will be permanently removed from the inventory.",
    ))
  )
    return;

  await deleteDoc(doc(db, "inventory", id));
  M.toast({ html: "Product deleted successfully!", classes: "green rounded" });
}

// ==================== CATEGORIES ==================== //
export function loadCategories() {
  // Pill buttons na ngayon ang filter-category, hindi na select dropdown.
  const selects = document.querySelectorAll(
    "#product-category, #edit-category, #menu-product-category",
  );
  const pillsContainer = document.getElementById("filter-category-pills");

  // Kailangan i-rebind ito kada navigate dahil nade-destroy ang buttons kada innerHTML replace.
  bindDeleteCategoryButton();
  bindAddCategoryButton();

  // Iniiwasan dito ang duplicate listener na naka-bind sa nabura nang DOM elements.
  if (unsubscribeCategories) {
    unsubscribeCategories();
  }

  unsubscribeCategories = onSnapshot(collection(db, "categoriesINV"), (snapshot) => {
    categoryNameMap = {};
    snapshot.forEach((docSnap) => {
      categoryNameMap[docSnap.id] = docSnap.data().name;
    });

    selects.forEach((sel) => {
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

    M.FormSelect.init(selects);

    if (pillsContainer) {
      renderCategoryPills(pillsContainer, snapshot);
    }
  });
}

// I-render ang "All Categories" + isang pill per category, kasama ang click handlers.
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
      "category-pill" + (selectedCategoryFilter === docSnap.id ? " active" : "");
    pill.textContent = data.name;
    pill.dataset.id = docSnap.id;
    pill.onclick = () => selectCategoryPill(docSnap.id);
    container.appendChild(pill);
  });

  syncDeleteCategoryButtonState();
}

// Kapag na-click ang isang pill, ina-update ang state at ire-run ulit ang inventory query.
function selectCategoryPill(categoryId) {
  selectedCategoryFilter = categoryId;

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

// I-save ang category kasama ang unit type + pieces per pack.
// (Kada Inventory page load, tinatawag ito ulit sa bindInventoryPageButtons().)
function bindSaveCategoryButton() {
  const saveCategoryBtn = document.getElementById("save-category");
  if (!saveCategoryBtn) return;

  saveCategoryBtn.onclick = async () => {
    const name = document.getElementById("new-category-name").value.trim();
    const role = document.getElementById("category-role").value;
    const unitType = document.getElementById("new-category-unit").value;
    const piecesPerPack = document.getElementById("pieces-per-pack").value;

    if (!name || !unitType) {
      M.toast({
        html: "Please enter name and unit type",
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

    document.getElementById("new-category-name").value = "";
    document.getElementById("new-category-unit").value = "";
    document.getElementById("pieces-per-pack").value = "";

    const modalElem = document.getElementById("modal-add-category");
    const modalInstance = M.Modal.getInstance(modalElem);
    modalInstance.close();

    document.getElementById("category-role").selectedIndex = 0;

    M.FormSelect.init(document.querySelectorAll("select"));
  };
}

// ==================== FILTERS ==================== //
function bindFilterDateInput() {
  const filterDateInput = document.getElementById("filter-date");
  if (!filterDateInput) return;

  filterDateInput.onchange = () => {
    loadInventory();
  };
}

// I-toggle ang visibility ng pieces-per-pack field.
function bindNewCategoryUnitSelect() {
  const newCategoryUnitSelect = document.getElementById("new-category-unit");
  if (!newCategoryUnitSelect) return;

  newCategoryUnitSelect.onchange = (e) => {
    const field = document.getElementById("pieces-per-pack-field");
    if (e.target.value === "pack") {
      field.style.display = "block";
    } else {
      field.style.display = "none";
    }
    // I-reinitialize ang select para maayos ang posisyon ng dropdown
    M.FormSelect.init(document.querySelectorAll("select"));
  };
}

// Dropdown ng "Add Category" modal, kinakabit ulit dito kada page load para hindi mawala ang click handler.
function bindAddCategoryButton() {
  const addCategoryBtn = document.getElementById("btn-add-categories");
  if (!addCategoryBtn) return;

  addCategoryBtn.onclick = async () => {
    await loadRoles();

    const modalElem = document.getElementById("modal-add-category");

    const modalInstance = M.Modal.init(modalElem, {
      onOpenEnd() {
        M.FormSelect.init(document.querySelectorAll("select"));
      },

      onCloseEnd() {
        document.getElementById("new-category-name").value = "";
        document.getElementById("pieces-per-pack").value = "";

        document.getElementById("category-role").selectedIndex = 0;
        document.getElementById("new-category-unit").selectedIndex = 0;

        document.getElementById("pieces-per-pack-field").style.display = "none";

        M.updateTextFields();
        M.FormSelect.init(document.querySelectorAll("select"));
      },
    });

    modalInstance.open();
  };
}

// Shared function ng Add at Edit Product modal para sa quantity label at plastic color visibility.
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

  // Pares category lang ang may plastic color, at optional pa rin ito.
  if (plasticColorField) {
    if (categoryName.toLowerCase() === "pares") {
      plasticColorField.style.display = "block";
    } else {
      plasticColorField.style.display = "none";
      if (plasticColorInput) plasticColorInput.value = "";
    }
  }
}

// I-update ang quantity label base sa napiling category.
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

    //i-refresh ang posisyon ng label
    M.updateTextFields();
  };
}

// Pinagsasama ang lahat ng handlers na kailangang i-rebind kada page load.
function bindInventoryPageButtons() {
  bindSaveCategoryButton();
  bindFilterDateInput();
  bindNewCategoryUnitSelect();
  bindProductCategorySelect();
}

//button para sa delete category
// (nasa loadCategories() na ang binding via bindDeleteCategoryButton)

//load roles in add category

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

// Tinatawag ito ng functionalnav.js kada mag-load ng inventory.html.
export async function initInventoryPage() {
  loadInventory();
  loadCategories();
  bindInventoryPageButtons();
}