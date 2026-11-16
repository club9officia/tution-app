// js/receptionist.js
import {
  CONFIG,
  guard,
  initDashboardShell,
  logout,
  dbSet,
  dbPush,
  dbUpdate,
  dbRemove,
  dbWatch,
  objectToList,
  today,
  monthKey,
  formatMonthLabel,
  formatINR,
  format24To12,
  formatTimeHM,
  nowTimeHMS,
  getBatchEndMinutes,
  markCenterQRPrinted,
  sendStudentWhatsApp,
  openExternalUrl,
  escapeHtml,
  toast,
  debounce,
  getPreviousMonthYM,
  getRecentMonthsList,
  computeFeeDueInfo,
  getDefaulters,
  buildFeeReminderMessage,
  openStudentDetailPopup,
  openFeeDetailPopup,
  openAttendanceDetailPopup,
  openLeaveDetailPopup,
  openExpenseDetailPopup
} from "./app.js";

const session = guard("receptionist");
if (!session) throw new Error("Unauthorized");

const panelTitles = {
  students: "Students",
  fees: "Fees & Invoices",
  defaulters: "Fee Defaulters",
  attendance: "Attendance & QR",
  leaves: "Leave Approvals",
  timing: "Today's Timing Override",
  expenses: "Expenses",
  more: "More Options"
};

const { activatePanel } = initDashboardShell((target) => {
  document.getElementById("topbar-title").textContent = panelTitles[target] || "Receptionist";
  if (target === "attendance") {
    runAutoAbsentCheck();
  }
  if (target === "defaulters") {
    renderDefaultersList();
  }
});
document.getElementById("rec-user-badge").textContent = `${session.name} (${session.id})`;

// ============================================================================
// STATE
// ============================================================================
const state = {
  sessions: [],
  batches: [],
  students: [],
  fees: [],
  expenses: [],
  attendance: {},
  timingOverrides: {},
  leaves: [],
  selectedMonth: monthKey(),
  selectedFeeStudentId: null,
  selectedFeeMode: "cash",
  attCardModes: {},
  centerQR: null
};

document.getElementById("stu-joining").value = today();
document.getElementById("att-date").value = today();
document.getElementById("rec-exp-date").value = today();
document.getElementById("override-today-badge").textContent = today();

// ============================================================================
// MORE PANEL HANDLERS
// ============================================================================
document.querySelectorAll(".rec-more-nav").forEach((btn) => {
  btn.addEventListener("click", () => activatePanel(btn.dataset.panel));
});

async function launchCenterQRPrint() {
  try {
    await markCenterQRPrinted();
    openExternalUrl(new URL("qr-print.html", window.location.href).toString());
  } catch (err) {
    console.error(err);
    toast("Unable to open Center QR print page.", "error");
  }
}

document.getElementById("rec-more-print-qr-btn").addEventListener("click", launchCenterQRPrint);
document.getElementById("rec-more-logout-btn").addEventListener("click", logout);

// ============================================================================
// SELECT POPULATION HELPERS
// ============================================================================
function getSessionName(sessionId) {
  const s = state.sessions.find((x) => x.id === sessionId);
  return s ? s.name : "--";
}

function getBatch(batchId) {
  return state.batches.find((b) => b.id === batchId) || null;
}

function getBatchName(batchId) {
  const b = getBatch(batchId);
  return b ? b.name : "--";
}

function populateBatchDropdown(sessionSelectEl, batchSelectEl) {
  const selectedSession = sessionSelectEl.value;
  const currentBatch = batchSelectEl.value;
  const filtered = state.batches.filter((b) => !selectedSession || b.sessionId === selectedSession);

  let html = "";
  if (filtered.length) {
    html = filtered
      .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)} (${escapeHtml(b.timing || "")})</option>`)
      .join("");
  } else {
    html = `<option value="">No batches in session</option>`;
  }
  batchSelectEl.innerHTML = html;

  if (currentBatch && filtered.some((b) => b.id === currentBatch)) {
    batchSelectEl.value = currentBatch;
  }
}

function populateAllSessionDropdowns() {
  const pairs = [
    ["stu-session", "stu-batch"],
    ["att-session", "att-batch"],
    ["ov-session", "ov-batch"]
  ];
  pairs.forEach(([sId, bId]) => {
    const sEl = document.getElementById(sId);
    const bEl = document.getElementById(bId);
    const prev = sEl.value;
    sEl.innerHTML = state.sessions.length
      ? state.sessions.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("")
      : `<option value="">No sessions</option>`;
    if (prev && state.sessions.some((s) => s.id === prev)) sEl.value = prev;
    populateBatchDropdown(sEl, bEl);
  });
}

["stu", "att", "ov"].forEach((prefix) => {
  document.getElementById(`${prefix}-session`).addEventListener("change", () => {
    populateBatchDropdown(
      document.getElementById(`${prefix}-session`),
      document.getElementById(`${prefix}-batch`)
    );
    if (prefix === "att") {
      renderAttendance();
      runAutoAbsentCheck();
    }
  });
});

// ============================================================================
// 1. STUDENTS MODULE (COMPACT BOXES + DETAIL POPUP)
// ============================================================================
function nextStudentId() {
  let maxNum = 0;
  state.students.forEach((stu) => {
    if (String(stu.id).startsWith("STD")) {
      const n = parseInt(String(stu.id).slice(3), 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return "STD" + String(maxNum + 1).padStart(2, "0");
}

function showStudentCreds(stu, password) {
  const banner = document.getElementById("student-cred-banner");
  banner.classList.remove("hidden");
  banner.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
      <div>
        <strong>Student Credentials (${escapeHtml(stu.name)}):</strong>
        ID: <span class="mono"><strong>${escapeHtml(stu.id)}</strong></span> |
        Password: <span class="mono"><strong>${escapeHtml(password)}</strong></span>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <button type="button" class="btn btn-outline btn-sm btn-inline" id="copy-stu-cred">Copy</button>
        <select id="cred-wa-target" aria-label="Credential WhatsApp target" style="width:auto; min-height:44px; padding:6px 10px;">
          <option value="parental">Parental (Primary)</option>
          <option value="father">Father</option>
          <option value="mother">Mother</option>
          <option value="personal">Personal</option>
        </select>
        <button type="button" class="btn btn-wa btn-sm btn-inline" id="wa-stu-cred">Send on WhatsApp</button>
      </div>
    </div>
  `;
  const msg = `Welcome to ${CONFIG.tuitionName}, ${stu.name}!\nYour Student Portal login:\nStudent ID: ${stu.id}\nPassword: ${password}\nLogin at: ${window.location.origin}/index.html`;
  document.getElementById("copy-stu-cred").addEventListener("click", async () => {
    await navigator.clipboard.writeText(msg);
    toast("Student credentials copied.", "success");
  });
  document.getElementById("wa-stu-cred").addEventListener("click", () => {
    const pref = document.getElementById("cred-wa-target").value;
    sendStudentWhatsApp(stu, msg, pref);
  });
}

