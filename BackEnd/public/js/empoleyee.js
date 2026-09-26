// employee.js
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  doc,
  updateDoc,
  setDoc,
  query,
  where,
  serverTimestamp,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import { app } from "/js/firebase.js";
import { loadProductsOffline } from "./IndexDB.js";

const db = getFirestore(app);
const auth = getAuth(app);

let unsubscribePOS = null;
// Bawat pagpasok/alis sa POS ay may sariling session. Pinipigilan nito ang
// mabagal na async load mula sa dating DOM na mag-render sa bagong section.
let posSession = 0;

let cart = JSON.parse(localStorage.getItem("cart")) || [];

// NOTE: these hold the logged-in employee's role and uid so that
// filterProducts() can enforce them as a safety net, even if allProducts
// ever gets populated from a source that isn't already filtered (e.g. a
// realtime listener or the offline IndexedDB path).
let currentRole = null;
let currentEmployeeId = null;

function formatQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return "0";
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}

// ========================================
// LOW STOCK CHECK
// ========================================
// Low-stock warnings apply only to products counted by pieces.  Bulk units
// and the Drinks/Rice categories do not have a low-stock/order limit.
function hasUnlimitedOrder(product) {
  const unit = String(product.unit || "").trim().toLowerCase();
  const category = String(product.category || product.role || "")
    .trim()
    .toLowerCase();
  return (
    ["kaban", "kilogram", "kg", "packs"].includes(unit) ||
    ["drinks", "rice"].includes(category)
  );
}

function isLowStock(product) {
  const unit = String(product.unit || "piece").trim().toLowerCase();
  const isPieceBased = ["piece", "pieces", "pcs", "pc", "pack"].includes(unit);
  const quantity = Number(product.pieces ?? product.stock) || 0;

  return !hasUnlimitedOrder(product) && isPieceBased && quantity > 0 && quantity <= 25;
}

function getProductStockLabel(product) {
  const pieces = Number(product.pieces ?? product.stock) || 0;
  const unit = String(product.unit || "").trim().toLowerCase();
  if (unit === "pack") {
    return `${formatQuantity(product.packs)} packs (${formatQuantity(pieces)} pcs)`;
  }
  if (unit === "kilogram") return `${formatQuantity(pieces)} kg`;
  return `${formatQuantity(pieces)} ${product.unit || "pcs"}`;
}

function getCardStockLabel(product) {
  const unit = String(product.unit || "").trim().toLowerCase();
  if (unit === "kaban") return "Kaldero";
  if (["packs", "kilogram"].includes(unit)) return "Container";
  return getProductStockLabel(product);
}

async function openLowStockConfirmation(product) {
  const existing = document.getElementById("low-stock-confirmation-modal");
  if (existing) {
    const existingModal = M.Modal.getInstance(existing);
    if (existingModal) {
      if (existingModal.isOpen) existingModal.close();
      existingModal.destroy();
    }
    existing.remove();
  }

  const modalElement = document.createElement("div");
  modalElement.id = "low-stock-confirmation-modal";
  modalElement.className = "modal";
  modalElement.innerHTML = `
    <div class="modal-content">
      <h4><i class="material-icons amber-text text-darken-2">warning</i> Low stock alert</h4>
      <p><strong>${product.name}</strong> has only ${getProductStockLabel(product)} remaining.</p>
      <p>Send this low-stock alert to the manager?</p>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-flat" data-action="cancel">Cancel</button>
      <button type="button" class="btn amber darken-2" data-action="confirm">Send alert</button>
    </div>
  `;
  document.body.appendChild(modalElement);

  const modal = M.Modal.init(modalElement, {
    dismissible: false,
    onCloseEnd: () => modalElement.remove(),
  });

  modalElement.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    modal.close();
  });

  modalElement.querySelector('[data-action="confirm"]').addEventListener("click", async () => {
    const confirmButton = modalElement.querySelector('[data-action="confirm"]');
    confirmButton.disabled = true;
    confirmButton.textContent = "Sending...";

    try {
      // Isang active alert lang bawat product para hindi mapuno ang manager bell
      // kapag paulit-ulit itong na-click ng employee.
      await setDoc(doc(db, "managerNotifications", `low-stock-${product.id}`), {
        type: "low_stock",
        productId: product.id,
        productName: product.name || "Unnamed product",
        remainingStock: Number(product.pieces ?? product.stock) || 0,
        unit: product.unit || "pcs",
        employeeId: currentEmployeeId,
        employeeUid: auth.currentUser?.uid || null,
        read: false,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, { merge: true });

      M.toast({ html: "Low-stock alert sent to the manager.", classes: "green rounded" });
      modal.close();
    } catch (error) {
      console.error("Unable to send low-stock alert:", error);
      confirmButton.disabled = false;
      confirmButton.textContent = "Send alert";
      M.toast({ html: "Unable to send the alert. Please try again.", classes: "red rounded" });
    }
  });

  modal.open();
}

