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
export function loadExpenses() {
  const tbody = document.getElementById("expenses-table-body");

  onSnapshot(collection(db, "expenses"), (querySnapshot) => {
    tbody.innerHTML = "";

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

      //Filter Logic
      if (currentFilterDate && expenseDate !== currentFilterDate) return;
      if (
        currentFilterCategory !== "all" &&
        data.category !== currentFilterCategory
      )
        return;

      // Calculate totals
      if (expenseDate === today) totalToday += amount;
      if (expenseDate.startsWith(currentMonth)) {
        totalMonth += amount;
        daysWithExpenses.add(expenseDate);
      }

      // Render table row
      tbody.innerHTML += `
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
    document.getElementById("total-today").textContent =
      `₱${totalToday.toFixed(2)}`;
    document.getElementById("total-month").textContent =
      `₱${totalMonth.toFixed(2)}`;
    const avgDaily = totalMonth / (daysWithExpenses.size || 1);
    document.getElementById("avg-daily").textContent =
      `₱${avgDaily.toFixed(2)}`;

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

        M.FormSelect.init(document.querySelectorAll("select"));
        //initialize and open modal
        const modalElem = document.getElementById("modal-edit");
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
