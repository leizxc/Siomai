export function initPhotoMenu() {
  const uploadBox = document.getElementById("uploadBox");
  const fileInput = document.getElementById("inputImg");
  const preview = document.getElementById("previewImage");

  if (!uploadBox || !fileInput || !preview) return;

  uploadBox.onclick = () => {
    fileInput.click();
  };

  fileInput.onchange = function () {
    const file = this.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = function (e) {
      preview.src = e.target.result;
    };

    reader.readAsDataURL(file);
  };
}