// INIT POS
export async function initPOS() {
  const session = ++posSession;

  // Maaaring matawag ang initPOS nang higit sa isang beses (hal. back/forward
  // navigation). Isara agad ang lumang listener bago gumawa ng bago.
  if (unsubscribePOS) {
    unsubscribePOS();
    unsubscribePOS = null;
  }

  cart = JSON.parse(localStorage.getItem("cart")) || [];

  // Firebase Auth restores the session asynchronously — auth.currentUser
  // can still be null right after page load even if the person is
  // already logged in, unless we wait for this to resolve first.
  const user = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      unsubscribe();
      resolve(u);
    });
  });

  const authUid = user ? user.uid : null;

  // Kung nakalipat na sa ibang DOM habang hinihintay ang Firebase Auth,
  // huwag nang magpatuloy sa lumang POS page.
  if (session !== posSession || !document.getElementById("productList")) return;

  if (!navigator.onLine) {
    console.log("Offline mode: loading from IndexedDB");
    await loadProductsOffline(authUid);
    if (session !== posSession) return;
    identifyCart();
    setupCartEvents();
    setupProductSearch();
    return;
  }

  // loadProducts() resolves quickly (it just sets up the realtime
  // listener) — the actual product data arrives via onSnapshot whenever
  // Firestore pushes it, and filterProducts()/renderProducts() get
  // called automatically from inside that listener.
  await loadProducts(session);
  if (session !== posSession) return;
  identifyCart();
  setupCartEvents();
  setupCategoryButtons();
  setupProductSearch();
}

function saveCart() {
  localStorage.setItem("cart", JSON.stringify(cart));
}

// Kunin ang role at employeeId ng naka-login na employee, hanapin sa
// "employees" collection gamit ang Auth uid (hindi doc ID mismo).
// IMPORTANTE: ang "employeeId" na nakalagay sa mga product ay tumutukoy
// sa DOCUMENT ID ng employee record (snap.docs[0].id) — hindi sa Auth
// uid mismo. Kung magkaiba pala sa Firestore mo, dito lang ito baguhin.
async function getCurrentEmployeeInfo() {
  const user = auth.currentUser;
  if (!user) return null;

  const q = query(collection(db, "employees"), where("uid", "==", user.uid));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  return {
    role: snap.docs[0].data().role || null,
    employeeId: snap.docs[0].id,
  };
}

// LOAD PRODUCTS
async function loadProducts(session) {
  const productGrid = document.getElementById("productList");

  if (!productGrid) return;

  productGrid.innerHTML = "";

  const info = await getCurrentEmployeeInfo();

  if (session !== posSession || !productGrid.isConnected) return;

  if (!info || !info.role) {
    console.error("No role found for current employee.");
    return;
  }

  // Save these so filterProducts() can also enforce them as a safety net.
  currentRole = info.role;
  currentEmployeeId = info.employeeId;

  // Isarado muna ang dating listener (kung meron) bago mag-subscribe ng
  // bago, para hindi dumoble ang updates kapag na-call ulit ang
  // loadProducts() (hal. pagbabalik sa page).
  if (unsubscribePOS) {
    unsubscribePOS();
    unsubscribePOS = null;
  }

  // Ipakita lang ang mga product na naka-assign sa role na ito, o yung
  // naka-mark na "ALL" (shared across every role). employeeId ang
  // pangalawang gate — kailangan din itong tumugma (o "ALL") bago
  // mapunta sa allProducts.
  const q = query(
    collection(db, "products"),
    where("role", "in", [currentRole, "ALL"]),
  );

  // onSnapshot instead of getDocs: mag-a-update na mismo ang list kapag
  // may nabago sa Firestore (bagong product, na-out of stock, etc.) —
  // hindi na kailangan pa ng manual refresh ng page.
  unsubscribePOS = onSnapshot(
    q,
    (querySnapshot) => {
      // Ang callback ng dating listener ay hindi dapat magbago ng DOM pagkatapos
      // lumipat ang employee sa ibang section.
      if (session !== posSession || !productGrid.isConnected) return;

      allProducts = [];

      querySnapshot.forEach((docSnap) => {
        const product = docSnap.data();

        // employeeId gate: kung may laman ito at hindi ito "ALL" o hindi
        // tumutugma sa naka-login na employee, huwag isama.
        const productEmployeeId = product.employeeId;
        const employeeMatch =
          !productEmployeeId ||
          productEmployeeId === "ALL" ||
          productEmployeeId === currentEmployeeId;

        if (!employeeMatch) return;

        const pieces = Number(product.pieces ?? product.stock) || 0;
        const piecesPerPack = Number(product.pieces_per_pack) || 1;
        const packs =
          product.unit === "pack" ? Math.ceil(pieces / piecesPerPack) : null;

        allProducts.push({
          id: docSnap.id,
          ...product,
          pieces,
          piecesPerPack,
          packs,
        });
      });

      setupCategoryButtons();
      filterProducts();
    },
    (error) => {
      console.error("Products listener error:", error);
    },
  );
}

