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

//filters logic
const filterDateInput = document.getElementById("filter-date");
const filterCategorySelect = document.getElementById("filter-category");

let currentFilterDate = "";
let currentFilterCategory = "all";

filterDateInput.addEventListener("change", (e) => {
  currentFilterDate = filterDateInput.value;
  loadExpenses();
});

filterCategorySelect.addEventListener("change", (e) => {
  currentFilterCategory = filterCategorySelect.value;
  loadExpenses();
});

// Load expenses data with realtime listener
let unsubscribeExpenses = null;

export function loadExpenses() {
  const tbody = document.getElementById("expenses-table-body");

  // If a listener from a previous call/visit is still running, stop it
  // first instead of letting listeners stack up.
  if (unsubscribeExpenses) {
    unsubscribeExpenses();
    unsubscribeExpenses = null;
  }

  unsubscribeExpenses = onSnapshot(collection(db, "expenses"), (querySnapshot) => {
    // If the user has navigated away from the expenses page since this
    // listener was attached, its DOM nodes may be gone. Bail out instead
    // of crashing on a null element.
    const totalTodayEl = document.getElementById("total-today");
    const totalMonthEl = document.getElementById("total-month");
    const avgDailyEl = document.getElementById("avg-daily");
    const tbodyEl = document.getElementById("expenses-table-body");

    if (!totalTodayEl || !totalMonthEl || !avgDailyEl || !tbodyEl) {
      // Page isn't showing anymore — stop listening so this doesn't
      // keep firing forever in the background.
      if (unsubscribeExpenses) {
        unsubscribeExpenses();
        unsubscribeExpenses = null;
      }
      return;
    }

    tbodyEl.innerHTML = "";

    let totalToday = 0;
    let totalMonth = 0;
    const daysWithExpenses = new Set();

    const today = new Date().toISOString().split("T")[0];
    const currentMonth = today.slice(0, 7); // e.g. "2026-06"

    // Loop through all expense documents
    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const expenseDate = data.date;
      const amount = parseFloat(data.amount);

      // Category filter affects BOTH the summary totals and the table —
      // e.g. picking "Siomai" should show Siomai-only totals.
      const matchesCategory =
        currentFilterCategory === "all" ||
        data.category === currentFilterCategory;

      if (!matchesCategory) return;

      // Totals always reflect the real "today" / current month, no
      // matter which date the user has picked in filter-date to browse
      // the table with.
      if (expenseDate === today) totalToday += amount;
      if (expenseDate.startsWith(currentMonth)) {
        totalMonth += amount;
        daysWithExpenses.add(expenseDate);
      }

      // The date filter only controls which rows get rendered in the
      // table below — it no longer affects the totals above.
      if (currentFilterDate && expenseDate !== currentFilterDate) return;

      // Render table row
      tbodyEl.innerHTML += `
        <tr data-id="${docSnap.id}">
          <td data-label="Date">${expenseDate}</td>
          <td data-label="Category">${data.category}</td>
          <td data-label="Description">${data.description}</td>
          <td data-label="Amount">₱${amount.toFixed(2)}</td>
          <td data-label="Status">${data.status}</td>
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

    // Update summary cards
    totalTodayEl.textContent = `₱${totalToday.toFixed(2)}`;
    totalMonthEl.textContent = `₱${totalMonth.toFixed(2)}`;
    const avgDaily = totalMonth / (daysWithExpenses.size || 1);
    avgDailyEl.textContent = `₱${avgDaily.toFixed(2)}`;

    // Delete button logic
    document.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        const id = e.target.closest("button").dataset.id;
        await deleteExpense(id);
      };
    });

    // Edit button logic
    document.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.onclick = async (e) => {
        const id = e.target.closest("button").dataset.id;
        const row = e.target.closest("tr");

        // Fill modal fields (matching your HTML IDs)
        document.getElementById("edit-expenses-date").value =
          row.children[0].textContent;
        document.getElementById("edit-expenses-category").value =
          row.children[1].textContent;
        document.getElementById("edit-expenses-description").value =
          row.children[2].textContent;
        document.getElementById("edit-expenses-amount").value =
          row.children[3].textContent.replace("₱", "");
        document.getElementById("edit-expenses-status").value =
          row.children[4].textContent;

        // Guard against the select not being present (page navigated
        // away, or Materialize markup not mounted yet).
        const selects = document.querySelectorAll("select");
        if (selects.length) M.FormSelect.init(selects);

        //initialize and open modal
        const modalElem = document.getElementById("modal-edit");
        if (!modalElem) return;
        const modalInstance = M.Modal.init(modalElem);
        modalInstance.open();

        // Save changes — clear old listener first
        const saveBtn = document.getElementById("edit-save");
        saveBtn.onclick = null; // remove any previous handler
        saveBtn.onclick = async () => {
          const newDate = document.getElementById("edit-expenses-date").value;
          const newCategory = document.getElementById(
            "edit-expenses-category",
          ).value;
          const newDescription = document.getElementById(
            "edit-expenses-description",
          ).value;
          const newAmount = parseFloat(
            document.getElementById("edit-expenses-amount").value,
          );
          const newStatus = document.getElementById(
            "edit-expenses-status",
          ).value;

          await updateDoc(doc(db, "expenses", id), {
            date: newDate,
            category: newCategory,
            description: newDescription,
            amount: newAmount,
            status: newStatus,
            last_updated: serverTimestamp(),
          });

          modalInstance.close();
        };
      };
    });
  });

  return unsubscribeExpenses;
}

// Call this when the user navigates away from the expenses page, so the
// Firestore listener stops running (and stops trying to touch a DOM
// that's no longer there).
export function stopLoadingExpenses() {
  if (unsubscribeExpenses) {
    unsubscribeExpenses();
    unsubscribeExpenses = null;
  }
}

// Add new expense
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

// Delete expense
export async function deleteExpense(id) {
  await deleteDoc(doc(db, "expenses", id));
}