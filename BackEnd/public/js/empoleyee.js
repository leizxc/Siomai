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
import { watchActiveShift, showShiftRequired } from "./attendanceAccess.js";

const db = getFirestore(app);
const auth = getAuth(app);

let unsubscribePOS = null;
let unsubscribeShift = null;
let posShiftActive = false;
let shiftControlsObserver = null;
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
// Pack products consume piece-based stock. Other units are sold per order.
function isPackProduct(product) {
  return String(product.unit || "").trim().toLowerCase() === "pack";
}

function isLechonProduct(product) {
  return !product.isCombo && /let?chon/i.test(`${product.category || ""} ${product.name || ""}`);
}

function normalizeComboNames(items) {
  const comboNames = {
    "siomai-rice": "SIOMAI RICE",
    "lechon-rice": "LETCHON RICE",
    "pares-rice": "PARES WITH RICE",
  };
  let changed = false;
  items.forEach((item) => {
    if (!item.isCombo) return;
    const key = Object.keys(comboNames).find((comboKey) => String(item.id || "").endsWith(`-${comboKey}`));
    if (key && item.name !== comboNames[key]) {
      item.name = comboNames[key];
      changed = true;
    }
  });
  return changed;
}

function restoreFixedLechonPrice(item) {
  if (!isLechonProduct(item) || item.lechonFixedPrice || item.customPriceEntered) return false;

  const match = String(item.name || "").match(/\((1\/4|1\/2|1)\s*kg\)/i);
  if (!match) return false;

  const source = allProducts.find((product) => product.id === item.productId || product.id === item.id);
  const prices = source?.lechonPrices || {};
  const preset = match[1] === "1/4"
    ? Number(prices.quarter ?? prices["1/4 kg"] ?? 250)
    : match[1] === "1/2"
      ? Number(prices.half ?? prices["1/2 kg"] ?? 500)
      : Number(prices.one ?? prices["1 kg"] ?? 900);

  if (!Number.isFinite(preset) || preset <= 0) return false;
  item.price = preset;
  item.lechonFixedPrice = true;
  item.customPriceEntered = true;
  return true;
}

function hasUnlimitedOrder(product) {
  return !isPackProduct(product);
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
  return isPackProduct(product) ? getProductStockLabel(product) : "Order";
}

function findComboProduct(keyword, { excludeLechon = false, excludeId = "", excludeRiceMeals = false } = {}) {
  return allProducts.find((product) => {
    const searchable = `${product.name || ""} ${product.category || ""}`.toLowerCase();
    if (
      product.id === excludeId ||
      !searchable.includes(keyword) ||
      (excludeLechon && isLechonProduct(product)) ||
      (excludeRiceMeals && /rice|combo/i.test(String(product.name || "")))
    ) return false;
    return hasUnlimitedOrder(product) || (Number(product.pieces ?? product.stock) || 0) > 0;
  }) || null;
}

