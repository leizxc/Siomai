import { db, auth } from "/js/firebase.js";

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

const cashModalElement = document.getElementById("cashModal");
const cashlessModalElement = document.getElementById("cashlessModal");

const cashTotal = document.getElementById("cashTotal");
const cashlessTotal = document.getElementById("cashlessTotal");

const cashAmount = document.getElementById("cashAmount");
const cashChange = document.getElementById("cashChange");
const cashPaymentMessage = document.getElementById("cashPaymentMessage");
const confirmCashBtn = document.getElementById("confirmCashBtn");

const gcashBtn = document.getElementById("gcashBtn");
const paymayaBtn = document.getElementById("paymayaBtn");

const cashlessReferenceField = document.getElementById(
  "cashlessReferenceField"
);

const cashlessRefNo = document.getElementById("cashlessRefNo");
const confirmCashlessBtn = document.getElementById("confirmCashlessBtn");
const selectedProvider = document.getElementById("selectedProvider");

let paymentMethod = "Cash";
let paymentInfo = "";
let selectedCashlessProvider = "";

const cashModal = M.Modal.init(cashModalElement);
const cashlessModal = M.Modal.init(cashlessModalElement);

async function completeCheckout() {
  const employee = auth.currentUser;
  if (!employee) {
    throw new Error("Employee session expired. Please sign in again.");
  }

  await runTransaction(db, async (transaction) => {
    const productSnapshots = await Promise.all(
      cart.map((item) =>
        transaction.get(doc(db, "products", item.id))
      )
    );

    productSnapshots.forEach((productSnap, index) => {
      const item = cart[index];

      if (!productSnap.exists()) {
        throw new Error(`${item.name} is no longer available.`);
      }

      const product = productSnap.data();

      const availablePieces =
        Number(product.pieces ?? product.stock) || 0;

      if (availablePieces < item.qty) {
        throw new Error(`Not enough stock for ${item.name}.`);
      }

      const remainingPieces = availablePieces - item.qty;

      const piecesPerPack =
        Number(product.pieces_per_pack) || 1;

      transaction.update(productSnap.ref, {
        stock: remainingPieces,
        pieces: remainingPieces,
        packs:
          product.unit === "pack"
            ? Math.ceil(remainingPieces / piecesPerPack)
            : null,
      });
    });
  });

  await addDoc(collection(db, "orders"), {
    items: cart,
    employee: employee.uid,
    employeeUid: employee.uid,
    payment_method: paymentMethod,
    payment_info: paymentInfo,
    payment_provider:
      paymentMethod === "Cashless"
        ? selectedCashlessProvider
        : null,
    created_at: serverTimestamp(),
    status: "paid",
  });
}