const studentModal = document.getElementById("student-modal");
function openStudentModal() {
  if (studentModal) studentModal.classList.add("open");
}
function closeStudentModal() {
  if (studentModal) studentModal.classList.remove("open");
}

const fabAddStudent = document.getElementById("fab-add-student");
if (fabAddStudent) {
  fabAddStudent.addEventListener("click", () => {
    resetStudentForm();
    const banner = document.getElementById("student-cred-banner");
    if (banner) banner.classList.add("hidden");
    openStudentModal();
  });
}
const closeStudentModalBtn = document.getElementById("close-student-modal-btn");
if (closeStudentModalBtn) {
  closeStudentModalBtn.addEventListener("click", closeStudentModal);
}
if (studentModal) {
  studentModal.addEventListener("click", (e) => {
    if (e.target === studentModal) closeStudentModal();
  });
}

function resetStudentForm() {
  document.getElementById("student-edit-id").value = "";
  document.getElementById("student-form").reset();
  document.getElementById("stu-joining").value = today();
  document.getElementById("stu-mode").value = "offline";
  document.getElementById("stu-password-wrap").classList.remove("hidden");
  document.getElementById("student-form-title").textContent = "Enroll New Student";
  document.getElementById("student-submit-btn").textContent = "Enroll Student";
  const cancelBtn = document.getElementById("cancel-student-edit");
  if (cancelBtn) cancelBtn.classList.add("hidden");
  populateAllSessionDropdowns();
}

function startEditStudent(s) {
  if (!s) return;
  document.getElementById("student-edit-id").value = s.id;
  document.getElementById("stu-name").value = s.name || "";
  document.getElementById("stu-parental").value = s.parentalPhone || s.fatherPhone || "";
  document.getElementById("stu-father").value = s.fatherPhone || "";
  document.getElementById("stu-mother").value = s.motherPhone || "";
  document.getElementById("stu-personal").value = s.personalPhone || "";
  document.getElementById("stu-session").value = s.sessionId || "";
  populateBatchDropdown(document.getElementById("stu-session"), document.getElementById("stu-batch"));
  document.getElementById("stu-batch").value = s.batchId || "";
  document.getElementById("stu-joining").value = s.joiningDate || today();
  document.getElementById("stu-mode").value = s.mode || "offline";
  document.getElementById("stu-password-wrap").classList.add("hidden");
  document.getElementById("student-form-title").textContent = `Edit Student (${s.id})`;
  document.getElementById("student-submit-btn").textContent = "Update Student";
  const cancelBtn = document.getElementById("cancel-student-edit");
  if (cancelBtn) cancelBtn.classList.remove("hidden");
  openStudentModal();
}

