// GET CART
import { db } from "/js/firebase.js";
import {
  addDoc,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let cart = JSON.parse(localStorage.getItem("cart")) || [];

const orderList = document.getElementById("orderList");
const totalItems = document.getElementById("totalItems");
const orderTotal = document.getElementById("orderTotal");

const cashBtn = document.getElementById("cashBtn");
const cashlessBtn = document.getElementById("cashlessBtn");
const checkoutBtn = document.getElementById("checkoutBtn");
const backBtn = document.getElementById("backBtn");

let paymentMethod = "Cash";

// Deduct all cart items in one transaction. Stock is measured in pieces;
// pack count is derived from those remaining pieces for pack products.
async function completeCheckout() {
  await runTransaction(db, async (transaction) => {
    const productSnapshots = await Promise.all(
      cart.map((item) => transaction.get(doc(db, "products", item.id))),
    );

    productSnapshots.forEach((productSnap, index) => {
      const item = cart[index];
      if (!productSnap.exists()) throw new Error(`${item.name} is no longer available.`);

      const product = productSnap.data();
      const availablePieces = Number(product.pieces ?? product.stock) || 0;
      if (availablePieces < item.qty) throw new Error(`Not enough stock for ${item.name}.`);

      const remainingPieces = availablePieces - item.qty;
      const piecesPerPack = Number(product.pieces_per_pack) || 1;
      transaction.update(productSnap.ref, {
        stock: remainingPieces,
        pieces: remainingPieces,
        packs: product.unit === "pack" ? Math.ceil(remainingPieces / piecesPerPack) : null,
      });
    });
  });

  await addDoc(collection(db, "orders"), {
    items: cart,
    payment_method: paymentMethod,
    created_at: serverTimestamp(),
    status: "paid",
  });
}

// RENDER ORDER

function renderOrder() {
  orderList.innerHTML = "";

  let total = 0;
  let items = 0;

  if (cart.length === 0) {
    orderList.innerHTML = `
            <h5 style="text-align:center;margin-top:80px;">
                No orders yet.
            </h5>
        `;

    totalItems.textContent = "0";
    orderTotal.textContent = "0.00";

    return;
  }

  cart.forEach((item, index) => {
    const subtotal = item.price * item.qty;

    total += subtotal;
    items += item.qty;

    const card = document.createElement("div");

    card.className = "order-item";

    card.innerHTML = `
            <img
                class="order-image"
                src="${item.image || "/images/no-image.png"}">

            <div class="order-info">
                <small>Product</small>
                <h6>${item.name}</h6>
                <p>₱${item.price.toFixed(2)}</p>
            </div>

            <div class="qty-control">

                <button class="minus-btn" data-index="${index}">
                    <i class="material-icons">remove</i>
                </button>

                <span class="qty">${item.qty}</span>

                <button class="plus-btn" data-index="${index}">
                    <i class="material-icons">add</i>
                </button>

            </div>

            <div class="order-price">
                ₱${subtotal.toFixed(2)}
            </div>
        `;

    orderList.appendChild(card);
  });

  totalItems.textContent = items;
  orderTotal.textContent = total.toFixed(2);

  // PLUS BUTTON

  document.querySelectorAll(".plus-btn").forEach((btn) => {
    btn.onclick = () => {
      const index = btn.dataset.index;

      if (cart[index].qty >= cart[index].stock) {
        alert("Not enough stock!");
        return;
      }

      cart[index].qty++;
      localStorage.setItem("cart", JSON.stringify(cart));
      window.dispatchEvent(new Event("storage"));
      renderOrder();
    };
  });

  // MINUS BUTTON

  document.querySelectorAll(".minus-btn").forEach((btn) => {
    btn.onclick = () => {
      const index = btn.dataset.index;

      if (cart[index].qty > 1) {
        cart[index].qty--;
      } else {
        cart.splice(index, 1);
      }

      localStorage.setItem("cart", JSON.stringify(cart));

      renderOrder();
    };
  });
}

// PAYMENT

cashBtn.onclick = () => {
  paymentMethod = "Cash";

  cashBtn.classList.add("active");
  cashlessBtn.classList.remove("active");
};

cashlessBtn.onclick = () => {
  paymentMethod = "Cashless";

  cashlessBtn.classList.add("active");
  cashBtn.classList.remove("active");
};

// BACK

backBtn.onclick = () => {
  window.history.back();
};

// CHECKOUT

checkoutBtn.onclick = async () => {
  if (cart.length === 0) {
    alert("Cart is empty!");
    return;
  }

  checkoutBtn.disabled = true;
  try {
    await completeCheckout();
  } catch (error) {
    console.error("Checkout error:", error);
    alert(error.message || "Unable to complete checkout.");
    checkoutBtn.disabled = false;
    return;
  }

  alert(`Checkout Success!\nPayment Method: ${paymentMethod}`);

  

  cart = [];
  localStorage.setItem("cart", JSON.stringify(cart));
  renderOrder();

  window.location.href = "/employee/siomai/userpanel.html";
};

renderOrder();
