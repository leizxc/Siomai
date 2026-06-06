function togglePassword() {
  const pwd = document.getElementById('password');
  const toggleIcon = document.querySelector(".toggle-password");

  if (pwd.type === "password") {
    pwd.type = "text";
    toggleIcon.textContent = "visibility_off";
  } else {
    pwd.type = "password";
    toggleIcon.textContent = "visibility";
  }
}