function renderDefaultersList() {
  const defaulters = getDefaulters(state.students, state.fees, state.batches);
  const badge = document.getElementById("defaulters-count-badge");
  if (badge) badge.textContent = `${defaulters.length} Defaulter${defaulters.length === 1 ? "" : "s"}`;
  const container = document.getElementById("defaulters-list");
  if (!container) return;

  if (!defaulters.length) {
    container.innerHTML = `<p class="text-muted" style="margin:0;">No fee defaulters for previous month.</p>`;
    return;
  }

  container.innerHTML = defaulters
    .map(({ student, batch, prevYm, prevMonthLabel, amount }) => {
      const primaryPhone = student.parentalPhone || student.fatherPhone || student.motherPhone || student.personalPhone || "";
      const telHref = primaryPhone ? `tel:${primaryPhone}` : "";
      return `
        <div class="list-box defaulter-box" data-id="${escapeHtml(student.id)}">
          <div class="list-box-main">
            <div class="list-box-title"><span class="mono">${escapeHtml(student.id)}</span> · ${escapeHtml(student.name)}</div>
            <div class="list-box-sub">
              <span>Batch: ${escapeHtml(batch ? batch.name : "--")}</span>
              <span>• Unpaid: ${escapeHtml(prevMonthLabel)} (${formatINR(amount)})</span>
              <span>• 👨‍👩‍👧 ${escapeHtml(primaryPhone || "No phone")}</span>
            </div>
          </div>
          <div class="list-box-actions">
            ${telHref ? `<a href="${escapeHtml(telHref)}" class="btn btn-outline btn-sm btn-inline" onclick="event.stopPropagation();">📞 Call</a>` : ""}
            ${primaryPhone ? `<button type="button" class="btn btn-wa btn-sm btn-inline wa-defaulter-btn" data-id="${escapeHtml(student.id)}" data-ym="${escapeHtml(prevYm)}">💬 WhatsApp</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

const defaultersListEl = document.getElementById("defaulters-list");
if (defaultersListEl) {
  defaultersListEl.addEventListener("click", (e) => {
    const waBtn = e.target.closest(".wa-defaulter-btn");
    if (waBtn) {
      e.stopPropagation();
      const stdId = waBtn.dataset.id;
      const ym = waBtn.dataset.ym;
      const stu = state.students.find((s) => s.id === stdId);
      const batch = getBatch(stu ? stu.batchId : null);
      if (stu) {
        const msg = buildFeeReminderMessage(stu, batch, ym);
        sendStudentWhatsApp(stu, msg, "parental");
      }
      return;
    }
    const box = e.target.closest(".defaulter-box");
    if (!box) return;
    const stu = state.students.find((s) => s.id === box.dataset.id);
    if (!stu) return;
    openStudentDetailPopup(stu, {
      batchName: getBatchName(stu.batchId),
      sessionName: getSessionName(stu.sessionId),
      feesList: state.fees,
      attendanceMap: state.attendance,
      canManage: true,
      onEdit: (target) => {
        closePopup();
        startEditStudent(target);
      },
      onResetPassword: async (target) => {
        await dbUpdate(`students/${target.id}`, { password: "123456" });
        showStudentCreds(target, "123456");
        toast(`Password reset to 123456 for ${target.id}.`, "success");
      },
      onDelete: async (target) => {
        await dbRemove(`students/${target.id}`);
        toast("Student deleted.", "info");
      }
    });
  });
}

const cancelStudentEditBtn = document.getElementById("cancel-student-edit");
if (cancelStudentEditBtn) {
  cancelStudentEditBtn.addEventListener("click", resetStudentForm);
}

document.getElementById("student-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const editId = document.getElementById("student-edit-id").value;
  const name = document.getElementById("stu-name").value.trim();
  const parentalPhone = document.getElementById("stu-parental").value.trim();
  const fatherPhone = document.getElementById("stu-father").value.trim();
  const motherPhone = document.getElementById("stu-mother").value.trim();
  const personalPhone = document.getElementById("stu-personal").value.trim();
  const sessionId = document.getElementById("stu-session").value;
  const batchId = document.getElementById("stu-batch").value;
  const joiningDate = document.getElementById("stu-joining").value;
  const mode = document.getElementById("stu-mode").value || "offline";
  const rawPwd = document.getElementById("stu-password").value.trim();
  const password = rawPwd || "123456";

  if (!parentalPhone) {
    toast("Parental Mobile (Primary) is required.", "error");
    document.getElementById("stu-parental").focus();
    return;
  }

  if (!sessionId || !batchId) {
    toast("Please select a valid session and batch.", "error");
    return;
  }

  try {
    if (editId) {
      await dbUpdate(`students/${editId}`, {
        name,
        parentalPhone,
        fatherPhone,
        motherPhone,
        personalPhone,
        sessionId,
        batchId,
        joiningDate,
        mode
      });
      toast(`Updated ${editId}.`, "success");
      resetStudentForm();
      return;
    }

    const id = nextStudentId();
    const stuObj = {
      id,
      name,
      parentalPhone,
      fatherPhone,
      motherPhone,
      personalPhone,
      sessionId,
      batchId,
      joiningDate,
      mode,
      password,
      active: true,
      createdAt: Date.now()
    };
    await dbSet(`students/${id}`, stuObj);
    showStudentCreds(stuObj, password);
    toast(`Enrolled ${name} (${id}).`, "success");
    resetStudentForm();
  } catch (err) {
    console.error(err);
    toast("Failed to save student.", "error");
  }
});

function renderStudentsList() {
  const q = document.getElementById("student-search").value.trim().toLowerCase();
  const list = state.students.filter((s) => {
    if (s.active === false) return false;
    if (!q) return true;
    return (
      String(s.id).toLowerCase().includes(q) ||
      String(s.name || "").toLowerCase().includes(q) ||
      String(s.parentalPhone || "").includes(q) ||
      String(s.fatherPhone || "").includes(q) ||
      String(s.motherPhone || "").includes(q) ||
      String(s.personalPhone || "").includes(q)
    );
  });

  const container = document.getElementById("students-list");
  container.innerHTML = list.length
    ? list
        .map((s) => {
          const b = getBatch(s.batchId);
          const primary = s.parentalPhone || s.fatherPhone || s.motherPhone || s.personalPhone || "--";
          return `
          <div class="list-box rec-stu-box" data-id="${escapeHtml(s.id)}">
            <div class="list-box-main">
              <div class="list-box-title"><span class="mono">${escapeHtml(s.id)}</span> · ${escapeHtml(s.name)}</div>
              <div class="list-box-sub">
                <span>${escapeHtml(b ? b.name : "--")}</span>
                <span>• 👨‍👩‍👧 ${escapeHtml(primary)}</span>
              </div>
            </div>
            <div class="list-box-actions">
              <button type="button" class="btn btn-outline btn-sm btn-inline edit-stu-btn" data-id="${escapeHtml(s.id)}">Edit</button>
            </div>
          </div>
        `;
        })
        .join("")
    : `<p class="text-muted" style="margin:0;">No matching students found.</p>`;
}

document.getElementById("student-search").addEventListener("input", debounce(renderStudentsList, 180));

document.getElementById("students-list").addEventListener("click", (e) => {
  const editBtn = e.target.closest(".edit-stu-btn");
  if (editBtn) {
    e.stopPropagation();
    const s = state.students.find((x) => x.id === editBtn.dataset.id);
    startEditStudent(s);
    return;
  }

  const box = e.target.closest(".rec-stu-box");
  if (!box) return;
  const stu = state.students.find((x) => x.id === box.dataset.id);
  if (!stu) return;

  openStudentDetailPopup(stu, {
    batchName: getBatchName(stu.batchId),
    sessionName: getSessionName(stu.sessionId),
    feesList: state.fees,
    attendanceMap: state.attendance,
    canManage: true,
    onEdit: (target) => startEditStudent(target),
    onResetPassword: async (target) => {
      await dbUpdate(`students/${target.id}`, { password: "123456" });
      showStudentCreds(target, "123456");
      toast(`Password reset to 123456 for ${target.id}.`, "success");
    },
    onDelete: async (target) => {
      await dbRemove(`students/${target.id}`);
      toast("Student deleted.", "info");
    }
  });
});

// ============================================================================
// 2. FEES & INVOICES (Month Picker + Debounced Search + Single Student Card)
// ============================================================================
const monthPickerBtn = document.getElementById("fee-month-picker-btn");
const monthPickerLabel = document.getElementById("fee-month-picker-label");
const monthDropdown = document.getElementById("fee-month-dropdown");
const feeSearchInput = document.getElementById("fee-search");
const feeSuggestionsEl = document.getElementById("fee-suggestions");
const feeSelectedCardEl = document.getElementById("fee-selected-card");

function renderMonthPicker() {
  monthPickerLabel.textContent = formatMonthLabel(state.selectedMonth);
  const months = getRecentMonthsList(13, monthKey());
  const prevYm = getPreviousMonthYM(state.selectedMonth);

  monthDropdown.innerHTML =
    `<button type="button" class="month-picker-item prev-shortcut" data-ym="${escapeHtml(prevYm)}">
      <span>📅 Open Previous Month</span>
      <span style="font-size:13px;">${escapeHtml(formatMonthLabel(prevYm))}</span>
    </button>` +
    months
      .map(
        (m) => `
      <button type="button" class="month-picker-item ${m.ym === state.selectedMonth ? "active" : ""}" data-ym="${escapeHtml(m.ym)}">
        <span>${escapeHtml(m.label)}</span>
        ${m.ym === state.selectedMonth ? "<span>✓</span>" : ""}
      </button>
    `
      )
      .join("");
}

function closeMonthDropdown() {
  monthDropdown.classList.remove("open");
  monthPickerBtn.setAttribute("aria-expanded", "false");
}

monthPickerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  renderMonthPicker();
  const isOpen = monthDropdown.classList.toggle("open");
  monthPickerBtn.setAttribute("aria-expanded", String(isOpen));
});

