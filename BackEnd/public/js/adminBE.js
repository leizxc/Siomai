// adminBE.js
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
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==================== INVENTORY ==================== //
let unsubscribeInventory = null;
let unsubscribeCategories = null;

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

  // Reuse existing instance instead of re-initializing every time this
  // runs — re-initializing creates a duplicate overlay and breaks close/open.
  let modalInstance = M.Modal.getInstance(modalElement);
  if (!modalInstance) {
    modalInstance = M.Modal.init(modalElement, { dismissible: false });
  }

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

  // Only one listener must control this table. Otherwise old filters can
  // render after the user changes the selected date.
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

      // Different unit types are NOT comparable quantities (pcs vs kg vs L),
      // so we track separate running totals per type instead of summing
      // everything blindly into one number.
      const unitTotals = { pack: 0, kg: 0, liter: 0, other: 0 };

      const categorySelect = document.getElementById("filter-category");
      const selectedCategory = categorySelect ? categorySelect.value : "";
      const selectedDate = dateInput.value;

      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();

        if (selectedCategory !== "all") {
          const selectedOption = document.querySelector(
            `#filter-category option[value="${selectedCategory}"]`,
          );

          const selectedName = selectedOption ? selectedOption.textContent : "";

          if (data.category !== selectedName) return;
        }

        if (selectedDate) {
          if (!data.created_at) return;

          const docDate = toLocalDateValue(data.created_at.toDate());

          if (docDate !== selectedDate) return;
        }

        // Kapag pasado sa filter, saka lang magre-render

        // "On Selling" here means "may na-assign na" (adminaddproduct.js
        // sets data.assigned = true the moment ANY quantity gets assigned
        // to an employee, and only reverts it to false once every
        // assignment for this item has been deleted). This is a
        // SEPARATE field from data.status — status stays purely
        // quantity-based and is still used by adminaddproduct.js's
        // loadInventoryOptions() to hide fully-depleted items from the
        // "Choose Product" dropdown. Don't merge the two: an item can
        // be assigned=true while still having plenty of quantity left
        // in the warehouse (still assignable), and status handles that
        // case separately.
        const assigned = data.assigned === true;

        // Truly used up: never assigned (or no longer has any active
        // assignment) AND nothing left in the warehouse — nothing left
        // to show or act on, so the row disappears from the list
        // entirely instead of rendering an empty/dead entry.
        if (!assigned && data.quantity <= 0) {
          return;
        }

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

        if (assigned) {
          // Stays "On Selling" the whole time it's assigned — including
          // once quantity drops to 0 — instead of flipping label mid-way.
          status = "On Selling";
        } else if (data.stock_quantity <= 25) {
          status = "Low Stock";
        }

        //  Dynamic display for quantity and total pieces
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

        // Determine display label and value based on unit type
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

        // Render row dynamically
        tbody.innerHTML += `
  <tr data-category-id="${docSnap.data().category_id}">
    <td data-label="Product Name">${data.product_name}</td>
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

      //for summary card of total quantity
      let totalLabel1 = "Total Stocks";
      let totalDisplay1 = totalStocks;

      //if a specific category is selected, adjust label based on its unit type
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
        // "All Categories" view: pcs, kg, and L are different units, so
        // show a breakdown instead of a single misleading combined number.
        const parts = [];
        if (unitTotals.pack) parts.push(`${unitTotals.pack} pcs`);
        if (unitTotals.kg) parts.push(`${unitTotals.kg} kg`);
        if (unitTotals.liter) parts.push(`${unitTotals.liter} L`);
        if (unitTotals.other) parts.push(`${unitTotals.other} qty`);

        totalLabel1 = "Total Stocks";
        totalDisplay1 = parts.length ? parts.join(" • ") : "0";
      }

      // Update summary cards
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

      // Delete button logic
      document.querySelectorAll(".delete-btn").forEach((btn) => {
        btn.onclick = async (e) => {
          const id = e.target.closest("button").dataset.id;
          await deleteProduct(id);
        };
      });

      // Edit button logic
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

          const modalElem = document.getElementById("modal-edit");
          // Reuse the existing instance instead of re-initializing —
          // re-init on an already-initialized modal creates a duplicate
          // overlay and desyncs open/close behavior (same bug that hit
          // the Add Product modal).
          let modalInstance = M.Modal.getInstance(modalElem);
          if (!modalInstance) {
            modalInstance = M.Modal.init(modalElem);
          }
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

            const categoryDoc = await getDoc(
              doc(db, "categoriesINV", newCategoryId),
            );
            const categoryData = categoryDoc.data();
            const unitType = categoryData.unit_type;
            const piecesPerPack = categoryData.pieces_per_pack || 1;

            let newStock =
              unitType === "pack" ? newQuantity * piecesPerPack : newQuantity;
            const newTotalValue = newStock * newPrice;

            await updateDoc(doc(db, "inventory", id), {
              product_name: newName,
              category_id: newCategoryId, //  store doc ID
              category: categoryData.name, //  store readable name
              role: categoryData.role,
              unit_type: unitType,
              quantity: newQuantity,
              stock_quantity: newStock,
              unit_price: newPrice,
              total_value: newTotalValue,
              // Keep the stored status field in sync with the edited
              // quantity — otherwise editing a fully-assigned product's
              // stock back up would leave it stuck showing "On Selling",
              // or editing it down to 0 wouldn't mark it "On Selling".
              status: newQuantity <= 0 ? "On Selling" : "Available",
              last_updated: serverTimestamp(),
            });
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

// Add new product
export async function addProduct(productName, categoryId, quantity, unitPrice) {
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

  await addDoc(collection(db, "inventory"), {
    product_name: productName,
    category_id: categoryId, // Firestore doc ID
    category: categoryData.name, // readable name
    role: categoryData.role,
    unit_type: unitType,
    quantity: quantity,
    stock_quantity: stockQty,
    unit_price: unitPrice,
    total_value: totalValue,
    assigned: false, // hasn't been assigned to any employee yet
    status: "Available",
    created_at: serverTimestamp(),
    last_updated: serverTimestamp(),
  });
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
  const selects = document.querySelectorAll(
    "#filter-category, #product-category, #edit-category",
  );
  // changes, those stale listeners fire too and crash trying to
  // M.FormSelect.init() on detached elements.
  if (unsubscribeCategories) {
    unsubscribeCategories();
  }

  unsubscribeCategories = onSnapshot(collection(db, "categoriesINV"), (snapshot) => {
    selects.forEach((sel) => {
      if (sel.id === "filter-category") {
        sel.innerHTML = `<option value="all">All Categories</option>`;
      } else {
        sel.innerHTML = `<option value="" disabled selected>Choose Category</option>`;
      }

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
  });
}

// Save category with unit type + pieces per pack


//load roles in add category
function bindInventoryListeners() {

  // ================= SAVE CATEGORY =================
  document.getElementById("save-category").onclick = async () => {
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

    const categoryData = {
      name,
      role,
      unit_type: unitType,
    };

    if (unitType === "pack" && piecesPerPack) {
      categoryData.pieces_per_pack = parseInt(piecesPerPack);
    }

    await addDoc(collection(db, "categoriesINV"), categoryData);

    M.toast({
      html: "Category added!",
      classes: "green rounded",
    });

    document.getElementById("new-category-name").value = "";
    document.getElementById("new-category-unit").value = "";
    document.getElementById("pieces-per-pack").value = "";

    M.Modal.getInstance(
      document.getElementById("modal-add-category")
    ).close();

    M.FormSelect.init(document.querySelectorAll("select"));
  };



  // ================= FILTER DATE =================

  document.getElementById("filter-date").onchange = () => {
    loadInventory();
  };



  // ================= UNIT TYPE =================

  document.getElementById("new-category-unit").onchange = (e) => {

    const field = document.getElementById("pieces-per-pack-field");

    field.style.display =
      e.target.value === "pack" ? "block" : "none";

    M.FormSelect.init(document.querySelectorAll("select"));

  };



  // ================= OPEN CATEGORY MODAL =================

  document.getElementById("btn-add-categories").onclick = async () => {

    await loadRoles();

    const modal = M.Modal.getInstance(
      document.getElementById("modal-add-category")
    );

    modal.open();

  };



  // ================= PRODUCT CATEGORY =================

  document.getElementById("product-category").onchange = async (e) => {

    const categoryId = e.target.value;

    if (!categoryId) return;

    const categoryDoc = await getDoc(doc(db, "categoriesINV", categoryId));

    const unitType = categoryDoc.data().unit_type;

    const piecesPerPack =
      categoryDoc.data().pieces_per_pack || 1;

    const qtyLabel =
      document.querySelector('label[for="product-packs"]');

    const qtyInput =
      document.getElementById("product-packs");

    if (unitType === "pack") {

      qtyLabel.textContent =
        `Number of Packs (×${piecesPerPack} pieces each)`;

      qtyInput.placeholder =
        "Enter number of packs";

    }

    else if (unitType === "kg") {

      qtyLabel.textContent = "Weight (kg)";
      qtyInput.placeholder = "Enter kg";

    }

    else if (unitType === "liter") {

      qtyLabel.textContent = "Volume (L)";
      qtyInput.placeholder = "Enter liters";

    }

    else {

      qtyLabel.textContent = "Quantity";
      qtyInput.placeholder = "Enter quantity";

    }

    M.updateTextFields();

  };



  // ================= FILTER CATEGORY =================

  const filter = document.getElementById("filter-category");

  const deleteBtn =
    document.getElementById("delete-category-btn");

  deleteBtn.disabled = filter.value === "all";

  filter.onchange = () => {

    deleteBtn.disabled =
      filter.value === "all";

    loadInventory();

  };



  deleteBtn.onclick = async () => {

    if (filter.value === "all") return;

    await deleteCategory(filter.value);

  };

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

export async function initInventoryPage() {

    loadInventory();

    loadCategories();

    bindInventoryListeners();

    console.log("✅ Inventory initialized");

}