// expensesADDbtn.js
import {
  beginButtonLoading,
  endButtonLoading,
} from "/js/buttonLoading.js?v=20261008c";
import {
  addExpense,
  setExpenseCategoryFilter,
} from "/js/adminExpenses.js?v=20261008c";
import { EXPENSE_CATEGORIES } from "/js/expenseCategories.js?v=20261008c";
let selectedExpenseCategory = "all";
let expenseModalSession = 0;
let expenseSelectTimer = null;

function bindExpenseModalClose(modalElem, modalInstance) {
  if (!modalElem || !modalInstance) return;

  modalElem.querySelectorAll(".modal-close").forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      modalInstance.close();
    };
  });
}

// Destroy muna bago i-init para hindi madoble ang select wrapper.
function refreshSelects(root) {
  root?.querySelectorAll("select").forEach((select) => {
    M.FormSelect.getInstance(select)?.destroy();
    M.FormSelect.init(select);
  });
}

// Para sa ibang select ng page na hindi pa na-init (hindi ginagalaw ang
// mga naka-init na).
function initPendingSelects(root) {
  root?.querySelectorAll("select").forEach((select) => {
    if (select.classList.contains("browser-default")) return;
    if (!M.FormSelect.getInstance(select)) M.FormSelect.init(select);
  });
}

//LOAD EXPENSE CATEGORIES

function loadExpenseCategories() {
  const filterPills = document.getElementById("expense-category-pills");
  const addSelect = document.getElementById("expenses-category");
  const editSelect = document.getElementById("edit-expenses-category");

  if (!filterPills && !addSelect && !editSelect) return;
  renderExpenseCategoryPills(filterPills);
  updateSelect(addSelect, "Choose Category", "", false);
  updateSelect(editSelect, "Choose Category", "", true);
}

function renderExpenseCategoryPills(container) {
  if (!container || !container.isConnected) return;

  const categories = EXPENSE_CATEGORIES;

  container.innerHTML = "";

  ["all", ...categories].forEach((category) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className =
      "category-pill" + (selectedExpenseCategory === category ? " active" : "");
    pill.textContent = category === "all" ? "All Categories" : category;
    pill.dataset.category = category;
    pill.setAttribute(
      "aria-pressed",
      String(selectedExpenseCategory === category),
    );
    pill.onclick = () => selectExpenseCategory(category);
    container.appendChild(pill);
  });
}

function selectExpenseCategory(category) {
  if (selectedExpenseCategory === category) return;

  selectedExpenseCategory = category;
  document
    .querySelectorAll("#expense-category-pills .category-pill")
    .forEach((pill) => {
      const isActive = pill.dataset.category === category;
      pill.classList.toggle("active", isActive);
      pill.setAttribute("aria-pressed", String(isActive));
    });

  setExpenseCategoryFilter(category);
}

function updateSelect(select, placeholder, value, preserveCurrent) {
  if (!select || !select.isConnected) return;

  const previous = select.value;

  select.innerHTML = "";

  const firstOption = document.createElement("option");
  firstOption.value = value;
  firstOption.textContent = placeholder;

  if (value === "") firstOption.disabled = true;

  firstOption.selected = true;

  select.appendChild(firstOption);

  EXPENSE_CATEGORIES.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });

  if (preserveCurrent && previous && !EXPENSE_CATEGORIES.includes(previous)) {
    const legacyOption = document.createElement("option");
    legacyOption.value = previous;
    legacyOption.textContent = previous;
    select.appendChild(legacyOption);
  }

  if ([...select.options].some((o) => o.value === previous)) {
    select.value = previous;
  }

  M.FormSelect.getInstance(select)?.destroy();
  M.FormSelect.init(select);
}

/* ============================================================
   ADD EXPENSE MODAL
============================================================ */

