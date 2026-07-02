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
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ==================== INVENTORY ==================== //
export function loadInventory() {
  const tbody = document.getElementById("inventory-table-body");

  onSnapshot(collection(db, "inventory"), (querySnapshot) => {
    tbody.innerHTML = "";

    let totalProducts = 0;
    let totalStocks = 0;
    let totalValue = 0;
    const categories = new Set();

    const selectedCategory = document.getElementById("filter-category").value;
    const selectedDate = document.getElementById("filter-date").value;

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();

      // Filter by category
      if (selectedCategory !== "all") {
        const selectedOption = document.querySelector(`#filter-category option[value="${selectedCategory}"]`);
        const selectedName = selectedOption ? selectedOption.textContent : "";
        if (data.category !== selectedName) return;
      }

      // Filter by date
      if (selectedDate) {
        const docDate = data.last_updated?.toDate().toISOString().split("T")[0];
        if (docDate !== selectedDate) return;
      }

      totalProducts++;
      totalStocks += data.stock_quantity;
      totalValue += data.total_value;
      categories.add(data.category);

      const status = data.stock_quantity <= 50 ? "Low Stock" : "Available";

      // ✅ Dynamic display for quantity and total pieces
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
      } else {
        totalLabel = "Total Quantity";
        totalDisplay = `${data.stock_quantity}`;
      }

      // Render row dynamically
      tbody.innerHTML += `
  <tr>
    <td data-label="Product Name">${data.product_name}</td>
    <td data-label="Category">${data.category}</td>
    <td data-label="Quantity">${data.quantity} ${data.unit_type}</td>
    <td data-label="${totalLabel}">${totalDisplay}</td>
    <td data-label="Unit Price">₱${data.unit_price.toFixed(2)}</td>
    <td data-label="Total Value">₱${data.total_value.toFixed(2)}</td>
    <td data-label="Status">${status}</td>
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

    // Update summary cards
    document.getElementById("total-products").textContent = totalProducts;
    document.getElementById("total-stocks").textContent = totalStocks;
    document.getElementById("total-value").textContent = `₱${totalValue.toFixed(2)}`;
    document.getElementById("total-categories").textContent = categories.size;

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

        document.getElementById("edit-name").value = row.children[0].textContent;
        document.getElementById("edit-category").value = row.children[1].textContent;
        document.getElementById("edit-packs").value = row.children[2].textContent;
        document.getElementById("edit-price").value = row.children[4].textContent.replace("₱", "");

        M.FormSelect.init(document.querySelectorAll("select"));

        const modalElem = document.getElementById("modal-edit");
        const modalInstance = M.Modal.init(modalElem);
        modalInstance.open();

        const saveBtn = document.getElementById("edit-save");
        saveBtn.onclick = async () => {
          const newName = document.getElementById("edit-name").value.trim();
          const newCategory = document.getElementById("edit-category").value;
          const newQuantity = parseFloat(document.getElementById("edit-packs").value);
          const newPrice = parseFloat(document.getElementById("edit-price").value);

          const categoryDoc = await getDoc(doc(db, "categoriesINV", newCategory));
          const unitType = categoryDoc.data().unit_type;
          const piecesPerPack = categoryDoc.data().pieces_per_pack || 1;

          let newStock = unitType === "pack" ? newQuantity * piecesPerPack : newQuantity;
          const newTotalValue = newStock * newPrice;

          await updateDoc(doc(db, "inventory", id), {
            product_name: newName,
            category: newCategory,
            unit_type: unitType,
            quantity: newQuantity,
            stock_quantity: newStock,
            unit_price: newPrice,
            total_value: newTotalValue,
            last_updated: serverTimestamp()
          });
          modalInstance.close();
        };
      };
    });
  });
}

// Add new product
export async function addProduct(productName, categoryId, quantity, unitPrice) {
  const categoryDoc = await getDoc(doc(db, "categoriesINV", categoryId));
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
    }  else {
    stockQty = quantity;
    totalValue = quantity * unitPrice;
  }


  await addDoc(collection(db, "inventory"), {
    product_name: productName,
    category: categoryDoc.data().name,
    unit_type: unitType,
    quantity: quantity,
    stock_quantity: stockQty,
    unit_price: unitPrice,
    total_value: totalValue,
    last_updated: serverTimestamp()
  });
}

// Delete product
export async function deleteProduct(id) {
  await deleteDoc(doc(db, "inventory", id));
}

// ==================== CATEGORIES ==================== //
export function loadCategories() {
  const selects = document.querySelectorAll("#filter-category, #product-category, #edit-category");

  onSnapshot(collection(db, "categoriesINV"), (snapshot) => {
    selects.forEach(sel => {
      if (sel.id === "filter-category") {
        sel.innerHTML = `<option value="all">All Categories</option>`;
      } else {
        sel.innerHTML = `<option value="" disabled selected>Choose Category</option>`;
      }

      snapshot.forEach(docSnap => {
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

// Hook sa add category modal
document.getElementById("btn-add-categories").onclick = () => {
  const modalElem = document.getElementById("modal-add-category");
  const modalInstance = M.Modal.init(modalElem);
  modalInstance.open();
};

// Save category with unit type + pieces per pack
document.getElementById("save-category").onclick = async () => {
  const name = document.getElementById("new-category-name").value.trim();
  const unitType = document.getElementById("new-category-unit").value;
  const piecesPerPack = document.getElementById("pieces-per-pack").value;

  if (!name || !unitType) {
    M.toast({ html: "Please enter name and unit type", classes: "red rounded" });
    return;
  }

  const categoryData = { name, unit_type: unitType };
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
};

// ==================== FILTERS ==================== //
// set default date to today
document.addEventListener("DOMContentLoaded", () => {
  const dateInput = document.getElementById("filter-date");
  const today = new Date().toISOString().split("T")[0];
  dateInput.value = today;
});

// filter triggers
document.getElementById("filter-category").addEventListener("change", () => {
  loadInventory();
});
document.getElementById("filter-date").addEventListener("change", () => {
  loadInventory();
});

// toggle pieces per pack field visibility
document.getElementById("new-category-unit").addEventListener("change", (e) => {
  const field = document.getElementById("pieces-per-pack-field");
  if (e.target.value === "pack") {
    field.style.display = "block";
  } else {
    field.style.display = "none";
  }
  // Reinitialize select to fix dropdown position
  M.FormSelect.init(document.querySelectorAll("select"));
});

//make dropdown of inside modal in category
document.getElementById("btn-add-categories").onclick = () => {
  const modalElem = document.getElementById("modal-add-category");
  const modalInstance = M.Modal.init(modalElem, {
    onOpenEnd: () => {
      M.FormSelect.init(document.querySelectorAll("select"));
    }
  });
  modalInstance.open();
}


//Updatae quantity label based on selected category
document.getElementById("product-category").addEventListener("change", async (e) => {
  const categoryId = e.target.value;
  if (!categoryId) return;

  const categoryDoc = await getDoc(doc(db, "categoriesINV", categoryId));
  const unitType = await categoryDoc.data().unit_type;
  const piecesPerPack = categoryDoc.data().pieces_per_pack || 1;

  const qtyLabel = document.querySelector('label[for="product-packs"]');
  const qtyInput = document.getElementById("product-packs");

  //update label and also formula of pack, kg ...
  if (unitType === "pack") {
    qtyLabel.textContent = `Number of Packs (×${piecesPerPack} pieces each)`;
    qtyInput.placeholder = "Enter number of packs";
  } else if (unitType === "kg") {
    qtyLabel.textContent = "Weight (in kilograms)";
    qtyInput.placeholder = "Enter weigh in kg"
  } else {
    qtyLabel.textContent = "Quantity";
    qtyInput.placeholder = "Enter quantity"
  }
  //refresh label position
  M.updateTextFields();
})