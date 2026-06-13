// adminBE.js
import { db } from "/js/firebase.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Load inventory data with realtime listener
export function loadInventory() {
  const tbody = document.getElementById("inventory-table-body");

  onSnapshot(collection(db, "inventory"), (querySnapshot) => {
    // Clear table body before re-render
    tbody.innerHTML = "";

    // Reset counters each time snapshot runs
    let totalProducts = 0;
    let totalStocks = 0;
    let totalValue = 0;
    const categories = new Set(); // Reset categories per snapshot

    // Loop through all documents in collection
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      totalProducts++;
      totalStocks += data.stock_quantity;
      totalValue += data.total_value;
      categories.add(data.category);

      const status = data.stock_quantity <= 50 ? "Low Stock" : "Available";

      // Render table row
      tbody.innerHTML += `
        <tr data-packs="${data.packs_quantity || 0}">
          <td data-label="Product Name">${data.product_name}</td>
          <td data-label="Category">${data.category}</td>
          <td data-label="Packs">${data.packs_quantity}</td>
          <td data-label="Stock">${data.stock_quantity}</td>
          <td data-label="Unit Price">₱${data.unit_price.toFixed(2)}</td>
          <td data-label="Total Value">₱${data.total_value.toFixed(2)}</td>
          <td data-label="Status">${status}</td>
          <td data-label="Action">
            <button class="edit-btn waves-effect waves-light btn blue" data-id="${docSnap.id}">
              <i class="material-icons">edit</i>
            </button>
            <button class="delete-btn waves-effect waves-light btn red" data-id="${docSnap.id}">
              <i class="material-icons">delete</i>
            </button>
          </td>
        </tr>
      `;
    });

    // Update summary cards with recalculated values
    document.getElementById("total-products").textContent = totalProducts;
    document.getElementById("total-stocks").textContent = totalStocks;
    document.getElementById("total-value").textContent = `₱${totalValue.toFixed(2)}`;
    document.getElementById("total-categories").textContent = categories.size;

    // Delete button logic
    document.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        // Use closest button to avoid issues when clicking icon
        const id = e.target.closest("button").dataset.id;
        console.log("Deleting document ID:", id);
        await deleteProduct(id);
      };
    });

    // Edit button logic
    document.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        const id = e.target.closest("button").dataset.id;
        const row = e.target.closest("tr");

        // Fill edit modal fields
        document.getElementById("edit-name").value = row.children[0].textContent;
        document.getElementById("edit-category").value = row.children[1].textContent;
        document.getElementById("edit-packs").value = row.dataset.packs;
        document.getElementById("edit-price").value = row.children[4].textContent.replace("₱", "");

        M.FormSelect.init(document.querySelectorAll("select"));

        // Initialize and open modal
        const modalElem = document.getElementById("modal-edit");
        const modalInstance = M.Modal.init(modalElem);
        modalInstance.open();

        // Save changes
        const saveBtn = document.getElementById("edit-save");
        saveBtn.onclick = async () => {
          const newName = document.getElementById("edit-name").value.trim();
          const newCategory = document.getElementById("edit-category").value;
          const newPacks = parseInt(document.getElementById("edit-packs").value);
          const newPrice = parseFloat(document.getElementById("edit-price").value);

          const piecesPerPack = 60;
          const newStock = newPacks * piecesPerPack;
          const newTotalValue = newStock * newPrice;

          await updateDoc(doc(db, "inventory", id), {
            product_name: newName,
            category: newCategory,
            packs_quantity: newPacks,
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
export async function addProduct(productName, category, packsQty, unitPrice) {
  const piecesPerPack = 60;
  const stockQty = packsQty * piecesPerPack;
  const totalValue = stockQty * unitPrice;

  await addDoc(collection(db, "inventory"), {
    product_name: productName,
    category: category,
    packs_quantity: packsQty,
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
