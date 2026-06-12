// inventoryADDbtn.js
import { addProduct } from "/js/adminBE.js";

///testing kung makikita agad sa devtool/
export function initInventoryModal() {
  const modalElem = document.getElementById("modal-add");
  if (!modalElem) {
    console.log("Modal not found");
    return;
  }

  // Initialize Modal
  const modalInstance = M.Modal.init(modalElem);

  // Delay para sure na rendered na ang fetched HTML
  setTimeout(() => {
    const selects = document.querySelectorAll("select");
    if (selects.length > 0) {
      M.FormSelect.init(selects);
      console.log("Materialize Select Initialized");
    }
  }, 100);

  const btnAdd = document.getElementById("btn-add");
  const saveBtn = document.getElementById("save-product");

  // OPEN MODAL
  btnAdd?.addEventListener("click", () => {
    //clear fields before opening
    document.getElementById("product-name").value ="";
    document.getElementById("product-category").selectedIndex = 0;
    document.getElementById("product-packs").value = "";
    document.getElementById("product-price").value = "";

    //reset save button label
    const saveBtn = document.getElementById("save-product");
    saveBtn.textContent = "Save Product";

    // Re-init select every open
    const selects = document.querySelectorAll("select");
    if (selects.length > 0) {
      M.FormSelect.init(selects);
    }
    modalInstance.open();
  });

  // SAVE PRODUCT
  saveBtn?.addEventListener("click", async () => {
    if(saveBtn.textContent === "Update Product"){
      return;
    }

    console.log("SAVE CLICKED");
    const name = document.getElementById("product-name").value.trim();
    const category = document.getElementById("product-category").value;
    const packsStr = document.getElementById("product-packs").value;
    const priceStr = document.getElementById("product-price").value;

    if (!name || !category || !packsStr || !priceStr) {
      alert("Please fill all required fields!");
      return;
    }

    const packs = parseInt(packsStr);
    const unitPrice = parseFloat(priceStr);

    // convert packs to pieces
    const piecesPerPack = 60;
    const stockQty = packs * piecesPerPack;

    // status logic based on pieces
    const status =
      stockQty <= 0
        ? "Out of Stock"
        : stockQty < 50
          ? "Low Stock"
          : "In Stock";

    try {
      console.log("SAVING...");

      // pass packs converted to pieces
      await addProduct(name, category, packs, unitPrice);

      console.log("SAVED SUCCESS");

      // Clear Fields
      document.getElementById("product-name").value = "";
      document.getElementById("product-category").selectedIndex = 0;
      document.getElementById("product-packs").value = "";
      document.getElementById("product-price").value = "";

      // Refresh Select UI
      const selects = document.querySelectorAll("select");
      M.FormSelect.init(selects);

      
      modalInstance.close();
    } catch (err) {
      console.error("SAVE ERROR:", err);
      alert("Failed to save product");
    }
  });

  console.log("Inventory Init Loaded");
}
