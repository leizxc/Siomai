// adminExpenses.js
import { db } from "/js/firebase.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let expenseToDelete = null;

// PAGINATION
const PAGE_SIZE = 10;
let currentPage = 1;

// Cache ng filtered expenses
let expenseListCache = [];

// FILTERS
const filterDateInput = document.getElementById("filter-date");
const filterCategorySelect = document.getElementById("filter-category");

let currentFilterDate = "";
let currentFilterCategory = "all";

filterDateInput?.addEventListener("change", () => {
  currentFilterDate = filterDateInput.value;
  currentPage = 1;
  loadExpenses();
});

filterCategorySelect?.addEventListener("change", () => {
  currentFilterCategory = filterCategorySelect.value;
  currentPage = 1;
  loadExpenses();
});

// Destroy muna bago i-init, para hindi ma-corrupt ang select state
function reinitSelect(selectEl) {
  if (!selectEl) return;
  const instance = M.FormSelect.getInstance(selectEl);
  if (instance) instance.destroy();
  M.FormSelect.init(selectEl);
}

// ===============================
// REALTIME LISTENER
// ===============================
let unsubscribeExpenses = null;

export function loadExpenses() {
  if (unsubscribeExpenses) {
    unsubscribeExpenses();
    unsubscribeExpenses = null;
  }

  unsubscribeExpenses = onSnapshot(
    collection(db, "expenses"),
    (querySnapshot) => {
      const tbody = document.getElementById("expenses-table-body");
      const totalTodayEl = document.getElementById("total-today");
      const totalMonthEl = document.getElementById("total-month");
      const avgDailyEl = document.getElementById("avg-daily");

      if (!tbody || !totalTodayEl || !totalMonthEl || !avgDailyEl) {
        if (unsubscribeExpenses) {
          unsubscribeExpenses();
          unsubscribeExpenses = null;
        }
        return;
      }

      expenseListCache = [];

      let totalToday = 0;
      let totalMonth = 0;

      const daysWithExpenses = new Set();

      // Kung may napiling date sa filter, iyon ang gagamitin.
      // Kung wala, current date ang default.
      const selectedDate =
        currentFilterDate || new Date().toISOString().split("T")[0];

      const currentMonth = selectedDate.slice(0, 7);

      querySnapshot.forEach((docSnap) => {
        const data = docSnap.data();

        const expenseDate = data.date;

        const amount = Number(data.amount) || 0;

        const matchesCategory =
          currentFilterCategory === "all" ||
          data.category === currentFilterCategory;

        if (!matchesCategory) return;

        // TODAY CARD
        if (expenseDate === selectedDate) {
          totalToday += amount;
        }

        // MONTH CARD
        if (expenseDate.startsWith(currentMonth)) {
          totalMonth += amount;
          daysWithExpenses.add(expenseDate);
        }

        // Date filter
        if (currentFilterDate && expenseDate !== currentFilterDate) return;

        // Save to cache
        expenseListCache.push({
          id: docSnap.id,
          data,
        });
      });

      // Summary Update
      totalTodayEl.textContent = `₱${totalToday.toFixed(2)}`;

      totalMonthEl.textContent = `₱${totalMonth.toFixed(2)}`;

      const avgDaily =
        daysWithExpenses.size > 0 ? totalMonth / daysWithExpenses.size : 0;

      avgDailyEl.textContent = `₱${avgDaily.toFixed(2)}`;

      // Render current page
      renderExpensePage();
    },
  );

  return unsubscribeExpenses;
}

// RENDER CURRENT PAGE

function renderExpensePage() {
  const tbody = document.getElementById("expenses-table-body");

  if (!tbody) return;

  tbody.innerHTML = "";

  // Total pages
  const totalPages = Math.max(
    1,
    Math.ceil(expenseListCache.length / PAGE_SIZE),
  );

  // Prevent invalid page
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  // Current page records
  const start = (currentPage - 1) * PAGE_SIZE;

  const pageItems = expenseListCache.slice(start, start + PAGE_SIZE);

  // Render only 10 rows
  pageItems.forEach(({ id, data }, index) => {
    tbody.innerHTML += `
      <tr data-id="${id}">
        <td data-label="#">${start + index + 1}</td>

        <td data-label="Date">
          ${data.date}
        </td>

        <td data-label="Category">
          ${data.category}
        </td>

        <td data-label="Description">
          ${data.description}
        </td>

        <td data-label="Amount">
          ₱${Number(data.amount).toFixed(2)}
        </td>

        <td data-label="Status">
          ${data.status}
        </td>

        <td data-label="Action">

          <button
            class="edit-btn waves-effect waves-light btn blue"
            data-id="${id}">

            <i class="material-icons">
              edit
            </i>

          </button>

          <button
            class="delete-btn waves-effect waves-light btn red"
            data-id="${id}">

            <i class="material-icons">
              delete
            </i>

          </button>

        </td>

      </tr>
    `;
  });
  // Update pagination buttons
  updateExpensePagination(totalPages);

  // Bind edit/delete
  bindExpenseButtons();

  // Initialize delete modal
  initDeleteExpenseModal();
}

export function stopLoadingExpenses() {
  if (unsubscribeExpenses) {
    unsubscribeExpenses();
    unsubscribeExpenses = null;
  }
}

// ADD NEW EXPENSE
export async function addExpense(date, category, description, amount, status) {
  await addDoc(collection(db, "expenses"), {
    date,
    category,
    description,
    amount,
    status,
    last_updated: serverTimestamp(),
  });
}

// BIND EDIT & DELETE BUTTONS

