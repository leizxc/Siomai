import { watchActiveShift } from "/js/attendanceAccess.js?v=20261004a";

const previousStates = new WeakMap();
let pageContent = null;
let contentObserver = null;
let managerShiftActive = true;
let isManagerAccount = false;
let stopShiftWatch = null;
let latestShift = { active: false, timedOut: false, pending: false };

function updateText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function syncShiftStatus() {
  if (!pageContent?.isConnected || !isManagerAccount) return;
  let notice = pageContent.querySelector("[data-manager-shift-status]");

  // Kapag active na ang shift, tuluyang tanggalin ang banner
  // (hindi lang i-hide, para hindi manatili ang lumang text).
  if (latestShift.active) {
    notice?.remove();
    return;
  }

  if (!notice) {
    notice = document.createElement("div");
    notice.dataset.managerShiftStatus = "true";
    notice.className = "manager-shift-status";
    notice.setAttribute("role", "status");
    notice.innerHTML =
      '<i class="material-icons" aria-hidden="true"></i><div><strong></strong><span></span></div><button type="button">Go to Attendance</button>';
    notice
      .querySelector("button")
      .addEventListener("click", () => window.loadSection?.("attendance.html"));
    pageContent.prepend(notice);
  }

  notice.hidden = false;
  const icon = notice.querySelector("i");
  const title = notice.querySelector("strong");
  const message = notice.querySelector("span");
  const attendanceButton = notice.querySelector("button");
  if (latestShift.timedOut) {
    updateText(icon, "task_alt");
    updateText(title, "You already timed out");
    updateText(message, "Your time out has been recorded for today.");
    attendanceButton.hidden = true;
  } else if (latestShift.pending) {
    updateText(icon, "hourglass_top");
    updateText(title, "Waiting for approval");
    updateText(
      message,
      "Your attendance request is waiting for the owner's approval.",
    );
    attendanceButton.hidden = false;
  } else {
    updateText(icon, "lock_clock");
    updateText(title, "Need to time in");
    updateText(
      message,
      "Submit your time-in request and wait for the owner's approval.",
    );
    attendanceButton.hidden = false;
  }
}

function isPagingOrDateControl(control) {
  const parentLabels =
    `${control.className || ""} ${control.parentElement?.className || ""} ${control.closest("nav")?.className || ""}`.toLowerCase();
  const accessibleLabel =
    `${control.getAttribute("aria-label") || ""} ${control.title || ""}`
      .trim()
      .toLowerCase();
  return (
    /pagination|page-control|page-number|date-filter|filter-control/.test(
      parentLabels,
    ) ||
    Boolean(
      control.closest(".pagination, [class*='pagination'], [data-pagination]"),
    ) ||
    /^(previous|prev|next|first|last|date|filter|search)( page)?$/.test(
      accessibleLabel,
    )
  );
}

function isWriteAction(control) {
  if (isPagingOrDateControl(control)) return false;
  if (
    control.matches(
      ".recover-btn, .delete-permanent-btn, .save-menu-btn, #edit-menu-save",
    )
  )
    return true;
  const className = String(control.className || "").toLowerCase();
  if (
    /(^|[-_\s])(add|create|edit|update|delete|remove|save)([-_\s]|$)/.test(
      className,
    ) ||
    /save/i.test(control.id || "")
  )
    return true;

  const copy = control.cloneNode(true);
  copy
    .querySelectorAll(".material-icons, [aria-hidden='true']")
    .forEach((icon) => icon.remove());
  const labels = [
    copy.innerText || copy.textContent,
    control.getAttribute("aria-label"),
    control.title,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());
  return labels.some((label) =>
    /^(add|create|edit|update|delete|remove|save)\b/.test(label),
  );
}

function setShiftLocked(control, locked, lockedClass = "manager-write-locked") {
  const wasLocked = control.classList.contains(lockedClass);
  if (locked) {
    if (!wasLocked) {
      previousStates.set(control, {
        disabled: "disabled" in control ? control.disabled : false,
        ariaDisabled: control.getAttribute("aria-disabled"),
        tabIndex: control.getAttribute("tabindex"),
        pointerEvents: control.style.pointerEvents,
      });
    }
    control.classList.add(lockedClass);
    if ("disabled" in control) control.disabled = true;
    control.setAttribute("aria-disabled", "true");
    if (control.matches("a, [role='button']")) {
      control.tabIndex = -1;
      control.style.pointerEvents = "none";
    }
    return;
  }

  if (!wasLocked) return;
  const previous = previousStates.get(control);
  if (previous) {
    if ("disabled" in control) control.disabled = previous.disabled;
    if (previous.ariaDisabled === null)
      control.removeAttribute("aria-disabled");
    else control.setAttribute("aria-disabled", previous.ariaDisabled);
    if (previous.tabIndex === null) control.removeAttribute("tabindex");
    else control.setAttribute("tabindex", previous.tabIndex);
    control.style.pointerEvents = previous.pointerEvents;
    previousStates.delete(control);
  }
  control.classList.remove(lockedClass);
}

function syncProductMenuForms(lockWrites) {
  if (!isManagerAccount) return;
  const addForm = document.getElementById("addProductMenu");
  const editModal = document.getElementById("modal-edit-menu");
  const fields = [
    ...(addForm?.querySelectorAll("input, select, textarea") || []),
    ...(editModal?.querySelectorAll("input, select, textarea") || []),
  ];
  fields.forEach((field) =>
    setShiftLocked(field, lockWrites, "manager-form-field-locked"),
  );

  // Materialize renders a clickable dropdown beside the native select.
  document
    .querySelectorAll("#addProductMenu select, #modal-edit-menu select")
    .forEach((select) => {
      select
        .closest(".select-wrapper")
        ?.classList.toggle("manager-form-select-locked", lockWrites);
    });
}

function syncWriteActions() {
  if (!pageContent?.isConnected) return;
  syncShiftStatus();
  const lockWrites = isManagerAccount && !managerShiftActive;
  // Restrict shift gating to actual action buttons. Generic role=button
  // elements include cards and navigation widgets that must stay interactive.
  const controls = new Set(
    pageContent.querySelectorAll(
      "button, a.btn, [role='button'].manager-write-locked",
    ),
  );
  document
    .querySelectorAll(".recover-btn, .delete-permanent-btn")
    .forEach((control) => controls.add(control));
  controls.forEach((control) => {
    if (
      !isWriteAction(control) &&
      !control.classList.contains("manager-write-locked")
    )
      return;
    setShiftLocked(control, lockWrites);
  });
  syncProductMenuForms(lockWrites);
}

export function initManagerShiftAccess() {
  contentObserver?.disconnect();
  pageContent = document.getElementById("content");
  stopShiftWatch?.();
  stopShiftWatch = watchActiveShift((shift) => {
    isManagerAccount = shift.accountRole === "manager";
    managerShiftActive = shift.active;
    latestShift = shift;
    syncWriteActions();
  });

  if (pageContent && document.body) {
    contentObserver = new MutationObserver(syncWriteActions);
    // Materialize can detach modals into document.body; observe there too so
    // archive actions stay locked while Materialize detaches their modal.
    contentObserver.observe(document.body, { childList: true, subtree: true });
  }
}
