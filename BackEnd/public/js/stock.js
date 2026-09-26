import { app } from "/js/firebase.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, getFirestore, onSnapshot, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const db = getFirestore(app);
const auth = getAuth(app);
let unsubscribeStock = null;
let assignedProducts = [];

export async function loadstock() {
  const employee = await getCurrentEmployee();
  if (!employee) return renderMessage("Your employee account could not be found.");

  unsubscribeStock?.();
  unsubscribeStock = onSnapshot(
    query(collection(db, "products"), where("employeeId", "==", employee.id)),
    (snapshot) => {
      assignedProducts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      renderStockPage();
    },
    (error) => {
      console.error("Unable to load assigned inventory:", error);
      renderMessage("Unable to load your assigned inventory.");
    },
  );

  document.querySelector("#searchProduct").oninput = renderStockPage;
}

async function getCurrentEmployee() {
  const user = await new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      unsubscribe();
      resolve(currentUser);
    });
  });
  if (!user) return null;
  const snapshot = await getDocs(query(collection(db, "employees"), where("uid", "==", user.uid)));
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

function renderStockPage() {
  const search = document.querySelector("#searchProduct")?.value.trim().toLowerCase() || "";
  const products = assignedProducts.filter((product) => `${product.name || product.product_name || ""} ${product.category || ""} ${product.role || ""}`.toLowerCase().includes(search));
  const inStock = assignedProducts.filter((product) => getQuantity(product) > 0);
  const lowStock = inStock.filter(isLowStock);
  setText("#totalProducts", assignedProducts.length);
  setText("#inStock", inStock.length);
  setText("#lowStock", lowStock.length);
  const categories = new Set(
    assignedProducts.map((product) => String(product.category || product.role || "Uncategorized").trim().toLowerCase() || "uncategorized"),
  );
  setText("#totalCategories", categories.size);

  const tbody = document.querySelector("#stockTableBody");
  if (!tbody) return;
  if (!products.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="assigned-stock-empty"><span class="material-icons">inventory_2</span><strong>No assigned products found</strong><small>${search ? "Try another search term." : "Ask your manager to assign inventory to your account."}</small></td></tr>`;
    return;
  }

  tbody.innerHTML = products.map((product) => {
    const name = product.name || product.product_name || "Unnamed product";
    const quantity = getQuantity(product);
    const status = quantity <= 0 ? "Out of stock" : isLowStock(product) ? "Low stock" : "In stock";
    const statusClass = quantity <= 0 ? "out" : isLowStock(product) ? "low" : "in";
    return `<tr>
      <td data-label="Product"><div class="assigned-product-name"><span>${escapeHtml(name.charAt(0).toUpperCase())}</span><strong>${escapeHtml(name)}</strong></div></td>
      <td data-label="Category">${escapeHtml(product.category || product.role || "Uncategorized")}</td>
      <td data-label="Assigned stock"><strong>${formatQuantity(quantity)}</strong> <small>${escapeHtml(formatUnit(product.unit))}</small></td>
      <td data-label="Unit price">${formatCurrency(Number(product.price || 0))}</td>
      <td data-label="Status"><span class="assigned-stock-badge ${statusClass}">${status}</span></td>
      <td data-label="Last updated">${formatDate(product.last_updated || product.created_at)}</td>
    </tr>`;
  }).join("");
}

function getQuantity(product) { return Number(product.pieces ?? product.stock ?? product.current_stock ?? 0); }
function isLowStock(product) {
  const unit = String(product.unit || "").trim().toLowerCase();
  const category = String(product.category || product.role || "")
    .trim()
    .toLowerCase();
  const isUnlimited =
    ["kaban", "kilogram", "kg", "packs"].includes(unit) ||
    ["drinks", "rice"].includes(category);
  const isPieceBased = ["piece", "pieces", "pcs", "pc", "pack"].includes(unit);

  return !isUnlimited && isPieceBased && getQuantity(product) > 0 && getQuantity(product) <= 25;
}
function formatUnit(unit) { return ({ piece: "pcs", pieces: "pcs", pack: "packs", kilogram: "kg", kg: "kg", liter: "L" })[(unit || "piece").toLowerCase()] || unit || "pcs"; }
function formatQuantity(value) { return Number.isInteger(value) ? String(value) : value.toFixed(2); }
function formatCurrency(value) { return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value); }
function formatDate(timestamp) { return timestamp?.toDate ? timestamp.toDate().toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"; }
function setText(selector, value) { const element = document.querySelector(selector); if (element) element.textContent = value; }
function renderMessage(message) { const tbody = document.querySelector("#stockTableBody"); if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="assigned-stock-empty"><strong>${escapeHtml(message)}</strong></td></tr>`; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]); }

export function stopStockPage() {
  unsubscribeStock?.();
  unsubscribeStock = null;
  assignedProducts = [];
}
