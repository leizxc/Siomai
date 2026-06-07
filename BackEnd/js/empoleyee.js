// employee.js
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { app } from "./firebase.js";

const db = getFirestore(app);
const auth = getAuth(app);

let cart = [];

// INIT POS
export async function initPOS() {
  await loadProducts();
  setupCartEvents();
}

// LOAD PRODUCTS
async function loadProducts() {
  const productGrid = document.querySelector(".product-grid");
  productGrid.innerHTML = "";

  const querySnapshot = await getDocs(collection(db, "products"));
  querySnapshot.forEach((docSnap) => {
    const product = docSnap.data();

    const card = document.createElement("div");
    card.classList.add("product-card");
    card.innerHTML = `
      <h5>${product.name}</h5>
      <p>₱${product.price}</p>
      <button class="btn add-btn"
        data-id="${docSnap.id}"
        data-name="${product.name}"
        data-price="${product.price}"
        data-stock="${product.stock}">
        Add
      </button>
    `;
    productGrid.appendChild(card);
  });

  document.querySelectorAll(".add-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const name = btn.dataset.name;
      const price = parseFloat(btn.dataset.price);
      const stock = parseInt(btn.dataset.stock);
      addToCart({ id, name, price, stock });
    });
  });
}

// ADD TO CART
function addToCart(product) {
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    if (existing.qty < product.stock) {
      existing.qty += 1;
    } else {
      alert("Not enough stock!");
    }
  } else {
    cart.push({ ...product, qty: 1 });
  }
  renderCart();
}

// RENDER CART
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
  document.querySelectorAll(".qty-input").forEach(input => {
    input.addEventListener("change", (e) => {
      const idx = e.target.dataset.index;
      cart[idx].qty = parseInt(e.target.value);
      renderCart();
    });
  });

  // Remove item
  document.querySelectorAll(".remove-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const idx = e.target.dataset.index;
      cart.splice(idx, 1);
      renderCart();
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
    status: "pending"
  });

  for (const item of orderItems) {
    const productRef = doc(db, "products", item.id);
    await updateDoc(productRef, {
      stock: item.stock - item.qty
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
  renderCart();
}

// SETUP EVENTS
function setupCartEvents() {
  const checkoutBtn = document.getElementById("checkoutBtn");
  checkoutBtn?.addEventListener("click", checkout);
}
