// GET CART
let cart = JSON.parse(localStorage.getItem("cart")) || [];

const orderList = document.getElementById("orderList");
const totalItems = document.getElementById("totalItems");
const orderTotal = document.getElementById("orderTotal");

const cashBtn = document.getElementById("cashBtn");
const cashlessBtn = document.getElementById("cashlessBtn");

const checkoutBtn = document.getElementById("checkoutBtn");
const backBtn = document.getElementById("backBtn");

let paymentMethod = "Cash";

// RENDER

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

        totalItems.textContent = 0;
        orderTotal.textContent = "0.00";

        return;
    }

    cart.forEach((item,index)=>{

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
    function renderOrder() {

    orderList.innerHTML = "";

    let total = 0;
    let items = 0;

    cart.forEach((item, index) => {

        const subtotal = item.price * item.qty;

        total += subtotal;
        items += item.qty;

        const card = document.createElement("div");

        card.className = "order-item";

        card.innerHTML = `
            <!-- dito yung bagong HTML na may + at - -->
        `;

        orderList.appendChild(card);

    });

    // + - buttons

    document.querySelectorAll(".plus-btn").forEach(btn => {
        btn.addEventListener("click", () => {

            const index = btn.dataset.index;

            cart[index].qty++;

            localStorage.setItem("cart", JSON.stringify(cart));

            renderOrder();
        });
    });

    document.querySelectorAll(".minus-btn").forEach(btn => {
        btn.addEventListener("click", () => {
 

            if (cart[index].qty > 1) {
                cart[index].qty--;
            } else {
                cart.splice(index, 1);
            }

            localStorage.setItem("cart", JSON.stringify(cart));

            renderOrder();

        });
    });

    //   TOTAL
    totalItems.textContent = items;
    orderTotal.textContent = total.toFixed(2);
}

    totalItems.textContent = items;

    orderTotal.textContent = total.toFixed(2);

}

// PAYMENT

cashBtn.onclick = ()=>{

    paymentMethod="Cash";

    cashBtn.classList.add("active");
    cashlessBtn.classList.remove("active");

}

cashlessBtn.onclick = ()=>{

    paymentMethod="Cashless";

    cashlessBtn.classList.add("active");
    cashBtn.classList.remove("active");

}


// BACK

backBtn.onclick=()=>{

    window.history.back();

}


// CHECKOUT


checkoutBtn.onclick=()=>{

    if(cart.length==0){

        alert("Cart is empty!");

        return;

    }

    alert("Checkout Success!\nPayment : "+paymentMethod);

    localStorage.removeItem("cart");

    cart=[];

    renderOrder();

}

renderOrder();