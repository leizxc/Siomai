// employee.js
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { app } from "/js/firebase.js";
import { loadProductsOffline } from "./IndexDB.js";

const db = getFirestore(app);
const auth = getAuth(app);

let cart = JSON.parse(localStorage.getItem("cart")) || [];

function formatQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return "0";
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}

// INIT POS
export async function initPOS() {
  cart = JSON.parse(localStorage.getItem("get")) || [];

  // Firebase Auth restores the session asynchronously — auth.currentUser
  // can still be null right after page load even if the person is
  // already logged in, unless we wait for this to resolve first.
  const user = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      unsubscribe();
      resolve(u);
    });
  });

  const currentEmployeeId = user ? user.uid : null;

  if (!navigator.onLine) {
    console.log("Offline mode: loading from IndexedDB");
    await loadProductsOffline(currentEmployeeId);
    identifyCart();
    setupCartEvents();
    return;
  }
  await loadProducts();
  identifyCart();
  setupCartEvents();
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
}

// Kunin ang role ng naka-login na employee, hanapin sa "employees"
// collection gamit ang Auth uid (hindi doc ID mismo).
async function getCurrentEmployeeRole() {
  const user = auth.currentUser;
  if (!user) return null;

  const q = query(collection(db, "employees"), where("uid", "==", user.uid));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  return snap.docs[0].data().role || null;
}

// LOAD PRODUCTS
async function loadProducts() {
  const productGrid = document.getElementById("productList");
  productGrid.innerHTML = "";

  const role = await getCurrentEmployeeRole();
  if (!role) {
    console.error("No role found for current employee.");
    return;
  }

  // Ipakita lang ang mga product na naka-assign sa role na ito, o yung
  // naka-mark na "ALL" (shared across every role).
  const q = query(
    collection(db, "products"),
    where("role", "in", [role, "ALL"]),
  );
  const querySnapshot = await getDocs(q);

  querySnapshot.forEach((docSnap) => {
    const product = docSnap.data();
    const pieces = Number(product.pieces ?? product.stock) || 0;
    const piecesPerPack = Number(product.pieces_per_pack) || 1;
    const packs = product.unit === "pack"
      ? Math.ceil(pieces / piecesPerPack)
      : null;

    const card = document.createElement("div");
    card.classList.add("product-card");
    card.innerHTML = `
<div class="product-card">

    <img
        src="${product.image || "/images/no-image.png"}"
        class="product-image">

    <div class="product-info">

        <h4>${product.name}</h4>

        <span class="product-stock">${product.unit === "pack"
          ? `${formatQuantity(packs)} packs · ${formatQuantity(pieces)} pcs`
          : `${formatQuantity(pieces)} ${product.unit || "pcs"}`}</span>

        <span class="price">
            ₱${Number(product.price).toFixed(2)}
        </span>

    </div>

    <button
        class="add-btn"
        data-id="${docSnap.id}"
        data-name="${product.name}"
        data-price="${product.price}"
        data-stock="${pieces}"
        data-packs="${packs ?? ""}"
        data-pieces-per-pack="${piecesPerPack}"
        data-unit="${product.unit || "piece"}">
        <i class="material-icons">add</i>
    </button>

</div>
`;
    productGrid.appendChild(card);
  });

  document.querySelectorAll(".add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      const price = parseFloat(btn.dataset.price);
      const stock = parseInt(btn.dataset.stock);
      addToCart({
        id,
        name,
        price,
        stock,
        packs: btn.dataset.packs === "" ? null : Number(btn.dataset.packs),
        pieces_per_pack: Number(btn.dataset.piecesPerPack) || 1,
        unit: btn.dataset.unit,
      });
    });
  });
}

// ADD TO CART
function addToCart(product) {
  const existing = cart.find((item) => item.id === product.id);
  if (existing) {
    if (existing.qty < product.stock) {
      existing.qty += 1;
    } else {
      alert("Not enough stock!");
    }
  } else {
    cart.push({ ...product, qty: 1 });
  }
  saveCart();
  identifyCart();
}

// RENDER CART
function identifyCart() {
  if (window.innerWidth <= 768) {
    renderMobileCart();
  } else {
    renderCart();
  }
}
//mobile
function renderMobileCart() {
  let total = 0;
  let items = 0;

  cart.forEach((item) => {
    total += item.price * item.qty;
    items += item.qty;
  });

  document.querySelector(".cart-count").textContent = `${items} Items`;
  document.getElementById("grandTotal").textContent = total.toFixed(2);
}

//desktop
function renderCart() {
  const tbody = document.querySelector("#cartTable tbody");
  tbody.innerHTML = "";

  let grandTotal = 0;

  cart.forEach((item, index) => {
    const total = item.qty * item.price;
    grandTotal += total;

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.name}</td>
      <td><input type="number" min="1" max="${item.stock}" value="${item.qty}" data-index="${index}" class="qty-input"></td>
      <td>₱${item.price.toFixed(2)}</td>
      <td>₱${total.toFixed(2)}</td>
      <td><button class="btn red remove-btn" data-index="${index}">Remove</button></td>
    `;
    tbody.appendChild(row);
  });

  document.getElementById("grandTotal").textContent = grandTotal.toFixed(2);

  // Quantity change
  document.querySelectorAll(".qty-input").forEach((input) => {
    input.addEventListener("change", (e) => {
      const idx = e.target.dataset.index;
      cart[idx].qty = parseInt(e.target.value);
      saveCart();
      identifyCart();
    });
  });

  // Remove item
  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = e.target.dataset.index;
      cart.splice(idx, 1);
      saveCart();
      identifyCart();
    });
  });
}

// ADD ORDER (save to Firestore)
async function addOrder(orderItems) {
  const user = auth.currentUser;
  const orderRef = await addDoc(collection(db, "orders"), {
    items: orderItems,
    employee: user ? user.uid : "guest",
    created_at: serverTimestamp(),
    status: "paid",
  });

  for (const item of orderItems) {
    const productRef = doc(db, "products", item.id);
    await updateDoc(productRef, {
      stock: item.stock - item.qty,
      pieces: item.stock - item.qty,
      packs: item.unit === "pack"
        ? Math.ceil((item.stock - item.qty) / item.pieces_per_pack)
        : null,
    });
  }

  alert("Order placed successfully!");
  return orderRef.id;
}

// CHECKOUT
async function checkout() {
  if (cart.length === 0) {
    alert("Cart is empty!");
    return;
  }

  await addOrder(cart);
  cart = [];
  identifyCart();
}

// SETUP EVENTS
function setupCartEvents() {
  const checkoutBtn = document.getElementById("checkoutBtn");

  checkoutBtn.addEventListener("click", () => {
    if (cart.length === 0) {
      alert("Cart is empty!");
      return;
    }

    // Save cart
    localStorage.setItem("cart", JSON.stringify(cart));

    window.location.href = "/employee/siomai/vieworder.html";
  });
}

window.addEventListener("pageshow", () => {
  cart = JSON.parse(localStorage.getItem("cart")) || [];

  identifyCart();
});
