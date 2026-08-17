// inventoryADDbtn.js
import { addProduct } from "/js/adminBE.js";

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
  if (!modalElem) return;

  let modalInstance = M.Modal.getInstance(modalElem);
  if (!modalInstance) {
    modalInstance = M.Modal.init(modalElem, { dismissible: true });
  }

  setTimeout(() => {
    const selects = document.querySelectorAll("select");
    if (selects.length > 0) reinitAllSelects(selects);
  }, 100);

  const btnAdd = document.getElementById("btn-add-product");
  const saveBtn = document.getElementById("save-product");

  if (btnAdd && !btnAdd.dataset.addBound) {
    btnAdd.dataset.addBound = "true";

    btnAdd.addEventListener("click", () => {
      document.getElementById("product-name").value = "";
      document.getElementById("product-category").selectedIndex = 0;
      document.getElementById("product-packs").value = "";
      document.getElementById("product-price").value = "";
      if (document.getElementById("product-plastic-color")) {
        document.getElementById("product-plastic-color").value = "";
      }

      const saveBtnNow = document.getElementById("save-product");
      if (saveBtnNow) saveBtnNow.textContent = "Save Product";

      const selects = document.querySelectorAll("select");
      if (selects.length > 0) reinitAllSelects(selects);

      modalInstance.open();
    });
  }

  if (saveBtn && !saveBtn.dataset.saveBound) {
    saveBtn.dataset.saveBound = "true";

    saveBtn.addEventListener("click", async () => {
      if (saveBtn.textContent === "Update Product") return;
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;

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

      try {
        await addProduct(name, category, packs, unitPrice, plasticColor);

        document.getElementById("product-name").value = "";
        document.getElementById("product-category").selectedIndex = 0;
        document.getElementById("product-packs").value = "";
        document.getElementById("product-price").value = "";
        if (document.getElementById("product-plastic-color")) {
          document.getElementById("product-plastic-color").value = "";
        }

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
}
