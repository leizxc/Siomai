import { db, storage } from "/js/firebase.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteField,
  doc,
  serverTimestamp,
  onSnapshot,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

//global listener state
let unsubscribeInventoryOptions = null;
let unsubscribeProductIdPreview = null; //global listener state para sa live preview ng susunod na Product ID

// Kada tawag, tumataas ang counter (walang duplicate na product code).
// Tinatawag lang ito pag-Save, hindi pag-preview.
async function generateProductCode() {
  const counterRef = doc(db, "counters", "productCode");

  const nextNumber = await runTransaction(db, async (transaction) => {
    const counterSnap = await transaction.get(counterRef);
    const current = counterSnap.exists()
      ? counterSnap.data().lastNumber || 0
      : 0;
    const next = current + 1;

    transaction.set(counterRef, { lastNumber: next }, { merge: true });
    return next;
  });

  return `QC-${String(nextNumber).padStart(6, "0")}`;
}

// Kailangan i-destroy at i-init ulit ang Materialize select, dahil hindi
// ito automatic nag-re-refresh kapag dumagdag ng options after i-init.
function reinitSelect(selectEl) {
  if (!selectEl) return;
  const instance = M.FormSelect.getInstance(selectEl);
  if (instance) {
    instance.destroy();
  }
  M.FormSelect.init(selectEl);
}

//invetory allocation
export function loadInventoryOptions(role = "") {
  const select = document.getElementById("employeeINV");
  if (!select) return;

  if (unsubscribeInventoryOptions) {
    unsubscribeInventoryOptions();
  }
  let q = collection(db, "inventory");
  if (role) {
    q = query(collection(db, "inventory"), where("role", "==", role));
  }

  unsubscribeInventoryOptions = onSnapshot(q, (snapshot) => {
    if (!select.isConnected) return;

    select.innerHTML = `<option value="" disabled selected>Inventory Allocation</option>`;

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.status === "On Selling") return;

      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = data.product_name;
      select.appendChild(option);
    });

    reinitSelect(select);
  });
}

//load roles
export async function loadroles() {
  const roleSelect = document.getElementById("selectCategory");

  if (!roleSelect) return;
  const snap = await getDocs(collection(db, "employees"));
  const roles = new Set();

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    if (data.role) {
      roles.add(data.role.trim());
    }
  });
  roleSelect.innerHTML = `<option value= "" disabled selected>Select Category</option>`;

  roles.forEach((role) => {
    const option = document.createElement("option");
    option.value = role;
    option.textContent = role;
    roleSelect.appendChild(option);
  });
  reinitSelect(roleSelect);
}

// "Preview" lang ito ng susunod na ID (hindi tumataas ang counter dito).
// Kada may na-save na product (kahit ibang admin), live na nag-uupdate ito
// dahil naka-onSnapshot sa counter doc mismo.
function previewNextProductId() {
  const productIdInput = document.getElementById("productId");
  if (!productIdInput) return;

  if (unsubscribeProductIdPreview) {
    unsubscribeProductIdPreview();
  }

  const counterRef = doc(db, "counters", "productCode");

  unsubscribeProductIdPreview = onSnapshot(counterRef, (snap) => {
    if (!productIdInput.isConnected) return;

    const current = snap.exists() ? snap.data().lastNumber || 0 : 0;
    const next = current + 1;

    productIdInput.value = `QC-${String(next).padStart(6, "0")}`;
  });
}

//img function to firebase
async function uploadProductImage() {
  const fileInput = document.getElementById("inputImg");
  const file = fileInput.files[0];

  if (!file) return "";

  const formData = new FormData();

  formData.append("file", file);
  formData.append("upload_preset", "Queen_Cassy_Product_Menu");

  const response = await fetch(
    "https://api.cloudinary.com/v1_1/ht5i99mv/image/upload",
    {
      method: "POST",
      body: formData,
    },
  );

  if (!response.ok) {
    const error = await response.json();
    console.error(error);
    throw new Error("Image upload failed.");
  }

  const data = await response.json();

  return data.secure_url;
}

//save button
export function addproductmenu() {
  const form = document.getElementById("addProductMenu");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      const inventoryId = document.getElementById("employeeINV").value;
      const productName = document.getElementById("inputProduct").value.trim();
      const role = document.getElementById("selectCategory").value;
      const stock = Number(document.getElementById("stock").value);
      const price = Number(document.getElementById("price").value);

      if (!inventoryId || !productName || !role || stock <= 0 || price <= 0) {
        M.toast({
          html: "Please complete all fields.",
          classes: "red rounded",
        });
        return;
      }

      // Permanent Product Code
      const productCode = await generateProductCode();

      //img
      const imageURL = await uploadProductImage();

      // Inventory Details
      const inventorySnap = await getDoc(doc(db, "inventory", inventoryId));

      if (!inventorySnap.exists()) {
        M.toast({ html: "Inventory not found." });
        return;
      }

      const inventory = inventorySnap.data();

      // Save Firestore
      await addDoc(collection(db, "productMenu"), {
        product_code: productCode,
        product_name: productName,
        category: role,
        inventory_id: inventoryId,
        inventory_name: inventory.product_name,
        initial_stock: stock,
        current_stock: stock,
        price: price,
        image_url: imageURL,
        status: "Available",
        created_at: serverTimestamp(),
      });

      M.toast({ html: "Product Menu Saved!", classes: "green rounded" });

      form.reset();

      // Clear image
      document.getElementById("inputImg").value = "";
      document.getElementById("previewImage").src =
        "/assets/upload-placeholder.png";

      M.updateTextFields();

      reinitSelect(document.getElementById("employeeINV"));
      reinitSelect(document.getElementById("selectCategory"));

      previewNextProductId();
    } catch (error) {
      console.error(error);

      M.toast({
        html: "Error saving product.",
      });
    }
  });
}

//export function to functionalnav.js
export async function initProductPage() {
  loadInventoryOptions();
  loadroles();
  previewNextProductId();
  addproductmenu();
  uploadProductImage();
}