monthDropdown.addEventListener("click", (e) => {
  const item = e.target.closest(".month-picker-item");
  if (!item || !item.dataset.ym) return;
  state.selectedMonth = item.dataset.ym;
  closeMonthDropdown();
  renderMonthPicker();
  renderSelectedFeeStudentCard();
  renderPaidFeesList();
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".month-picker-wrap")) {
    closeMonthDropdown();
  }
});

function getFeeSearchMatches(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const activeStudents = state.students.filter((s) => s.active !== false);
  const matches = activeStudents.filter(
    (s) =>
      String(s.id || "").toLowerCase().includes(q) ||
      String(s.name || "").toLowerCase().includes(q)
  );
  matches.sort((a, b) => {
    const aExact = String(a.id || "").toLowerCase() === q ? 1 : 0;
    const bExact = String(b.id || "").toLowerCase() === q ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aStarts = String(a.id || "").toLowerCase().startsWith(q) || String(a.name || "").toLowerCase().startsWith(q) ? 1 : 0;
    const bStarts = String(b.id || "").toLowerCase().startsWith(q) || String(b.name || "").toLowerCase().startsWith(q) ? 1 : 0;
    if (aStarts !== bStarts) return bStarts - aStarts;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  return matches.slice(0, 6);
}

function renderFeeSuggestions() {
  const q = feeSearchInput.value.trim();
  if (!q) {
    feeSuggestionsEl.classList.add("hidden");
    feeSuggestionsEl.innerHTML = "";
    return;
  }

  const matches = getFeeSearchMatches(q);
  feeSuggestionsEl.classList.remove("hidden");
  if (!matches.length) {
    feeSuggestionsEl.innerHTML = `<div style="padding:12px 14px;" class="text-muted">No matching student found.</div>`;
    return;
  }

  const qLower = q.toLowerCase();
  feeSuggestionsEl.innerHTML = matches
    .map((stu) => {
      const isExact = String(stu.id || "").toLowerCase() === qLower;
      const b = getBatch(stu.batchId);
      const feeRec = state.fees.find((f) => f.studentId === stu.id && f.month === state.selectedMonth) || null;
      const dueInfo = computeFeeDueInfo(state.selectedMonth, feeRec);
      return `
        <button type="button" class="suggest-item ${isExact ? "exact-match" : ""}" data-id="${escapeHtml(stu.id)}">
          <div>
            <div><strong class="mono">${escapeHtml(stu.id)}</strong> · <strong>${escapeHtml(stu.name)}</strong></div>
            <div class="text-muted" style="font-size:14px;">${escapeHtml(b ? b.name : "--")}</div>
          </div>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            ${isExact ? `<span class="badge badge-primary">Exact Match</span>` : ""}
            <span class="badge ${dueInfo.badgeClass}">${escapeHtml(dueInfo.label)}</span>
          </div>
        </button>
      `;
    })
    .join("");
}

feeSearchInput.addEventListener("input", debounce(renderFeeSuggestions, 250));

feeSuggestionsEl.addEventListener("click", (e) => {
  const item = e.target.closest(".suggest-item");
  if (!item) return;
  state.selectedFeeStudentId = item.dataset.id;
  state.selectedFeeMode = "cash";
  feeSuggestionsEl.classList.add("hidden");
  renderSelectedFeeStudentCard();
});

function clearFeeSelection() {
  state.selectedFeeStudentId = null;
  feeSearchInput.value = "";
  feeSuggestionsEl.classList.add("hidden");
  feeSuggestionsEl.innerHTML = "";
  feeSelectedCardEl.classList.add("hidden");
  feeSelectedCardEl.innerHTML = "";
}

function renderSelectedFeeStudentCard() {
  if (!state.selectedFeeStudentId) {
    feeSelectedCardEl.classList.add("hidden");
    feeSelectedCardEl.innerHTML = "";
    return;
  }
  const stu = state.students.find((s) => s.id === state.selectedFeeStudentId);
  if (!stu) {
    clearFeeSelection();
    return;
  }

  const batch = getBatch(stu.batchId);
  const amount = batch ? Number(batch.monthlyFees) || 0 : 0;
  const existingFee = state.fees.find((f) => f.studentId === stu.id && f.month === state.selectedMonth) || null;
  const dueInfo = computeFeeDueInfo(state.selectedMonth, existingFee);

  feeSelectedCardEl.classList.remove("hidden");
  feeSelectedCardEl.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:10px;">
      <div>
        <div style="font-size:1.08rem; font-weight:800; color:var(--primary);">
          ${escapeHtml(stu.name)} (<span class="mono">${escapeHtml(stu.id)}</span>)
        </div>
        <div class="text-muted" style="font-size:14px;">
          Batch: ${escapeHtml(batch ? batch.name : "--")} • Month: ${escapeHtml(formatMonthLabel(state.selectedMonth))}
        </div>
      </div>
      <button type="button" id="dismiss-fee-card-btn" class="btn btn-outline btn-sm btn-inline popup-close-btn" aria-label="Dismiss card" style="min-width:44px; min-height:44px;">✕</button>
    </div>

    <div class="popup-mini-list" style="margin-bottom:12px;">
      <div class="popup-mini-row">
        <span>Monthly Fee</span>
        <strong style="font-size:1.1rem; color:var(--primary);">${formatINR(amount)}</strong>
      </div>
      <div class="popup-mini-row">
        <span>Status (${escapeHtml(formatMonthLabel(state.selectedMonth))})</span>
        <span class="badge ${dueInfo.badgeClass}">${escapeHtml(dueInfo.label)}</span>
      </div>
    </div>

    ${
      existingFee
        ? `<div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button type="button" id="view-selected-receipt-btn" class="btn btn-primary btn-block">🧾 View Receipt</button>
          </div>`
        : `<div class="pay-mode-group">
            <button type="button" class="pay-mode-btn ${state.selectedFeeMode === "cash" ? "active" : ""}" data-mode="cash">💵 Cash</button>
            <button type="button" class="pay-mode-btn ${state.selectedFeeMode === "upi" ? "active" : ""}" data-mode="upi">📱 UPI</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <button type="button" id="confirm-mark-paid-btn" class="btn btn-success btn-block">✓ Mark as Paid (${escapeHtml(state.selectedFeeMode.toUpperCase())})</button>
            <button type="button" id="send-fee-reminder-btn" class="btn btn-wa btn-block">💬 Send Fee Reminder</button>
          </div>`
    }
  `;
}

feeSelectedCardEl.addEventListener("click", async (e) => {
  if (e.target.closest("#dismiss-fee-card-btn")) {
    clearFeeSelection();
    return;
  }

  const modeBtn = e.target.closest(".pay-mode-btn");
  if (modeBtn) {
    state.selectedFeeMode = modeBtn.dataset.mode;
    renderSelectedFeeStudentCard();
    return;
  }

  const stu = state.students.find((s) => s.id === state.selectedFeeStudentId);
  if (!stu) return;
  const batch = getBatch(stu.batchId);
  const amount = batch ? Number(batch.monthlyFees) || 0 : 0;

  if (e.target.closest("#view-selected-receipt-btn")) {
    const fee = state.fees.find((f) => f.studentId === stu.id && f.month === state.selectedMonth);
    if (fee) openFeeDetailPopup(fee, { student: stu, batchName: batch ? batch.name : "--" });
    return;
  }

  if (e.target.closest("#send-fee-reminder-btn")) {
    const monthLabel = formatMonthLabel(state.selectedMonth);
    const msg = `Dear Parent/Student, gentle fee reminder from ${CONFIG.tuitionName}: Monthly fee of ${formatINR(amount)} for ${stu.name} (${monthLabel}) is pending (due 1st–10th). Please pay via Cash or UPI. Thank you!`;
    sendStudentWhatsApp(stu, msg, "parental");
    return;
  }

  if (e.target.closest("#confirm-mark-paid-btn")) {
    const mode = state.selectedFeeMode || "cash";
    const feePayload = {
      studentId: stu.id,
      studentName: stu.name,
      batchId: stu.batchId,
      sessionId: stu.sessionId,
      month: state.selectedMonth,
      amount,
      mode,
      paidAt: Date.now(),
      markedBy: `${session.name} (${session.id})`
    };

    try {
      const feeId = await dbPush("fees", feePayload);
      toast(`Marked ${stu.name} as Paid (${mode.toUpperCase()}) for ${formatMonthLabel(state.selectedMonth)}.`, "success");
      clearFeeSelection();
      openFeeDetailPopup({ id: feeId, ...feePayload }, { student: stu, batchName: batch ? batch.name : "--" });
    } catch (err) {
      console.error(err);
      toast("Failed to record payment.", "error");
    }
  }
});

function renderPaidFeesList() {
  const ym = state.selectedMonth;
  const label = formatMonthLabel(ym);
  document.getElementById("fee-paid-month-label").textContent = label;

  const paidRecords = state.fees
    .filter((f) => f.month === ym)
    .sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0));

  const monthTotal = paidRecords.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  document.getElementById("fee-month-total").textContent = formatINR(monthTotal);

  const container = document.getElementById("paid-fees-list");
  container.innerHTML = paidRecords.length
    ? paidRecords
        .map((f) => {
          const b = getBatch(f.batchId);
          return `
          <div class="list-box paid-fee-box" data-fee-id="${escapeHtml(f.id)}">
            <div class="list-box-main">
              <div class="list-box-title"><span class="mono">${escapeHtml(f.studentId)}</span> · ${escapeHtml(f.studentName)}</div>
              <div class="list-box-sub">
                <span>${escapeHtml(b ? b.name : "--")}</span>
                <span class="badge badge-primary">${escapeHtml((f.mode || "cash").toUpperCase())}</span>
              </div>
            </div>
            <div class="list-box-actions">
              <span class="badge badge-success">${formatINR(f.amount)}</span>
            </div>
          </div>
        `;
        })
        .join("")
    : `<p class="text-muted" style="margin:0;">No paid receipts recorded for ${escapeHtml(label)}.</p>`;
}

document.getElementById("paid-fees-list").addEventListener("click", (e) => {
  const box = e.target.closest(".paid-fee-box");
  if (!box) return;
  const fee = state.fees.find((f) => f.id === box.dataset.feeId);
  if (!fee) return;
  const stu = state.students.find((s) => s.id === fee.studentId) || null;
  openFeeDetailPopup(fee, { student: stu, batchName: getBatchName(fee.batchId) });
});

// ============================================================================
// 3. ATTENDANCE (P-BUTTON VERTICAL LIST + CONDITIONAL OFFLINE/ONLINE PILL)
// ============================================================================
function getEffectiveTimingForDate(batch, dateStr) {
  if (!batch) return "--";
  const key = `${dateStr}_${batch.id}`;
  const ovList = objectToList(state.timingOverrides[key]).sort((a, b) => (b.overriddenAt || 0) - (a.overriddenAt || 0));
  if (ovList.length) return ovList[0].newTiming;
  return batch.timing || "--";
}

function getEffectiveEndMinutes(batch, dateStr) {
  if (!batch) return null;
  const key = `${dateStr}_${batch.id}`;
  const ovList = objectToList(state.timingOverrides[key]).sort((a, b) => (b.overriddenAt || 0) - (a.overriddenAt || 0));
  if (ovList.length && ovList[0].endTime) {
    return getBatchEndMinutes({ endTime: ovList[0].endTime });
  }
  return getBatchEndMinutes(batch);
}

async function runAutoAbsentCheck() {
  const batchId = document.getElementById("att-batch").value;
  const dateStr = document.getElementById("att-date").value || today();
  if (!batchId || !dateStr) return;

  const batch = getBatch(batchId);
  if (!batch) return;

  const todayStr = today();
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const endMins = getEffectiveEndMinutes(batch, dateStr);

  const shouldAutoAbsent =
    dateStr < todayStr ||
    (dateStr === todayStr && endMins !== null && nowMins >= endMins);

  const statusBanner = document.getElementById("att-auto-status");
  if (!shouldAutoAbsent) {
    statusBanner.classList.add("hidden");
    return;
  }

  const key = `${dateStr}_${batchId}`;
  const existingAtt = state.attendance[key] || {};
  const batchStudents = state.students.filter((s) => s.active !== false && s.batchId === batchId);

  const updates = {};
  let markedCount = 0;
  batchStudents.forEach((stu) => {
    if (!existingAtt[stu.id]) {
      updates[`attendance/${key}/${stu.id}`] = {
        status: "absent",
        markedAt: Date.now(),
        markedBy: session.id,
        source: "manual",
        autoMarked: true
      };
      markedCount += 1;
    }
  });

  if (markedCount > 0) {
    await dbUpdate("", updates);
    toast(`Auto-marked ${markedCount} unmarked student(s) as Absent (batch time ended).`, "info");
  }

  statusBanner.classList.remove("hidden");
  statusBanner.textContent = "Batch end time has passed — any unmarked students are automatically marked Absent.";
}

function renderCenterQRStatus() {
  const lastPrintedEl = document.getElementById("att-qr-last-printed");
  if (!lastPrintedEl) return;
  const cqr = state.centerQR;
  if (!cqr || !cqr.token) {
    lastPrintedEl.textContent = "Center QR not initialized yet (Admin must sign in first).";
  } else if (cqr.printedAt) {
    lastPrintedEl.textContent = `Center QR was last printed on ${new Date(cqr.printedAt).toLocaleString("en-IN")}`;
  } else {
    lastPrintedEl.textContent = "Center QR has not been printed yet.";
  }
}

function renderAttendance() {
  const batchId = document.getElementById("att-batch").value;
  const dateStr = document.getElementById("att-date").value || today();
  const batch = getBatch(batchId);
  const badge = document.getElementById("att-batch-timing-badge");
  const container = document.getElementById("attendance-p-list");

  renderCenterQRStatus();

  if (!batch) {
    badge.textContent = "Select a batch";
    container.innerHTML = `<p class="text-muted" style="margin:0;">Select a session and batch.</p>`;
    return;
  }

  badge.textContent = `Timing: ${getEffectiveTimingForDate(batch, dateStr)}`;

  const key = `${dateStr}_${batchId}`;
  const attMap = state.attendance[key] || {};
  const batchStudents = state.students.filter((s) => s.active !== false && s.batchId === batchId);

  if (!batchStudents.length) {
    container.innerHTML = `<p class="text-muted" style="margin:0;">No active students in this batch.</p>`;
    return;
  }

  const batchHasOnlineStudents = batchStudents.some((s) => s.mode === "online");

  container.innerHTML = batchStudents
    .map((stu) => {
      const rec = attMap[stu.id] || null;
      const status = rec ? rec.status : "unmarked";
      const isMarkedPresent = status === "present" || status === "online";
      const timeHM = rec && rec.checkinTime ? formatTimeHM(rec.checkinTime) : "";

      let chipHtml = `<span class="badge badge-muted">Unmarked</span>`;
      if (status === "present") {
        chipHtml =
          rec && rec.source === "qr"
            ? `<span class="badge badge-success">✓ Present${timeHM ? ` (${escapeHtml(timeHM)})` : ""}</span>`
            : `<span class="badge badge-success">✓ Present</span>`;
      } else if (status === "online") {
        chipHtml = `<span class="badge badge-primary">🌐 Online</span>`;
      } else if (status === "absent") {
        chipHtml = `<span class="badge badge-danger">Absent${rec && rec.autoMarked ? " (Auto)" : ""}</span>`;
      }

      const cardModeKey = `${key}_${stu.id}`;
      const selectedMode =
        status === "online"
          ? "online"
          : status === "present"
            ? "offline"
            : state.attCardModes[cardModeKey] || "offline";

      const modePillHtml = batchHasOnlineStudents
        ? `<div class="mode-pill" role="group" aria-label="Attendance mode for ${escapeHtml(stu.name)}">
            <button type="button" class="mode-pill-btn ${selectedMode === "offline" ? "active" : ""}" data-id="${escapeHtml(stu.id)}" data-mode="offline">Offline</button>
            <button type="button" class="mode-pill-btn ${selectedMode === "online" ? "active" : ""}" data-id="${escapeHtml(stu.id)}" data-mode="online">Online</button>
          </div>`
        : "";

      return `
        <div class="att-p-card" data-std="${escapeHtml(stu.id)}">
          <div class="att-p-info">
            <div class="list-box-title"><span class="mono">${escapeHtml(stu.id)}</span> · ${escapeHtml(stu.name)}</div>
            <div>${chipHtml}</div>
          </div>
          <div class="att-p-controls">
            <button
              type="button"
              class="p-toggle-btn ${isMarkedPresent ? "active" : ""}"
              data-id="${escapeHtml(stu.id)}"
              aria-pressed="${isMarkedPresent ? "true" : "false"}"
              aria-label="Toggle present for ${escapeHtml(stu.name)}"
            >${isMarkedPresent ? "✓ P" : "P"}</button>
            ${modePillHtml}
          </div>
        </div>
      `;
    })
    .join("");
}

async function saveAttendanceStatus(stdId, dateStr, batchId, status) {
  await dbSet(`attendance/${dateStr}_${batchId}/${stdId}`, {
    status,
    checkinDate: dateStr,
    checkinTime: nowTimeHMS(),
    markedAt: Date.now(),
    markedBy: session.id,
    source: "manual"
  });
}

document.getElementById("att-batch").addEventListener("change", () => {
  renderAttendance();
  runAutoAbsentCheck();
});
document.getElementById("att-date").addEventListener("change", () => {
  renderAttendance();
  runAutoAbsentCheck();
});

document.getElementById("attendance-p-list").addEventListener("click", async (e) => {
  const batchId = document.getElementById("att-batch").value;
  const dateStr = document.getElementById("att-date").value || today();
  if (!batchId) return;
  const key = `${dateStr}_${batchId}`;
  const attMap = state.attendance[key] || {};

  const pBtn = e.target.closest(".p-toggle-btn");
  if (pBtn) {
    e.stopPropagation();
    const stdId = pBtn.dataset.id;
    const rec = attMap[stdId] || null;
    const isCurrentlyPresent = rec && (rec.status === "present" || rec.status === "online");

    if (isCurrentlyPresent) {
      await dbRemove(`attendance/${key}/${stdId}`);
      toast(`${stdId} unmarked.`, "info");
    } else {
      const cardModeKey = `${key}_${stdId}`;
      const chosenMode = state.attCardModes[cardModeKey] || "offline";
      const nextStatus = chosenMode === "online" ? "online" : "present";
      await saveAttendanceStatus(stdId, dateStr, batchId, nextStatus);
      toast(`Marked ${stdId} as ${nextStatus === "online" ? "Online" : "Present"}.`, "success");
    }
    return;
  }

  const pillBtn = e.target.closest(".mode-pill-btn");
  if (pillBtn) {
    e.stopPropagation();
    const stdId = pillBtn.dataset.id;
    const mode = pillBtn.dataset.mode;
    const cardModeKey = `${key}_${stdId}`;
    state.attCardModes[cardModeKey] = mode;

    const rec = attMap[stdId] || null;
    const isCurrentlyPresent = rec && (rec.status === "present" || rec.status === "online");
    if (isCurrentlyPresent) {
      const nextStatus = mode === "online" ? "online" : "present";
      await saveAttendanceStatus(stdId, dateStr, batchId, nextStatus);
      toast(`${stdId} set to ${nextStatus === "online" ? "Online" : "Present"}.`, "success");
    } else {
      renderAttendance();
    }
    return;
  }

  const card = e.target.closest(".att-p-card");
  if (card && card.dataset.std) {
    const stu = state.students.find((s) => s.id === card.dataset.std);
    if (!stu) return;
    openAttendanceDetailPopup({
      student: stu,
      batchName: getBatchName(batchId),
      dateStr,
      record: attMap[stu.id] || null,
      canOverride: true,
      onOverride: async (newStatus) => {
        await saveAttendanceStatus(stu.id, dateStr, batchId, newStatus);
        toast(`Marked ${stu.id} as ${newStatus}.`, "success");
      }
    });
  }
});

document.getElementById("print-center-qr-btn").addEventListener("click", launchCenterQRPrint);

setInterval(() => {
  const attPanel = document.getElementById("panel-attendance");
  if (attPanel.classList.contains("active")) {
    runAutoAbsentCheck();
  }
}, 60000);

// ============================================================================
// 4. LEAVE APPROVALS (COMPACT BOXES + POPUP)
// ============================================================================
function renderLeaves() {
  const sorted = [...state.leaves].sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));
  const pendingCount = sorted.filter((l) => l.status === "pending").length;
  document.getElementById("pending-leaves-badge").textContent = `${pendingCount} Pending`;

  const container = document.getElementById("rec-leaves-list");
  container.innerHTML = sorted.length
    ? sorted
        .map((l) => {
          const b = getBatch(l.batchId);
          const badgeCls = l.status === "approved" ? "badge-success" : l.status === "rejected" ? "badge-danger" : "badge-gold";
          return `
          <div class="list-box rec-leave-box" data-id="${escapeHtml(l.id)}">
            <div class="list-box-main">
              <div class="list-box-title">${escapeHtml(l.studentName)} (<span class="mono">${escapeHtml(l.studentId)}</span>)</div>
              <div class="list-box-sub">
                <span>${escapeHtml(b ? b.name : "--")}</span>
                <span>• ${escapeHtml(l.fromDate)} → ${escapeHtml(l.toDate)}</span>
              </div>
            </div>
            <div class="list-box-actions">
              <span class="badge ${badgeCls}" style="text-transform:capitalize;">${escapeHtml(l.status || "pending")}</span>
            </div>
          </div>
        `;
        })
        .join("")
    : `<p class="text-muted" style="margin:0;">No leave applications yet.</p>`;
}

document.getElementById("rec-leaves-list").addEventListener("click", (e) => {
  const box = e.target.closest(".rec-leave-box");
  if (!box) return;
  const leave = state.leaves.find((l) => l.id === box.dataset.id);
  if (!leave) return;

  openLeaveDetailPopup(leave, {
    batchName: getBatchName(leave.batchId),
    canReview: true,
    onApprove: async (l) => {
      await dbUpdate(`leaves/${l.id}`, {
        status: "approved",
        reviewedBy: session.id,
        reviewedAt: Date.now()
      });
      toast("Leave marked as approved.", "success");
    },
    onReject: async (l) => {
      await dbUpdate(`leaves/${l.id}`, {
        status: "rejected",
        reviewedBy: session.id,
        reviewedAt: Date.now()
      });
      toast("Leave marked as rejected.", "info");
    }
  });
});

// ============================================================================
// 5. TODAY'S TIMING OVERRIDE + STUDENT NOTIFICATIONS
// ============================================================================
document.getElementById("timing-override-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const batchId = document.getElementById("ov-batch").value;
  const startTime = document.getElementById("ov-start").value;
  const endTime = document.getElementById("ov-end").value;
  const batch = getBatch(batchId);
  if (!batch || !startTime || !endTime) return;

  const dateStr = today();
  const newTiming = `${format24To12(startTime)} - ${format24To12(endTime)}`;

  try {
    await dbPush(`timingOverrides/${dateStr}_${batchId}`, {
      batchId,
      date: dateStr,
      oldTiming: batch.timing || "",
      newTiming,
      startTime,
      endTime,
      overriddenBy: `${session.name} (${session.id})`,
      overriddenAt: Date.now()
    });

    const batchStudents = state.students.filter((s) => s.active !== false && s.batchId === batchId);
    const notifPromises = batchStudents.map((stu) =>
      dbPush(`notifications/${stu.id}`, {
        message: `Today's timing (${dateStr}) for ${batch.name} has been updated to ${newTiming}.`,
        createdAt: Date.now(),
        read: false
      })
    );
    await Promise.all(notifPromises);

    document.getElementById("ov-start").value = "";
    document.getElementById("ov-end").value = "";
    toast(`Timing updated & ${batchStudents.length} student(s) notified.`, "success");
  } catch (err) {
    console.error(err);
    toast("Failed to update timing.", "error");
  }
});