export function initExpensesModal() {
  stopExpensesModal();
  const token = ++expenseModalSession;
  const modalElem = document.getElementById("modal-expenses");

  if (!modalElem) {
    console.log("Expenses modal not found");
    return;
  }

  // The navigator initializes page modals first. Reuse that instance instead
  // of registering another set of Materialize handlers every time this page
  // is loaded.
  const modalInstance =
    M.Modal.getInstance(modalElem) || M.Modal.init(modalElem);
  bindExpenseModalClose(modalElem, modalInstance);

  loadExpenseCategories();

  const categorySelect = document.getElementById("expenses-category");
  const otherCategoryField = document.getElementById(
    "expenses-other-category-field",
  );
  const otherCategoryInput = document.getElementById("expenses-category-other");
  const syncOtherCategory = () => {
    const isOthers = categorySelect?.value === "Others";
    if (otherCategoryField) otherCategoryField.hidden = !isOthers;
    if (!isOthers && otherCategoryInput) otherCategoryInput.value = "";
  };
  // onchange (hindi addEventListener) para hindi dumoble ang handler kapag na-init ulit
  if (categorySelect) categorySelect.onchange = syncOtherCategory;
  syncOtherCategory();

  // Ang mga select sa loob ng modal ay hinahawakan ng refreshSelects; dito,
  // ang ibang select lang ng page na hindi pa na-init ang sinisigurado.
  expenseSelectTimer = setTimeout(() => {
    if (token !== expenseModalSession || !modalElem.isConnected) return;
    initPendingSelects(document.getElementById("content") || document);
  }, 100);

  const btnAdd = document.querySelector(".expense-btn");
  const saveBtn = document.getElementById("save-expense");

  if (btnAdd)
    btnAdd.onclick = () => {
      // Huwag nang magbukas ulit kung bukas na (double-tap sa mobile).
      if (modalInstance.isOpen) return;

      document.getElementById("expenses-date").value = "";

      document.getElementById("expenses-description").value = "";

      document.getElementById("expenses-amount").value = "";

      document.getElementById("expenses-category").selectedIndex = 0;
      if (otherCategoryInput) otherCategoryInput.value = "";
      if (otherCategoryField) otherCategoryField.hidden = true;

      document.getElementById("expenses-status").selectedIndex = 0;

      if (saveBtn) saveBtn.textContent = "Save Expense";

      M.updateTextFields();

      // Mga select lang sa loob ng modal ang ire-refresh, hindi ang buong page.
      refreshSelects(modalElem);

      modalInstance.open();
    };

  if (saveBtn)
    saveBtn.onclick = async () => {
      if (saveBtn.textContent === "Update Expense") return;
      if (saveBtn.disabled || saveBtn.dataset.actionBusy === "true") return;

      const date = document.getElementById("expenses-date").value;

      const selectedCategory =
        document.getElementById("expenses-category").value;
      const customCategory = otherCategoryInput?.value.trim() || "";
      const category =
        selectedCategory === "Others" ? customCategory : selectedCategory;

      const description = document
        .getElementById("expenses-description")
        .value.trim();

      const amount = parseFloat(
        document.getElementById("expenses-amount").value,
      );

      const status = document.getElementById("expenses-status").value;

      if (
        !date ||
        !selectedCategory ||
        !category ||
        !description ||
        isNaN(amount) ||
        !status
      ) {
        M.toast({
          html: "Please fill all required fields.",
          classes: "red rounded",
        });

        return;
      }

      if (!beginButtonLoading(saveBtn, "Saving expense...")) return;
      try {
        await addExpense(date, category, description, amount, status);

        // Lumipat na ng section habang nagsa-save: naisulat na ang expense,
        // pero huwag nang galawin ang DOM ng ibang page.
        if (token !== expenseModalSession || !modalElem.isConnected) return;

        document.getElementById("expenses-date").value = "";

        document.getElementById("expenses-description").value = "";

        document.getElementById("expenses-amount").value = "";

        document.getElementById("expenses-category").selectedIndex = 0;
        if (otherCategoryInput) otherCategoryInput.value = "";
        if (otherCategoryField) otherCategoryField.hidden = true;

        document.getElementById("expenses-status").selectedIndex = 0;

        M.updateTextFields();

        refreshSelects(modalElem);

        modalInstance.close();

        M.toast({
          html: "Expense added successfully!",
          classes: "green rounded",
        });
      } catch (err) {
        console.error(err);

        if (token !== expenseModalSession) return;

        M.toast({
          html: "Failed to save expense.",
          classes: "red rounded",
        });
      } finally {
        endButtonLoading(saveBtn);
      }
    };

  console.log("Expenses Module Loaded");
}

export function stopExpensesModal() {
  expenseModalSession += 1;
  clearTimeout(expenseSelectTimer);
  expenseSelectTimer = null;
  selectedExpenseCategory = "all";

  // functionalnav disposes page-owned Materialize modal instances and overlays
  // immediately after this page cleanup runs.
}
