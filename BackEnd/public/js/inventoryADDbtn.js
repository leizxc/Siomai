// inventoryADDbtn.js
import { addProduct } from "/js/adminBE.js";

///testing kung makikita agad sa devtool/

// Kailangan i-destroy muna ang lumang Materialize Select instance
function reinitSelect(selectEl) {
  if (!selectEl) return;
  const instance = M.FormSelect.getInstance(selectEl);
  if (instance) {
    instance.destroy();
  }
  M.FormSelect.init(selectEl);
}

function reinitAllSelects(selects) {
  selects.forEach(reinitSelect);
}

export function initInventoryModal() {
  const modalElem = document.getElementById("modal-add");
  if (!modalElem) {
    console.log("Modal not found");
    return;
  }

  // Initialize Modal
  let modalInstance = M.Modal.getInstance(modalElem);

  if (!modalInstance) {
    modalInstance = M.Modal.init(modalElem, {
      dismissible: true,
    });
  }

  // Delay para sure na rendered na ang fetched HTML
  setTimeout(() => {
    const selects = document.querySelectorAll("select");
    if (selects.length > 0) {
      reinitAllSelects(selects);
      console.log("Materialize Select Initialized");
    }
  }, 100);

  const btnAdd = document.getElementById("btn-add");
  const saveBtn = document.getElementById("save-product");

  // Guard: kung tinatawag ulit ang initInventoryModal()
  if (btnAdd && !btnAdd.dataset.addBound) {
    btnAdd.dataset.addBound = "true";

    // OPEN MODAL
    btnAdd.addEventListener("click", () => {
      //clear fields before opening
      document.getElementById("product-name").value = "";
      document.getElementById("product-category").selectedIndex = 0;
      document.getElementById("product-packs").value = "";
      document.getElementById("product-price").value = "";
      if (document.getElementById("product-plastic-color")) {
        document.getElementById("product-plastic-color").value = "";
      }

      //reset save button label
      const saveBtnNow = document.getElementById("save-product");
      if (saveBtnNow) saveBtnNow.textContent = "Save Product";

      // Re-init select every open
      const selects = document.querySelectorAll("select");
      if (selects.length > 0) {
        reinitAllSelects(selects);
      }
      modalInstance.open();
    });
  }

  if (saveBtn && !saveBtn.dataset.saveBound) {
    saveBtn.dataset.saveBound = "true";

    // SAVE PRODUCT
    saveBtn.addEventListener("click", async () => {
      if (saveBtn.textContent === "Update Product") {
        return;
      }

      // I-disable habang nagsa-save para hindi ma-double-click at
      // makapag-fire ng dalawang addProduct() call nang sabay-sabay.
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;

      console.log("SAVE CLICKED");
      const name = document.getElementById("product-name").value.trim();
      const category = document.getElementById("product-category").value;
      const packsStr = document.getElementById("product-packs").value;
      const priceStr = document.getElementById("product-price").value;
      const plasticColor = document.getElementById("product-plastic-color")
        ? document.getElementById("product-plastic-color").value.trim()
        : "";

      if (!name || !category || !packsStr || !priceStr) {
        alert("Please fill all required fields!");
        saveBtn.disabled = false;
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
        await addProduct(name, category, packs, unitPrice, plasticColor);

        console.log("SAVED SUCCESS");

        // Clear Fields
        document.getElementById("product-name").value = "";
        document.getElementById("product-category").selectedIndex = 0;
        document.getElementById("product-packs").value = "";
        document.getElementById("product-price").value = "";
        if (document.getElementById("product-plastic-color")) {
          document.getElementById("product-plastic-color").value = "";
        }

        // Refresh Select UI
        const selects = document.querySelectorAll("select");
        reinitAllSelects(selects);

        modalInstance.close();
      } catch (err) {
        console.error("SAVE ERROR:", err);
        alert("Failed to save product");
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  console.log("Inventory Init Loaded");
}