function updateCartCount() {
  const cartCount = document.querySelector(".cart-count");

  if (!cartCount) return;

  const totalItems = cart.reduce((total, item) => {
    return total + Number(item.qty || 0);
  }, 0);

  cartCount.textContent = `${totalItems} ${totalItems === 1 ? "Item" : "Items"}`;
}

function updateCheckoutVisibility() {
  const hasItems = cart.some((item) => Number(item.qty || 0) > 0);
  const checkoutInfo = document.querySelector(".checkout-info");
  const checkoutBar = document.querySelector(".checkout-bar");

  if (checkoutInfo) {
    checkoutInfo.hidden = !hasItems;
  }

  if (checkoutBar) {
    checkoutBar.classList.toggle("has-items", hasItems);
    checkoutBar.classList.toggle("is-empty", !hasItems);
  }
}

// ADD TO CART
function addToCart(product) {
  const existing = cart.find((item) => item.id === product.id);

  if (existing) {
    if (hasUnlimitedOrder(product) || existing.qty < product.stock) {
      existing.qty += 1;
    } else {
      M.toast({ html: "Not enough stock!", classes: "red rounded" });
      return;
    }
  } else {
    if (!hasUnlimitedOrder(product) && product.stock <= 0) {
      M.toast({ html: "Out of stock!", classes: "red rounded" });
      return;
    }

    cart.push({ ...product, qty: 1 });
  }

  saveCart();
  identifyCart();
}

// RENDER CART
function identifyCart() {
  updateCartCount();
  updateCheckoutVisibility();

  if (window.innerWidth <= 768) {
    renderMobileCart();
  } else {
    renderCart();
  }
}

// mobile
function renderMobileCart() {
  let total = 0;
  let items = 0;

  cart.forEach((item) => {
    total += item.price * item.qty;
    items += item.qty;
  });

  const cartCount = document.querySelector(".cart-count");
  const grandTotal = document.getElementById("grandTotal");

  if (cartCount) {
    cartCount.textContent = `${items} Items`;
  }

  if (grandTotal) {
    grandTotal.textContent = total.toFixed(2);
  }
}