function getEmployeeCombos() {
  // allProducts is already limited to the signed-in employee's role and
  // employee assignment by loadProducts(); only build combos from that set.
  const usableProducts = allProducts.filter((product) =>
    hasUnlimitedOrder(product) || (Number(product.pieces ?? product.stock) || 0) > 0,
  );
  const rice = usableProducts.find((product) =>
    !/(siomai|lechon|pares)/i.test(String(product.name || "")) &&
      (/^rice$/i.test(String(product.name || "").trim()) || /^rice$/i.test(String(product.category || "").trim())),
  ) || usableProducts.find((product) => {
    const name = String(product.name || "").toLowerCase();
    return name.includes("rice") && !/(siomai|lechon|pares)/i.test(name);
  });
  if (!rice) return [];

  const combos = [];
  const addCombo = (key, name, mainProduct, comboPrice, fallbackDescription, mainQty = 1, mainUnit = "") => {
    if (!(comboPrice > 0) || !mainProduct) return;
    const components = [
      { product: rice, qty: 1, unit: rice.unit || "piece" },
      { product: mainProduct, qty: mainQty, unit: mainUnit || mainProduct.unit || "piece" },
    ].map(({ product, qty, unit }) => ({
      productId: product.id,
      name: product.id !== rice.id && key === "siomai-rice"
        ? "Siomai"
        : product.id !== rice.id && key === "pares-rice"
          ? "Pares"
          : product.name,
      unit,
      qty,
    })).map((component) => ({ ...component, name: String(component.name || "").toUpperCase() }));
    const riceName = rice.name || "Rice";
    const mainDescription = key === "siomai-rice"
      ? "3 pcs Siomai"
      : key === "lechon-rice"
        ? `80 g ${mainProduct.name || fallbackDescription}`
        : key === "pares-rice"
          ? "1 Pares"
          : `1 ${mainProduct.name || fallbackDescription}`;
    combos.push({
      key,
      name,
      price: comboPrice,
      description: `1 ${riceName} + ${mainDescription}`.toUpperCase(),
      image: rice.image || mainProduct.image || "/assets/upload-placeholder.png",
      components,
    });
  };

  addCombo("siomai-rice", "SIOMAI RICE", findComboProduct("siomai", { excludeLechon: true, excludeId: rice?.id, excludeRiceMeals: true }), 40, "siomai", 3, "pcs");
  const lechon = usableProducts.find((product) => product.id !== rice?.id && isLechonProduct(product));
  addCombo("lechon-rice", "LETCHON RICE", lechon, 100, "lechon", 80, "g");
  addCombo("pares-rice", "PARES WITH RICE", findComboProduct("pares", { excludeLechon: true, excludeId: rice?.id }), 80, "pares");
  return combos;
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

  // Firebase Auth restores the session asynchronously â€” auth.currentUser
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

  unsubscribeShift?.();
  unsubscribeShift = watchActiveShift((shift) => {
    if (session !== posSession) return;
    posShiftActive = shift.active;
    const checkoutBtn = document.getElementById("checkoutBtn");
    if (checkoutBtn) {
      checkoutBtn.disabled = !shift.active;
      checkoutBtn.setAttribute("aria-disabled", String(!shift.active));
      checkoutBtn.title = shift.active ? "" : "Time in to enable checkout";
    }
    const content = document.getElementById("content");
    content?.classList.toggle("shift-inactive", !shift.active);
    showShiftRequired(content, !shift.active, shift.timedOut, shift.pending);
    const updateShiftDisabledButtons = (root = content) => {
      root?.querySelectorAll("button").forEach((button) => {
        if (button.matches("[data-go-to-attendance], #checkoutBtn")) return;
        if (!shift.active) {
          if (button.dataset.shiftWasDisabled === undefined) {
            button.dataset.shiftWasDisabled = String(button.disabled);
          }
          button.disabled = true;
          button.setAttribute("aria-disabled", "true");
        } else if (button.dataset.shiftWasDisabled !== undefined) {
          button.disabled = button.dataset.shiftWasDisabled === "true";
          button.removeAttribute("data-shift-was-disabled");
          if (!button.disabled) button.removeAttribute("aria-disabled");
        }
      });
    };
    updateShiftDisabledButtons();
    shiftControlsObserver?.disconnect();
    if (content && !shift.active) {
      shiftControlsObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.matches("button")) updateShiftDisabledButtons(node.parentElement || content);
            else updateShiftDisabledButtons(node);
          });
        });
      });
      shiftControlsObserver.observe(content, { childList: true, subtree: true });
    }
    content?.querySelectorAll(":scope > *").forEach((section) => {
      section.inert = !shift.active && !section.hasAttribute("data-shift-required");
    });
  });

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
  // listener) â€” the actual product data arrives via onSnapshot whenever
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
// sa DOCUMENT ID ng employee record (snap.docs[0].id) â€” hindi sa Auth
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
  // pangalawang gate â€” kailangan din itong tumugma (o "ALL") bago
  // mapunta sa allProducts.
  const q = query(
    collection(db, "products"),
    where("role", "in", [currentRole, "ALL"]),
  );

  // onSnapshot instead of getDocs: mag-a-update na mismo ang list kapag
  // may nabago sa Firestore (bagong product, na-out of stock, etc.) â€”
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
    if (product.isCombo) {
      existing.price = product.price;
      existing.comboComponents = product.comboComponents;
    }
    if (isPackProduct(product) && existing.qty < product.stock) {
      existing.qty += 1;
    } else if (!isPackProduct(product)) {
      existing.qty += 1;
    } else {
      M.toast({ html: "Not enough stock!", classes: "red rounded" });
      return;
    }
  } else {
    if (isPackProduct(product) && product.stock <= 0) {
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
  if (normalizeComboNames(cart)) saveCart();
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
  let restoredPrice = false;

  cart.forEach((item) => {
    restoredPrice = restoreFixedLechonPrice(item) || restoredPrice;
    total += (Number(item.price) || 0) * (Number(item.qty) || 0);
    items += item.qty;
  });
  if (restoredPrice) saveCart();

  const cartCount = document.querySelector(".cart-count");
  const grandTotal = document.getElementById("grandTotal");

  if (cartCount) {
    cartCount.textContent = `${items} Items`;
  }

  if (grandTotal) {
    grandTotal.textContent = total.toFixed(2);
    grandTotal.parentElement?.parentElement?.removeAttribute("hidden");
  }
}

// desktop
function renderCart() {
  const tbody = document.querySelector("#cartTable tbody");

  if (!tbody) return;

  tbody.innerHTML = "";

  let grandTotal = 0;
  let restoredPrice = false;
  cart.forEach((item) => {
    restoredPrice = restoreFixedLechonPrice(item) || restoredPrice;
  });
  if (restoredPrice) saveCart();
  const allItemsAreLechon = cart.length > 0 && cart.every(isLechonProduct);

  document.querySelectorAll("#cartTable thead th:nth-child(3), #cartTable thead th:nth-child(4)")
    .forEach((header) => { header.hidden = allItemsAreLechon; });

  cart.forEach((item, index) => {
    const isLechon = isLechonProduct(item);
    const hasPrice = Number.isFinite(Number(item.price)) && Number(item.price) > 0;
    const total = item.qty * item.price;
    grandTotal += total;

    const row = document.createElement("tr");
    row.dataset.lechon = String(isLechon);
    row.dataset.lechonCustom = String(isLechon && !item.lechonFixedPrice && !hasPrice);

    row.innerHTML = `
      <td>${item.name}</td>
      <td><input type="number" min="1" ${hasUnlimitedOrder(item) ? "" : `max="${item.stock}"`} value="${item.qty}" data-index="${index}" class="qty-input"></td>
      <td>${isLechon && !item.lechonFixedPrice && !hasPrice ? "" : `&#8369;${Number(item.price).toFixed(2)}`}</td>
      <td>${isLechon && !item.lechonFixedPrice && !hasPrice ? "" : `&#8369;${total.toFixed(2)}`}</td>
      <td><button class="btn red remove-btn" data-index="${index}"><i class="material-icons">delete</i></button></td>
    `;

    tbody.appendChild(row);
  });

  const grandTotalElement = document.getElementById("grandTotal");

  if (grandTotalElement) {
    grandTotalElement.textContent = grandTotal.toFixed(2);
    grandTotalElement.parentElement?.parentElement?.removeAttribute("hidden");
  }

  // Quantity change
  document.querySelectorAll(".qty-input").forEach((input) => {
    const updateQuantity = (quantity, idx, render = true) => {
      if (!Number.isFinite(quantity) || quantity < 1) {
        quantity = 1;
      }

      if (isPackProduct(cart[idx]) && quantity > cart[idx].stock) {
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
    const productRef = doc(db, "products", item.productId || item.id);

    if (isPackProduct(item)) {
      await updateDoc(productRef, {
        stock: item.stock - item.qty,
        pieces: item.stock - item.qty,
        packs: Math.ceil((item.stock - item.qty) / item.pieces_per_pack),
      });
    }
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
    if (!posShiftActive) {
      M.toast({ html: "Timed in first before using POS.", classes: "red rounded" });
      return;
    }
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
  unsubscribeShift?.();
  unsubscribeShift = null;
  shiftControlsObserver?.disconnect();
  shiftControlsObserver = null;
  posShiftActive = false;

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
  if (getEmployeeCombos().length && !categories.includes("COMBOS")) categories.push("COMBOS");

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

    const categoryMatch = selectedCategory === "COMBOS"
      ? false
      : selectedCategory === "All" || category === selectedCategory.trim().toLowerCase();

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
  const searchValue = document.getElementById("searchProduct")?.value.trim().toLowerCase() || "";
  const combos = ["All", "COMBOS"].includes(selectedCategory)
    ? getEmployeeCombos().filter((combo) => combo.name.toLowerCase().includes(searchValue))
    : [];

  if (products.length === 0 && combos.length === 0) {
    productList.innerHTML = `
      <div class="no-products">
        No products found.
      </div>
    `;

    return;
  }

  products.forEach((product) => {
    const isLechon = isLechonProduct(product);
    const lechonOptions = [
      { label: "1/4 kg", price: Number(product.lechonPrices?.quarter ?? product.lechonPrices?.["1/4 kg"] ?? 250) },
      { label: "1/2 kg", price: Number(product.lechonPrices?.half ?? product.lechonPrices?.["1/2 kg"] ?? 500) },
      { label: "1 kg", price: Number(product.lechonPrices?.one ?? product.lechonPrices?.["1 kg"] ?? 900) },
    ];

    if (isLechon) {
      const makeLechonCard = (weight, presetPrice, custom = false) => {
        const lechonCard = document.createElement("div");
        lechonCard.classList.add("product-card", "lechon-product-card");
        lechonCard.innerHTML = `
          <img src="${product.image || "/assets/upload-placeholder.png"}" class="product-image" alt="${product.name}">
          <div class="product-info">
            <h4>${product.name}${custom ? "" : ` (${weight})`}</h4>
            <span class="product-stock">Order</span>
            ${custom ? "" : `<span class="price">₱${presetPrice.toFixed(2)}</span>`}
          </div>
          <div class="product-actions">
            <button type="button" class="add-btn lechon-card-add" data-id="${product.id}" data-name="${product.name}" data-category="${product.category || ""}" data-image="${product.image || ""}" data-weight="${custom ? "Custom price" : weight}" data-price="${custom ? "" : presetPrice}" data-custom="${custom}"><i class="material-icons" aria-hidden="true">add</i></button>
          </div>
        `;
        productList.appendChild(lechonCard);
      };
      lechonOptions.forEach((option) => makeLechonCard(option.label, option.price));
      makeLechonCard("Custom price", 0, true);
      return;
    }

    const card = document.createElement("div");

    card.classList.add("product-card");

    card.innerHTML = `
      <img
        src="${product.image || "/assets/upload-placeholder.png"}"
        class="product-image"
      >

      <div class="product-info">

        <h4>${product.name}</h4>

        <span class="product-stock">${
          isPackProduct(product) ? `${formatQuantity(product.packs)} packs (${formatQuantity(product.pieces)} pcs)` : "Order"
        }</span>

        <span class="price">&#8369;${Number(product.price).toFixed(2)}</span>

      </div>

      <div class="product-actions">
        <button class="lowstock-btn" type="button" data-id="${product.id}">
          <i class="material-icons" aria-hidden="true">warning</i>
          <span>low stock</span>
        </button>
        <button
          class="add-btn"
          data-id="${product.id}"
          data-name="${product.name}"
          data-price="${product.price}"
          data-stock="${product.pieces}"
          data-packs="${product.packs ?? ""}"
          data-pieces-per-pack="${product.piecesPerPack}"
          data-unit="${product.unit || "piece"}"
          data-category="${product.category || ""}"
        >
          <i class="material-icons">add</i>
        </button>
      </div>
    `;

    const productStock = card.querySelector(".product-stock");
    if (productStock) productStock.textContent = getCardStockLabel(product);

    productList.appendChild(card);
  });

  // Show ready combo products first in All so they are immediately visible.
  [...combos].reverse().forEach((combo) => {
    const comboCard = document.createElement("div");
    comboCard.classList.add("product-card", "combo-product-card");
    comboCard.innerHTML = `
      <img src="${combo.image}" class="product-image" alt="${combo.name}">
      <div class="product-info">
        <h4>${combo.name}</h4>
        <span class="product-stock">${combo.description}</span>
        <span class="price">₱${combo.price.toFixed(2)}</span>
      </div>
      <div class="product-actions">
        <button type="button" class="add-btn combo-add-btn" aria-label="Add ${combo.name}"><i class="material-icons">add</i></button>
      </div>
    `;
    comboCard.querySelector(".combo-add-btn").addEventListener("click", () => {
      const existingId = `combo-${currentEmployeeId}-${combo.key}`;
      const existing = cart.find((item) => item.id === existingId);
      const nextQty = Number(existing?.qty || 0) + 1;
      const lacksPackStock = combo.components.some((component) => {
        const source = allProducts.find((item) => item.id === component.productId);
        const requiredPieces = (Number(component.qty) || 1) * nextQty;
        return source && isPackProduct(source) && (Number(source.pieces ?? source.stock) || 0) < requiredPieces;
      });
      if (lacksPackStock) {
        M.toast({ html: `Not enough component stock for ${combo.name}.`, classes: "red rounded" });
        return;
      }

      addToCart({
        id: existingId,
        name: combo.name,
        price: combo.price,
        image: combo.image,
        unit: "combo",
        category: "COMBOS",
        stock: 0,
        isCombo: true,
        comboComponents: combo.components,
      });
    });
    productList.prepend(comboCard);
  });

  document.querySelectorAll(".lechon-product-card").forEach((card) => {
    const addButton = card.querySelector(".lechon-card-add");
    addButton.addEventListener("click", () => {
      const custom = addButton.dataset.custom === "true";
      const price = custom ? 0 : Number(addButton.dataset.price);
      if (!custom && (!Number.isFinite(price) || price <= 0)) {
        M.toast({ html: "The selected lechon price is invalid.", classes: "red rounded" });
        return;
      }
      addToCart({
        id: `${addButton.dataset.id}-${addButton.dataset.weight.replace(/[^a-z0-9]/gi, "")}`,
        productId: addButton.dataset.id,
        name: `${addButton.dataset.name} (${addButton.dataset.weight})`,
        price,
        image: addButton.dataset.image || "",
        stock: 0,
        unit: "order",
        category: addButton.dataset.category,
        lechonFixedPrice: !custom,
        customPriceEntered: !custom,
      });
    });
  });

  document.querySelectorAll(".add-btn:not(.lechon-card-add):not(.combo-add-btn)").forEach((btn) => {
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