function bindExpenseButtons() {
  // DELETE

  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.onclick = (e) => {
      expenseToDelete = e.currentTarget.dataset.id;

      const modalElem = document.getElementById("modal-delete-expense");

      // Wala palang ganitong modal sa DOM — gamitin na lang ang plain
      // confirm() para hindi mag-crash at gumana pa rin ang delete.
      if (!modalElem) {
        const id = expenseToDelete;
        expenseToDelete = null;

        if (!window.confirm("Delete this expense?")) return;

        deleteExpense(id)
          .then(() => {
            M.toast({
              html: "Expense deleted successfully!",
              classes: "green rounded",
            });
          })
          .catch((err) => {
            console.error(err);
            M.toast({
              html: "Failed to delete expense.",
              classes: "red rounded",
            });
          });

        return;
      }

      let modal = M.Modal.getInstance(modalElem);

      if (!modal) {
        modal = M.Modal.init(modalElem);
      }

      modal.open();
    };
  });

  // EDIT

  document.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.onclick = (e) => {
      const id = e.currentTarget.dataset.id;

      const row = e.currentTarget.closest("tr");

      // Fill inputs
      document.getElementById("edit-expenses-date").value =
        row.children[1].textContent.trim();

      document.getElementById("edit-expenses-category").value =
        row.children[2].textContent.trim();

      document.getElementById("edit-expenses-description").value =
        row.children[3].textContent.trim();

      document.getElementById("edit-expenses-amount").value =
        row.children[4].textContent.replace("₱", "").trim();

      document.getElementById("edit-expenses-status").value =
        row.children[5].textContent.trim();

      M.updateTextFields();

      const editCategory = document.getElementById("edit-expenses-category");
      const editStatus = document.getElementById("edit-expenses-status");

      reinitSelect(editCategory);
      reinitSelect(editStatus);

      const modalElem = document.getElementById("modal-edit");

      if (!modalElem) return;

      let modalInstance = M.Modal.getInstance(modalElem);

      if (!modalInstance) {
        modalInstance = M.Modal.init(modalElem);
      }

      modalInstance.open();

      const saveBtn = document.getElementById("edit-save");

      saveBtn.onclick = async () => {
        const newDate = document.getElementById("edit-expenses-date").value;

        const newCategory = document.getElementById(
          "edit-expenses-category",
        ).value;

        const newDescription = document
          .getElementById("edit-expenses-description")
          .value.trim();

        const newAmount = parseFloat(
          document.getElementById("edit-expenses-amount").value,
        );

        const newStatus = document.getElementById("edit-expenses-status").value;

        if (
          !newDate ||
          !newCategory ||
          !newDescription ||
          isNaN(newAmount) ||
          !newStatus
        ) {
          M.toast({
            html: "Please fill all fields.",
            classes: "red rounded",
          });

          return;
        }

        await updateDoc(doc(db, "expenses", id), {
          date: newDate,
          category: newCategory,
          description: newDescription,
          amount: newAmount,
          status: newStatus,
          last_updated: serverTimestamp(),
        });

        modalInstance.close();

        M.toast({
          html: "Expense updated successfully!",
          classes: "green rounded",
        });
      };
    };
  });
}

function initDeleteExpenseModal() {
  const modalElem = document.getElementById("modal-delete-expense");

  if (!modalElem) return;

  let modal = M.Modal.getInstance(modalElem);

  if (!modal) {
    modal = M.Modal.init(modalElem, {
      onCloseEnd() {
        // Clear selected expense kapag naisara ang modal
        expenseToDelete = null;
      },
    });
  }

  const confirmBtn = document.getElementById("confirm-delete-expense");

  if (!confirmBtn) return;

  confirmBtn.onclick = async () => {
    if (!expenseToDelete) return;

    try {
      await deleteExpense(expenseToDelete);

      // Isara muna ang modal
      modal.close();

      M.toast({
        html: "Expense deleted successfully!",
        classes: "green rounded",
      });
    } catch (err) {
      console.error(err);

      M.toast({
        html: "Failed to delete expense.",
        classes: "red rounded",
      });
    }
  };
}

export async function deleteExpense(id) {
  try {
    await deleteDoc(doc(db, "expenses", id));

    // Kung wala nang laman ang current page,
    // bumalik sa previous page.
    const totalAfterDelete = expenseListCache.length - 1;
    const totalPagesAfterDelete = Math.max(
      1,
      Math.ceil(totalAfterDelete / PAGE_SIZE),
    );

    if (currentPage > totalPagesAfterDelete) {
      currentPage = totalPagesAfterDelete;
    }
  } catch (error) {
    console.error("Delete Expense Error:", error);
    throw error;
  }
}

// PAGINATION INFO

function updateExpensePagination(totalPages) {
  const prevBtn = document.getElementById("expense-prev");
  const nextBtn = document.getElementById("expense-next");
  const pageLabel = document.getElementById("expense-page");
  const infoLabel = document.getElementById("expense-info");

  if (!prevBtn || !nextBtn || !pageLabel) return;

  // Fix current page kapag nabawasan ang records
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  if (currentPage < 1) {
    currentPage = 1;
  }

  const start =
    expenseListCache.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;

  const end = Math.min(currentPage * PAGE_SIZE, expenseListCache.length);

  if (infoLabel) {
    infoLabel.textContent = `Showing: ${expenseListCache.length} Expenses data record`;
  }

  pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;

  prevBtn.disabled = currentPage === 1;
  nextBtn.disabled = currentPage === totalPages || totalPages === 0;

  prevBtn.onclick = () => {
    if (currentPage > 1) {
      currentPage--;

      renderExpensePage();
    }
  };

  nextBtn.onclick = () => {
    if (currentPage < totalPages) {
      currentPage++;

      renderExpensePage();
    }
  };
}
