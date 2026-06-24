import { db } from "/js/firebase.js";
import {
    collection,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function loadProducts() {
    const tbody = document.querySelector("#productTable tbody");
    const filterSelect = document.getElementById("filterEmployee");
    if (!tbody || !filterSelect) return;

    //  Load employees for filter dropdown
    const empSnap = await getDocs(collection(db, "employees"));
    const employeesMap = {}; // store employee data for quick lookup
    filterSelect.innerHTML = `<option value="" selected>All Employees</option>`;
    empSnap.forEach((docSnap) => {
        const data = docSnap.data();
        employeesMap[docSnap.id] = data;
        const option = document.createElement("option");
        option.value = docSnap.id;
        option.textContent = `${data.fname} ${data.lname} (${data.role})`;
        filterSelect.appendChild(option);
    });
    M.FormSelect.init(filterSelect);

    //  Render products with optional filter
    function renderProducts(employeeId = "") {
        let q = collection(db, "products");
        if (employeeId) {
            q = query(collection(db, "products"), where("employeeId", "==", employeeId));
        }

        onSnapshot(q, (querySnapshot) => {
            tbody.innerHTML = "";
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const empData = employeesMap[data.employeeId] || {};
                const empDisplay = empData.fname
                    ? `${empData.fname} ${empData.lname} (${empData.role})`
                    : data.employeeId;

                const row = document.createElement("tr");
                row.innerHTML = `
  <td data-label="Product Name">${data.name}</td>
  <td data-label="Product Price">₱${parseFloat(data.price).toFixed(2)}</td>
  <td data-label="Product Stock">${data.stock}</td>
  <td data-label="Role">${data.role}</td>
  <td data-label="Employee">${empDisplay}</td>
  <td data-label="Action">
    <button class="btn blue edit-btn" data-id="${docSnap.id}">
      <i class="material-icons">edit</i>
    </button>
    <button class="btn red delete-btn" data-id="${docSnap.id}">
      <i class="material-icons">delete</i>
    </button>
  </td>
`;

                tbody.appendChild(row);
            });

            // Delete logic
            document.querySelectorAll(".delete-btn").forEach((btn) => {
                btn.onclick = async () => {
                    const id = btn.dataset.id;
                    await deleteDoc(doc(db, "products", id));
                };
            });
            //edit logic
            document.querySelectorAll(".edit-btn").forEach((btn) => {
                btn.onclick = (e) =>{
                    const id = e.target.closest("button").dataset.id;
                    const row = e.target.closest("tr");

                    document.getElementById("edit-name").value = row.children[0].textContent;
                    document.getElementById("edit-price").value = row.children[1].textContent.replace("₱", "");
                    document.getElementById("edit-stock").value = row.children[2].textContent;
                    
                    M.updateTextFields();
                    M.FormSelect.init(document.querySelectorAll("select"));
                    
                    const modalElem = document.getElementById("modal-edit-product");
                    const modalInstance = M.Modal.init(modalElem);
                    modalInstance.open();
                    

                    const saveBtn = document.getElementById("edit-save");
                    saveBtn.onclick = async () => {
                        const newName = document.getElementById("edit-name").value;
                        const newPrice = parseFloat(document.getElementById("edit-price").value);
                        const newStock = parseInt(document.getElementById("edit-stock").value);

                        await updateDoc(doc(db, "products", id), {
                            name: newName,
                            price: newPrice,
                            stock: newStock
                        });
                        modalInstance.close();
                    }
                }
            });
            
        });
    }

    //  Initial load
    renderProducts();

    //  Filter change
    filterSelect.addEventListener("change", () => {
        const selectedEmployee = filterSelect.value;
        renderProducts(selectedEmployee);
    });
}

loadProducts();
