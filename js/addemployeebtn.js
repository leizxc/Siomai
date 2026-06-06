import { addEmployee, loadEmployees } from "../BackEnd/js/adminEmployee.js";

const form = document.getElementById("employeeForm");
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const fname = document.getElementById("fname").value;
    const lname = document.getElementById("lname").value;
    const email = document.getElementById("email").value;
    const role = document.getElementById("role").value;
    const password = document.getElementById("password").value;

    await addEmployee(fname, lname, email, role, password);

    form.reset();
});
//load employees table on page
loadEmployees();
