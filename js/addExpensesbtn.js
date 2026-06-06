// expensesADDbtn.js
import { addExpense } from "../BackEnd/js/adminExpenses.js";

export function initExpensesModal() {
  const modalElem = document.getElementById("modal-expenses");
  if (!modalElem) {
    console.log("Expenses modal not found");
    return;
  }

  // Initialize modal
  const modalInstance = M.Modal.init(modalElem);

  // Ensure selects are initialized after render
  setTimeout(() => {
    const selects = document.querySelectorAll("select");
    if (selects.length > 0) {
      M.FormSelect.init(selects);
      console.log("Materialize Select Initialized");
    }
  }, 100);

  const btnAdd = document.querySelector(".btn-add");
  const saveBtn = document.getElementById("save-expense");

  // OPEN MODAL
  btnAdd?.addEventListener("click", () => {
    // Clear fields before opening
    document.getElementById("expenses-date").value = "";
    document.getElementById("expenses-category").selectedIndex = 0;
    document.getElementById("expenses-description").value = "";
    document.getElementById("expenses-amount").value = "";
    document.getElementById("expenses-status").selectedIndex = 0;

    // Reset save button label
    saveBtn.textContent = "Save Expense";

    // Re-init select every open
    const selects = document.querySelectorAll("select");
    if (selects.length > 0) {
      M.FormSelect.init(selects);
    }

    modalInstance.open();
  });

  // SAVE EXPENSE
  saveBtn?.addEventListener("click", async () => {
    if (saveBtn.textContent === "Update Expense") {
      return; // skip if in update mode
    }

    console.log("SAVE CLICKED");

    const date = document.getElementById("expenses-date").value;
    const category = document.getElementById("expenses-category").value;
    const description = document.getElementById("expenses-description").value.trim();
    const amountStr = document.getElementById("expenses-amount").value;
    const status = document.getElementById("expenses-status").value;

    if (!date || !category || !description || !amountStr || !status) {
      alert("Please fill all required fields!");
      return;
    }

    const amount = parseFloat(amountStr);

    try {
      console.log("SAVING...");
      await addExpense(date, category, description, amount, status);
      console.log("SAVED SUCCESS");

      // Clear fields
      document.getElementById("expenses-date").value = "";
      document.getElementById("expenses-category").selectedIndex = 0;
      document.getElementById("expenses-description").value = "";
      document.getElementById("expenses-amount").value = "";
      document.getElementById("expenses-status").selectedIndex = 0;

      // Refresh select UI
      const selects = document.querySelectorAll("select");
      M.FormSelect.init(selects);

      modalInstance.close();
    } catch (err) {
      console.error("SAVE ERROR:", err);
      alert("Failed to save expense");
    }
  });

  console.log("Expenses Init Loaded");
}