function renderTodayOverrides() {
  const todayStr = today();
  const list = [];
  Object.entries(state.timingOverrides || {}).forEach(([key, entries]) => {
    if (!key.startsWith(todayStr + "_")) return;
    objectToList(entries).forEach((item) => list.push(item));
  });
  list.sort((a, b) => (b.overriddenAt || 0) - (a.overriddenAt || 0));

  const tbody = document.getElementById("today-overrides-body");
  tbody.innerHTML = list.length
    ? list
        .map((o) => {
          const b = getBatch(o.batchId);
          return `
          <tr>
            <td data-label="Batch"><strong>${escapeHtml(b ? b.name : o.batchId)}</strong></td>
            <td data-label="New Timing"><span class="badge badge-gold">${escapeHtml(o.newTiming)}</span></td>
            <td data-label="Updated By">${escapeHtml(o.overriddenBy || "--")}</td>
            <td data-label="Time Logged">${o.overriddenAt ? escapeHtml(new Date(o.overriddenAt).toLocaleTimeString("en-IN")) : "--"}</td>
          </tr>
        `;
        })
        .join("")
    : `<tr><td colspan="4" class="empty-cell text-muted">No timing overrides recorded today.</td></tr>`;
}

// ============================================================================
// 6. EXPENSES (COMPACT BOXES + POPUP)
// ============================================================================
document.getElementById("rec-expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = Number(document.getElementById("rec-exp-amount").value);
  const category = document.getElementById("rec-exp-category").value;
  const date = document.getElementById("rec-exp-date").value;
  if (!amount || amount <= 0 || !date) return;

  try {
    await dbPush("expenses", {
      amount,
      category,
      date,
      addedBy: `${session.name} (${session.id})`,
      addedAt: Date.now()
    });
    document.getElementById("rec-exp-amount").value = "";
    toast("Expense added.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to add expense.", "error");
  }
});

