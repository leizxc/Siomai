// Import Firestore helpers at db mula sa firebase.js
import { getDocs, collection, addDoc }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./firebase.js"; // adjust path depende sa folder structure

//  Hash function
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

//  Open or create IndexedDB
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("OfflineDB", 2);

    request.onupgradeneeded = (event) => {
      const dbLocal = event.target.result;

      // Users store
      if (!dbLocal.objectStoreNames.contains("users")) {
        const usersStore = dbLocal.createObjectStore("users", { keyPath: "username" });
        usersStore.createIndex("role", "role", { unique: false });
      }

      // Orders store
      if (!dbLocal.objectStoreNames.contains("orders")) {
        const ordersStore = dbLocal.createObjectStore("orders", { keyPath: "id", autoIncrement: true });
        ordersStore.createIndex("status", "status", { unique: false });
      }

      //product store
      if (!dbLocal.objectStoreNames.contains("products")) {
        const productStore = dbLocal.createObjectStore("products", { keyPath: "id" });
        productStore.createIndex("employeeId", "employeeId", { unique: false });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject("IndexedDB error: " + event.target.errorCode);
  });
}

//  Save user to IndexedDB (with toast feedback)
async function saveUserOffline(user) {
  const dbLocal = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = dbLocal.transaction("users", "readwrite");
    tx.objectStore("users").put(user);

    tx.oncomplete = () => {
      M.toast({ html: 'User saved offline', classes: 'green-toast' });
      resolve(true);
    };
    tx.onerror = () => reject("Failed to save user offline");
  });
}

//  Get user from IndexedDB (normalize username)
async function getUserOffline(username) {
  const dbLocal = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = dbLocal.transaction("users", "readonly");
    const req = tx.objectStore("users").get(username.toLowerCase().trim());

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject("User lookup failed");
  });
}

//  Offline login check (with user-not-found feedback)
async function offlineLogin(username, password) {
  const user = await getUserOffline(username);
  if (!user) {
    M.toast({ html: 'User not found offline', classes: 'red-toast' });
    return;
  }

  const inputHash = await hashPassword(password);
  if (user.passwordHash === inputHash) {
    redirectByRole(user.role);
    M.toast({ html: 'Offline login success', classes: 'blue-toast' });
  } else {
    M.toast({ html: 'Invalid offline credentials', classes: 'red-toast' });
  }
}

//  Redirect by role
function redirectByRole(role) {
  const lowerRole = role.toLowerCase();
  if (lowerRole === "admin") {
    window.location.href = "/admin/adminpanel.html";
  } else if (lowerRole === "siomai") {
    window.location.href = "/employee/siomai/userpanel.html";
  } else if (lowerRole === "pares") {
    window.location.href = "/employee/pares/userpanel.html";
  }
}

//  Sync users from Firebase to IndexedDB
async function syncUsersFromFirebase() {
  try {
    const dbLocal = await openOfflineDB();
    const snapshot = await getDocs(collection(db, "users"));

    const tx = dbLocal.transaction("users", "readwrite");
    const store = tx.objectStore("users");

    snapshot.forEach((docSnap) => {
      const userData = docSnap.data();
      if (userData.username && userData.passwordHash && userData.role) {
        store.put({
          username: userData.username.toLowerCase().trim(),
          passwordHash: userData.passwordHash,
          role: userData.role.toLowerCase()
        });
      }
    });

    await new Promise((resolve) => (tx.oncomplete = resolve));
    console.log("✅ Users synced to offline DB");
    M.toast({ html: 'Users synced offline', classes: 'green rounded', displayLength: 4000 });
  } catch (err) {
    console.error("❌ Sync failed:", err);
    M.toast({ html: 'Failed to sync users', classes: 'red rounded', displayLength: 4000 });
  }
}

//SyncproductFromFirebase
async function SyncProductFromFirebase() {
  try {
    const dbLocal = await openOfflineDB();
    const snapshot = await getDocs(collection(db, "products"));

    const tx = dbLocal.transaction("products", "readwrite");
    const store = tx.objectStore("products");

    snapshot.forEach((docSnap) => {
      const productData = docSnap.data();
      store.put({
        id: docSnap.id,
        name: productData.name,
        price: productData.price,
        stock: productData.stock,
        role: productData.role,
        employeeId: productData.employeeId
      });
    });

    await new Promise((resolve) => (tx.oncomplete = resolve));
    console.log("✅ Products synced to offline DB");
    setTimeout(() => {
      M.toast({ html: 'Products synced offline', classes: 'green rounded', displayLength: 4000 });
    }, 3200); // lalabas pagkatapos ng una
  } catch (err) {
    console.error("❌ Product sync failed:", err);
    M.toast({ html: 'Failed to sync products', classes: 'red rounded' });
  }
}

// Save orders offline
async function saveOrderOffline(orderData) {
  const dbLocal = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = dbLocal.transaction("orders", "readwrite");
    tx.objectStore("orders").put({ ...orderData, status: "pending" });

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject("Failed to save order offline");
  });
}

// Auto-sync orders when online
window.addEventListener("online", async () => {
  const dbLocal = await openOfflineDB();
  const req = dbLocal.transaction("orders", "readonly").objectStore("orders").getAll();

  req.onsuccess = async () => {
    const orders = req.result.filter(o => o.status === "pending");

    for (const order of orders) {
      await addDoc(collection(db, "orders"), order);

      const txUpdate = dbLocal.transaction("orders", "readwrite");
      txUpdate.objectStore("orders").put({ ...order, status: "synced" });
    }

    M.toast({ html: 'Offline orders synced', classes: 'blue-toast' });
  };
});

//render table of products 
async function loadProductsOffline(employeeId = "") {
  const dbLocal = await openOfflineDB();
  const tx = dbLocal.transaction("products", "readonly");
  const store = tx.objectStore("products");
  const req = store.getAll();

  req.onsuccess = () => {
    let products = req.result;
    if (employeeId) {
      products = products.filter(p => p.employeeId === employeeId);
    }
    renderProductsForEmployee(products); // use the correct renderer
  };
}

async function renderProductsForEmployee(products) {
  const productGrid = document.querySelector(".product-grid");
  productGrid.innerHTML = "";

  products.forEach(data => {
    const card = document.createElement("div");
    card.classList.add("product-card");
    card.innerHTML = `
      <h5>${data.name}</h5>
      <p>₱${data.price}</p>
      <button class="btn add-btn"
        data-id="${data.id}"
        data-name="${data.name}"
        data-price="${data.price}"
        data-stock="${data.stock}">
        Add
      </button>
    `;
    productGrid.appendChild(card);
  });
}
//Export functions para magamit sa ibang modules
export {
  syncUsersFromFirebase,
  offlineLogin,
  saveUserOffline,
  saveOrderOffline,
  SyncProductFromFirebase,
  loadProductsOffline,
  renderProductsForEmployee
};

// Gawin available sa console ng devtool sa Chrome
window.openOfflineDB = openOfflineDB;
window.syncUsersFromFirebase = syncUsersFromFirebase;
window.offlineLogin = offlineLogin;
window.hashPassword = hashPassword;
window.getUserOffline = getUserOffline;