// desktop
function renderCart() {
  const tbody = document.querySelector("#cartTable tbody");

  if (!tbody) return;

  tbody.innerHTML = "";

  let grandTotal = 0;

  cart.forEach((item, index) => {
    const total = item.qty * item.price;
    grandTotal += total;

    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${item.name}</td>
      <td><input type="number" min="1" ${hasUnlimitedOrder(item) ? "" : `max="${item.stock}"`} value="${item.qty}" data-index="${index}" class="qty-input"></td>
      <td>₱${item.price.toFixed(2)}</td>
      <td>₱${total.toFixed(2)}</td>
      <td><button class="btn red remove-btn" data-index="${index}"><i class="material-icons">delete</i></button></td>
    `;

    tbody.appendChild(row);
  });

  const grandTotalElement = document.getElementById("grandTotal");

  if (grandTotalElement) {
    grandTotalElement.textContent = grandTotal.toFixed(2);
  }

  // Quantity change
  document.querySelectorAll(".qty-input").forEach((input) => {
    const updateQuantity = (quantity, idx, render = true) => {
      if (!Number.isFinite(quantity) || quantity < 1) {
        quantity = 1;
      }

      if (!hasUnlimitedOrder(cart[idx]) && quantity > cart[idx].stock) {
        quantity = cart[idx].stock;

        M.toast({
          html: "Not enough stock!",
          classes: "red rounded",
        });
      }

      cart[idx].qty = quantity;
      input.value = quantity;
      saveCart();

      if (render) {
        identifyCart();
      }
    };

    input.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.index);
      updateQuantity(parseInt(e.target.value), idx);
    });

    input.addEventListener("keydown", (e) => {
      const idx = Number(e.target.dataset.index);

      if (e.key === "ArrowUp") {
        e.preventDefault();
        updateQuantity(cart[idx].qty + 1, idx, false);
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        updateQuantity(cart[idx].qty - 1, idx, false);
      }
    });
  });
  // Remove item
  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.index);

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
    employeeUid: user?.uid || "",
    employeeId: currentEmployeeId || "",
    total: orderItems.reduce(
      (sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0),
      0,
    ),
    created_at: serverTimestamp(),
    status: "paid",
  });

  for (const item of orderItems) {
    const productRef = doc(db, "products", item.id);

    await updateDoc(productRef, {
      stock: item.stock - item.qty,
      pieces: item.stock - item.qty,
      packs:
        item.unit === "pack"
          ? Math.ceil((item.stock - item.qty) / item.pieces_per_pack)
          : null,
    });
  }

  M.toast({ html: "Order placed successfully!", classes: "green rounded" });

  return orderRef.id;
}

// CHECKOUT
async function checkout() {
  if (cart.length === 0) {
    M.toast({ html: "Cart is empty!", classes: "red rounded" });
    return;
  }

  await addOrder(cart);
  cart = [];
  saveCart();
  identifyCart();
}

// SETUP EVENTS
function setupCartEvents() {
  const checkoutBtn = document.getElementById("checkoutBtn");

  if (!checkoutBtn) return;

  if (checkoutBtn.dataset.ready === "true") return;

  checkoutBtn.dataset.ready = "true";

  checkoutBtn.addEventListener("click", () => {
    if (cart.length === 0) {
      M.toast({ html: "Cart is empty!", classes: "red rounded" });
      return;
    }

    // Save cart
    localStorage.setItem("cart", JSON.stringify(cart));

    window.location.href = "/employee/siomai/vieworder.html";
  });
}

function restoreCartOnPageShow() {
  // pageshow ay maaari ring tumakbo kapag naka-cache ang ibang page. POS lang
  // ang may cart elements, kaya huwag mag-render sa ibang DOM.
  if (!document.getElementById("cartTable")) return;
  cart = JSON.parse(localStorage.getItem("cart")) || [];
  identifyCart();
}

window.addEventListener("pageshow", restoreCartOnPageShow);

// Tinatawag ng navemployee.js bago palitan ang #content.
export function stopPosPage() {
  posSession += 1;

  if (unsubscribePOS) {
    unsubscribePOS();
    unsubscribePOS = null;
  }

  currentRole = null;
  currentEmployeeId = null;
  allProducts = [];
  selectedCategory = "All";

  // Kapag lumipat sa ibang employee section, ituring na cancelled ang
  // kasalukuyang order. Hindi ito tinatawag sa Proceed to Checkout, kaya
  // buo pa rin ang cart sa payment page.
  cart = [];
  localStorage.removeItem("cart");
}

window.addEventListener("employee:before-section-change", stopPosPage);

// ========================================
// PRODUCT FILTER & SEARCH
// ========================================

let allProducts = [];
let selectedCategory = "All";

// ========================================
// SET PRODUCTS
// ========================================

function setProducts(products) {
  allProducts = products;
  setupCategoryButtons();
  filterProducts();
}

// ========================================
// CATEGORY BUTTONS
// ========================================

function setupCategoryButtons() {
  const categoriesContainer = document.querySelector(".categories");
  if (!categoriesContainer) return;

  const categories = [
    "All",
    ...new Set(
      allProducts
        .filter((product) => {
          const stock = Number(product.pieces ?? product.stock) || 0;
          return stock > 0;
        })
        .map((product) => String(product.category || "").trim())
        .filter(Boolean),
    ),
  ];

  if (!categories.includes(selectedCategory)) {
    selectedCategory = "All";
  }

  categoriesContainer.innerHTML = "";

  categories.forEach((category) => {
    const button = document.createElement("button");
    button.classList.add("category");

    if (category === selectedCategory) {
      button.classList.add("active");
    }

    button.textContent = category;

    button.addEventListener("click", () => {
      selectedCategory = category;

      categoriesContainer.querySelectorAll(".category").forEach((btn) => {
        btn.classList.remove("active");
      });

      button.classList.add("active");
      filterProducts();
    });

    categoriesContainer.appendChild(button);
  });
}
// ========================================
// SEARCH PRODUCT
// ========================================

function setupProductSearch() {
  const searchInput = document.getElementById("searchProduct");

  if (!searchInput) return;

  if (searchInput.dataset.searchReady === "true") {
    return;
  }

  searchInput.dataset.searchReady = "true";

  searchInput.addEventListener("input", () => {
    filterProducts();
  });
}

// ========================================
// FILTER PRODUCTS
// ========================================

function filterProducts() {
  const searchInput = document.getElementById("searchProduct");

  const searchValue = searchInput ? searchInput.value.trim().toLowerCase() : "";

  const filteredProducts = allProducts.filter((product) => {
    const stock = Number(product.pieces ?? product.stock) || 0;

    if (stock <= 0 && !hasUnlimitedOrder(product)) return false;

    // Safety net: enforce role AND employeeId visibility here too, in
    // case allProducts was ever populated from a path that skipped the
    // filtered Firestore query (e.g. setProducts() from a realtime
    // listener, or the offline IndexedDB load).
    const productRole = product.role;
    const roleMatch =
      !currentRole ||
      !productRole ||
      productRole === currentRole ||
      productRole === "ALL";

    const productEmployeeId = product.employeeId;
    const employeeMatch =
      !currentEmployeeId ||
      !productEmployeeId ||
      productEmployeeId === "ALL" ||
      productEmployeeId === currentEmployeeId;

    const category = String(product.category || "")
      .trim()
      .toLowerCase();
    const productName = String(product.name || "")
      .trim()
      .toLowerCase();

    const categoryMatch =
      selectedCategory === "All" ||
      category === selectedCategory.trim().toLowerCase();

    const searchMatch = productName.includes(searchValue);

    return roleMatch && employeeMatch && categoryMatch && searchMatch;
  });

  renderProducts(filteredProducts);
}

// ========================================
// RENDER PRODUCTS
// ========================================

function renderProducts(products) {
  const productList = document.getElementById("productList");

  if (!productList) return;

  productList.innerHTML = "";

  if (products.length === 0) {
    productList.innerHTML = `
      <div class="no-products">
        No products found.
      </div>
    `;

    return;
  }

  products.forEach((product) => {
    const card = document.createElement("div");

    card.classList.add("product-card");

    const lowStock = isLowStock(product);

    card.innerHTML = `
      <img
        src="${product.image || "/assets/upload-placeholder.png"}"
        class="product-image"
      >

      <div class="product-info">

        <h4>${product.name}</h4>

        <span class="product-stock">${
          product.unit === "pack"
            ? `${formatQuantity(product.packs)} packs · ${formatQuantity(product.pieces)} pcs`
            : `${formatQuantity(product.pieces)} ${product.unit || "pcs"}`
        }</span>

        <span class="price">
          ₱${Number(product.price).toFixed(2)}
        </span>

      </div>

      <div class="product-actions">
        ${
          lowStock
            ? `<button class="lowstock-btn" type="button" data-id="${product.id}">
                 <i class="material-icons" aria-hidden="true">warning</i>
                 <span>Low stock</span>
               </button>`
            : ""
        }

        <button
          class="add-btn"
          data-id="${product.id}"
          data-name="${product.name}"
          data-price="${product.price}"
          data-stock="${product.pieces}"
          data-packs="${product.packs ?? ""}"
          data-pieces-per-pack="${product.piecesPerPack}"
          data-unit="${product.unit || "piece"}"
          data-category="${product.category || product.role || ""}"
        >
          <i class="material-icons">add</i>
        </button>
      </div>
    `;

    const productStock = card.querySelector(".product-stock");
    if (productStock) productStock.textContent = getCardStockLabel(product);

    productList.appendChild(card);
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
        category: btn.dataset.category,
      });
    });
  });

  document.querySelectorAll(".lowstock-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const product = products.find((item) => item.id === btn.dataset.id);
      if (product) openLowStockConfirmation(product);
    });
  });
}