function renderExpenses() {
  const sorted = [...state.expenses].sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 30);
  document.getElementById("rec-expenses-list").innerHTML = sorted.length
    ? sorted
        .map(
          (e) => `
        <div class="list-box rec-expense-box" data-id="${escapeHtml(e.id)}">
          <div class="list-box-main">
            <div class="list-box-title">${formatINR(e.amount)} · <span style="text-transform:capitalize;">${escapeHtml(e.category || "other")}</span></div>
            <div class="list-box-sub">
              <span class="mono">${escapeHtml(e.date || "--")}</span>
              <span>• ${escapeHtml(e.addedBy || "--")}</span>
            </div>
          </div>
          <div class="list-box-actions">
            <span class="badge badge-danger">${formatINR(e.amount)}</span>
          </div>
        </div>
      `
        )
        .join("")
    : `<p class="text-muted" style="margin:0;">No expenses recorded yet.</p>`;
}

document.getElementById("rec-expenses-list").addEventListener("click", (e) => {
  const box = e.target.closest(".rec-expense-box");
  if (!box) return;
  const exp = state.expenses.find((x) => x.id === box.dataset.id);
  if (exp) openExpenseDetailPopup(exp, { canDelete: false });
});

// ============================================================================
// REALTIME WATCHERS
// ============================================================================
renderMonthPicker();