function renderOrder() {
  orderList.innerHTML = "";

  let total = 0;
  let items = 0;

  if (cart.length === 0) {
    orderList.innerHTML = `
      <h5
        style="
          text-align:center;
          margin-top:80px;
        "
      >
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
        src="${item.image || "/assets/upload-placeholder.png"}"
      >

      <div class="order-info">
        <small>Product</small>

        <h6>
          ${item.name}
        </h6>

        <p>
          ₱${Number(item.price).toFixed(2)}
        </p>
      </div>

      <div class="qty-control">

        <button
          class="minus-btn"
          data-index="${index}"
        >
          <i class="material-icons">
            remove
          </i>
        </button>

        <span class="qty">
          ${item.qty}
        </span>

        <button
          class="plus-btn"
          data-index="${index}"
        >
          <i class="material-icons">
            add
          </i>
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

  document.querySelectorAll(".plus-btn").forEach((btn) => {
    btn.onclick = () => {
      const index = btn.dataset.index;

      if (cart[index].qty >= cart[index].stock) {
        M.toast({
          html: "Not enough stock!",
          classes: "red rounded",
        });

        return;
      }

      cart[index].qty++;

      localStorage.setItem("cart", JSON.stringify(cart));

      window.dispatchEvent(new Event("storage"));

      renderOrder();
    };
  });

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

function getOrderTotal() {
  return Number(orderTotal.textContent) || 0;
}

function updateCashlessTotal() {
  const total = getOrderTotal();

  cashlessTotal.textContent = total.toFixed(2);
}

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

checkoutBtn.onclick = () => {
  if (cart.length === 0) {
    M.toast({
      html: "Cart is empty!",
      classes: "red rounded",
    });

    return;
  }

  if (paymentMethod === "Cash") {
    const total = getOrderTotal();

    cashTotal.textContent = total.toFixed(2);

    cashAmount.value = "";
    cashChange.textContent = "0.00";

    cashPaymentMessage.textContent = "";
    cashPaymentMessage.className =
      "cash-payment-message";

    confirmCashBtn.disabled = true;

    M.updateTextFields();

    cashModal.open();

    setTimeout(() => {
      cashAmount.focus();
    }, 300);

    return;
  }

  updateCashlessTotal();

  selectedCashlessProvider = "";

  cashlessRefNo.value = "";

  gcashBtn.classList.remove("active");
  paymayaBtn.classList.remove("active");

  cashlessReferenceField.style.display = "none";

  selectedProvider.textContent =
    "No payment method selected";

  confirmCashlessBtn.disabled = true;

  M.updateTextFields();

  cashlessModal.open();
};

cashAmount.addEventListener("input", () => {
  cashAmount.value = cashAmount.value.replace(
    /[^0-9.]/g,
    ""
  );

  const parts = cashAmount.value.split(".");

  if (parts.length > 2) {
    cashAmount.value =
      parts[0] + "." + parts.slice(1).join("");
  }

  if (parts[1]) {
    parts[1] = parts[1].slice(0, 2);

    cashAmount.value =
      parts[0] + "." + parts[1];
  }

  const total = getOrderTotal();
  const amount = Number(cashAmount.value) || 0;
  const change = amount - total;

  if (!cashAmount.value) {
    cashChange.textContent = "0.00";

    cashPaymentMessage.textContent = "";

    cashPaymentMessage.className =
      "cash-payment-message";

    confirmCashBtn.disabled = true;

    return;
  }

  if (change < 0) {
    cashChange.textContent = "0.00";

    cashPaymentMessage.textContent =
      `Insufficient payment. Need ₱${Math.abs(change).toFixed(2)} more.`;

    cashPaymentMessage.className =
      "cash-payment-message insufficient";

    confirmCashBtn.disabled = true;

    return;
  }

  cashChange.textContent = change.toFixed(2);

  cashPaymentMessage.textContent =
    "Payment is sufficient.";

  cashPaymentMessage.className =
    "cash-payment-message sufficient";

  confirmCashBtn.disabled = false;
});

confirmCashBtn.onclick = async () => {
  const total = getOrderTotal();
  const amount = Number(cashAmount.value) || 0;

  if (!cashAmount.value) {
    M.toast({
      html: "Please enter amount paid.",
      classes: "red rounded",
    });

    cashAmount.focus();

    return;
  }

  if (amount < total) {
    M.toast({
      html: "Payment amount is not enough.",
      classes: "red rounded",
    });

    cashAmount.focus();

    return;
  }

  const change = amount - total;

  paymentInfo = {
    amount_paid: amount,
    change: change,
  };

  cashModal.close();

  await processCheckout();
};

gcashBtn.onclick = () => {
  selectedCashlessProvider = "GCash";

  gcashBtn.classList.add("active");
  paymayaBtn.classList.remove("active");

  cashlessReferenceField.style.display = "block";

  selectedProvider.textContent =
    "Selected: GCash";

  cashlessRefNo.value = "";

  confirmCashlessBtn.disabled = true;

  M.updateTextFields();

  setTimeout(() => {
    cashlessRefNo.focus();
  }, 300);
};

paymayaBtn.onclick = () => {
  selectedCashlessProvider = "PayMaya";

  paymayaBtn.classList.add("active");
  gcashBtn.classList.remove("active");

  cashlessReferenceField.style.display = "block";

  selectedProvider.textContent =
    "Selected: PayMaya";

  cashlessRefNo.value = "";

  confirmCashlessBtn.disabled = true;

  M.updateTextFields();

  setTimeout(() => {
    cashlessRefNo.focus();
  }, 300);
};

cashlessRefNo.addEventListener("input", () => {
  const refNo = cashlessRefNo.value.trim();

  confirmCashlessBtn.disabled =
    !selectedCashlessProvider || !refNo;
});

confirmCashlessBtn.onclick = async () => {
  const refNo = cashlessRefNo.value.trim();

  if (!selectedCashlessProvider) {
    M.toast({
      html: "Please select GCash or PayMaya.",
      classes: "red rounded",
    });

    return;
  }

  if (!refNo) {
    M.toast({
      html: "Please enter reference number.",
      classes: "red rounded",
    });

    cashlessRefNo.focus();

    return;
  }

  paymentInfo = refNo;

  cashlessModal.close();

  await processCheckout();
};

async function processCheckout() {
  checkoutBtn.disabled = true;

  confirmCashBtn.disabled = true;
  confirmCashlessBtn.disabled = true;

  try {
    await completeCheckout();

    M.toast({
      html: `Checkout Success! Payment: ${paymentMethod}`,
      classes: "green rounded",
    });

    cart = [];

    localStorage.setItem(
      "cart",
      JSON.stringify(cart)
    );

    renderOrder();

    setTimeout(() => {
      window.location.href =
        "/employee/siomai/userpanel.html";
    }, 1300);

  } catch (error) {
    console.error("Checkout error:", error);

    M.toast({
      html:
        error.message ||
        "Unable to complete checkout.",
      classes: "red rounded",
    });

    checkoutBtn.disabled = false;

    if (paymentMethod === "Cash") {
      confirmCashBtn.disabled = false;
    } else {
      confirmCashlessBtn.disabled =
        !selectedCashlessProvider ||
        !cashlessRefNo.value.trim();
    }
  }
}

backBtn.onclick = () => {
  window.history.back();
};

renderOrder();
