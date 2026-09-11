// expensesADDbtn.js
import { db } from "/js/firebase.js";
import { addExpense } from "/js/adminExpenses.js";

import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  getDocs,
  query,
  where,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubscribeCategory = null;

//LOAD EXPENSE CATEGORIES

function loadExpenseCategories() {
  const filterSelect = document.getElementById("filter-category");
  const addSelect = document.getElementById("expenses-category");
  const editSelect = document.getElementById("edit-expenses-category");

  if (!filterSelect && !addSelect && !editSelect) return;

  if (unsubscribeCategory) unsubscribeCategory();

  unsubscribeCategory = onSnapshot(
    collection(db, "expenses_category"),
    (snapshot) => {
      updateSelect(filterSelect, snapshot, "All Categories", "all");

      updateSelect(addSelect, snapshot, "Choose Category", "");

      updateSelect(editSelect, snapshot, "Choose Category", "");
    },
  );
}

function updateSelect(select, snapshot, placeholder, value) {
  if (!select || !select.isConnected) return;

  const previous = select.value;

  select.innerHTML = "";

  const firstOption = document.createElement("option");
  firstOption.value = value;
  firstOption.textContent = placeholder;

  if (value === "") firstOption.disabled = true;

  firstOption.selected = true;

  select.appendChild(firstOption);

  snapshot.forEach((docSnap) => {
    const option = document.createElement("option");

    option.value = docSnap.data().name;
    option.textContent = docSnap.data().name;

    select.appendChild(option);
  });

  if ([...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  }

  M.FormSelect.init(select);
}

/* ============================================================
   ADD EXPENSE MODAL
============================================================ */

export function initExpensesModal() {
  const modalElem = document.getElementById("modal-expenses");

  if (!modalElem) {
    console.log("Expenses modal not found");
    return;
  }

  const modalInstance = M.Modal.init(modalElem);

  loadExpenseCategories();

  setTimeout(() => {
    M.FormSelect.init(document.querySelectorAll("select"));
  }, 100);

  const btnAdd = document.querySelector(".expense-btn");
  const saveBtn = document.getElementById("save-expense");

  btnAdd?.addEventListener("click", () => {
    document.getElementById("expenses-date").value = "";

    document.getElementById("expenses-description").value = "";

    document.getElementById("expenses-amount").value = "";

    document.getElementById("expenses-category").selectedIndex = 0;

    document.getElementById("expenses-status").selectedIndex = 0;

    saveBtn.textContent = "Save Expense";

    M.updateTextFields();

    M.FormSelect.init(document.querySelectorAll("select"));

    modalInstance.open();
  });

  saveBtn?.addEventListener("click", async () => {
    if (saveBtn.textContent === "Update Expense") return;

    const date = document.getElementById("expenses-date").value;

    const category = document.getElementById("expenses-category").value;

    const description = document
      .getElementById("expenses-description")
      .value.trim();

    const amount = parseFloat(document.getElementById("expenses-amount").value);

    const status = document.getElementById("expenses-status").value;

    if (!date || !category || !description || isNaN(amount) || !status) {
      M.toast({
        html: "Please fill all required fields.",
        classes: "red rounded",
      });

      return;
    }

    try {
      await addExpense(date, category, description, amount, status);

      document.getElementById("expenses-date").value = "";

      document.getElementById("expenses-description").value = "";

      document.getElementById("expenses-amount").value = "";

      document.getElementById("expenses-category").selectedIndex = 0;

      document.getElementById("expenses-status").selectedIndex = 0;

      M.updateTextFields();

      M.FormSelect.init(document.querySelectorAll("select"));

      modalInstance.close();

      M.toast({
        html: "Expense added successfully!",
        classes: "green rounded",
      });
    } catch (err) {
      console.error(err);

      M.toast({
        html: "Failed to save expense.",
        classes: "red rounded",
      });
    }
  });

  bindAddCategoryButton();
  bindDeleteCategoryButton();

  console.log("Expenses Module Loaded");
}

/* ============================================================
   ADD NEW EXPENSE CATEGORY
============================================================ */

function bindAddCategoryButton() {
  const btnAddCategory = document.querySelector(".add-expenses-category");
  const modalElem = document.getElementById("modal-add-category");
  const saveCategoryBtn = document.getElementById("save-new-category");
  const categoryInput = document.getElementById("add-new-category");

  if (!btnAddCategory || !modalElem || !saveCategoryBtn || !categoryInput) {
    console.warn("Expense Category Modal elements not found.");
    return;
  }

  let modalInstance = M.Modal.getInstance(modalElem);

  if (!modalInstance) {
    modalInstance = M.Modal.init(modalElem);
  }

  /* OPEN MODAL */

  btnAddCategory.onclick = () => {
    categoryInput.value = "";

    M.updateTextFields();

    modalInstance.open();
  };

  /* ================= SAVE CATEGORY ================= */

  saveCategoryBtn.onclick = async () => {
    const categoryName = categoryInput.value.trim().toUpperCase();

    if (!categoryName) {
      M.toast({
        html: "Please enter a category name.",
        classes: "red rounded",
      });
      return;
    }

    try {
      // Check duplicate
      const existing = await getDocs(
        query(
          collection(db, "expenses_category"),
          where("name", "==", categoryName),
        ),
      );

      if (!existing.empty) {
        M.toast({
          html: "Category already exists.",
          classes: "red rounded",
        });
        return;
      }

      // Save to Firestore
      await addDoc(collection(db, "expenses_category"), {
        name: categoryName,
        created_at: serverTimestamp(),
      });

      categoryInput.value = "";

      modalInstance.close();

      M.toast({
        html: "Expense category added successfully!",
        classes: "green rounded",
      });

      // Refresh labels
      M.updateTextFields();

      // Optional refresh ng selects
      M.FormSelect.init(document.querySelectorAll("select"));
    } catch (error) {
      console.error(error);

      M.toast({
        html: "Failed to save category.",
        classes: "red rounded",
      });
    }
  };
}

/* ============================================================
   DELETE EXPENSE CATEGORY
   Gumagamit ng parehong "modal-delete-category" na modal na
   ginagamit din sa inventory side (adminBE.js) — magkaiba lang
   ang JS na naka-bind depende kung aling page ang bukas.
============================================================ */

function bindDeleteCategoryButton() {
  const deleteBtn = document.getElementById("btn-delete-category");
  const filterSelect = document.getElementById("filter-category");
  const modalElem = document.getElementById("modal-delete-category");

  if (!deleteBtn || !filterSelect || !modalElem) {
    console.warn("Delete Category elements not found.");
    return;
  }

  const titleElement = document.getElementById("delete-confirmation-title");
  const messageElement = document.getElementById("delete-confirmation-message");
  const confirmBtn = document.getElementById("confirm-delete-category");

  if (!titleElement || !messageElement || !confirmBtn) {
    console.warn("Delete Category modal buttons not found.");
    return;
  }

  let modalInstance = M.Modal.getInstance(modalElem);
  if (!modalInstance) {
    modalInstance = M.Modal.init(modalElem, { dismissible: false });
  }

  // I-disable ang button kapag "All Categories" pa rin ang napili.
  function syncDeleteButtonState() {
    deleteBtn.disabled = !filterSelect.value || filterSelect.value === "all";
  }

  syncDeleteButtonState();
  filterSelect.addEventListener("change", syncDeleteButtonState);

  deleteBtn.onclick = () => {
    const categoryName = filterSelect.value;

    if (!categoryName || categoryName === "all") {
      M.toast({
        html: "Please select a category first.",
        classes: "red rounded",
      });
      return;
    }

    titleElement.textContent = "Delete category?";
    messageElement.textContent = `"${categoryName}" will be permanently deleted. You cannot delete a category that still has expenses.`;

    modalInstance.open();
  };

  confirmBtn.onclick = async () => {
    const categoryName = filterSelect.value;

    if (!categoryName || categoryName === "all") {
      modalInstance.close();
      return;
    }

    try {
      // Bawal tanggalin kung may existing pang expense na gumagamit dito.
      const usedQuery = query(
        collection(db, "expenses"),
        where("category", "==", categoryName),
      );
      const usedSnap = await getDocs(usedQuery);

      if (!usedSnap.empty) {
        M.toast({
          html: "Cannot delete: this category still has expenses.",
          classes: "red rounded",
        });
        modalInstance.close();
        return;
      }

      const catQuery = query(
        collection(db, "expenses_category"),
        where("name", "==", categoryName),
      );
      const catSnap = await getDocs(catQuery);

      if (catSnap.empty) {
        M.toast({ html: "Category not found.", classes: "red rounded" });
        modalInstance.close();
        return;
      }

      await Promise.all(
        catSnap.docs.map((docSnap) =>
          deleteDoc(doc(db, "expenses_category", docSnap.id)),
        ),
      );

      filterSelect.value = "all";
      M.FormSelect.init(filterSelect);
      syncDeleteButtonState();

      modalInstance.close();

      M.toast({
        html: "Category deleted successfully!",
        classes: "green rounded",
      });
    } catch (err) {
      console.error(err);
      M.toast({ html: "Failed to delete category.", classes: "red rounded" });
      modalInstance.close();
    }
  };
}
