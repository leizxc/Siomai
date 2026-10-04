export function beginButtonLoading(button, message = "Saving...") {
  if (!button || button.dataset.actionBusy === "true") return false;
  button.dataset.actionBusy = "true";
  button.dataset.actionOriginalHtml = button.innerHTML;
  button.dataset.actionOriginalDisabled = String(button.disabled);
  button.dataset.actionOriginalAriaBusy = button.getAttribute("aria-busy") ?? "";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `<span class="button-action-loading"><span class="account-loading-spinner" aria-hidden="true"></span>${message}</span>`;
  return true;
}

export function endButtonLoading(button) {
  if (!button || button.dataset.actionBusy !== "true") return;
  button.innerHTML = button.dataset.actionOriginalHtml || "";
  button.disabled = button.classList.contains("manager-write-locked") || button.dataset.actionOriginalDisabled === "true";
  if (button.dataset.actionOriginalAriaBusy) button.setAttribute("aria-busy", button.dataset.actionOriginalAriaBusy);
  else button.removeAttribute("aria-busy");
  delete button.dataset.actionBusy;
  delete button.dataset.actionOriginalHtml;
  delete button.dataset.actionOriginalDisabled;
  delete button.dataset.actionOriginalAriaBusy;
}