dbWatch("sessions", (val) => {
  state.sessions = objectToList(val).sort((a, b) => String(b.name || "").localeCompare(String(a.name || "")));
  populateAllSessionDropdowns();
  renderStudentsList();
});
dbWatch("batches", (val) => {
  state.batches = objectToList(val);
  populateAllSessionDropdowns();
  renderStudentsList();
  renderSelectedFeeStudentCard();
  renderPaidFeesList();
  renderAttendance();
  renderTodayOverrides();
  renderLeaves();
});
dbWatch("students", (val) => {
  state.students = objectToList(val).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  renderStudentsList();
  renderFeeSuggestions();
  renderSelectedFeeStudentCard();
  renderAttendance();
});
dbWatch("fees", (val) => {
  state.fees = objectToList(val);
  renderSelectedFeeStudentCard();
  renderPaidFeesList();
});
dbWatch("expenses", (val) => {
  state.expenses = objectToList(val);
  renderExpenses();
});
dbWatch("attendance", (val) => {
  state.attendance = val || {};
  renderAttendance();
});
dbWatch("timingOverrides", (val) => {
  state.timingOverrides = val || {};
  renderAttendance();
  renderTodayOverrides();
});
dbWatch("leaves", (val) => {
  state.leaves = objectToList(val);
  renderLeaves();
});
dbWatch("config/centerQR", (val) => {
  state.centerQR = val || null;
  renderCenterQRStatus();
});
