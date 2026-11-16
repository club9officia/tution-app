// js/admin.js
import {
  CONFIG,
  guard,
  initDashboardShell,
  dbGet,
  dbSet,
  dbPush,
  dbUpdate,
  dbRemove,
  dbWatch,
  objectToList,
  today,
  monthKey,
  formatINR,
  format24To12,
  escapeHtml,
  openWhatsApp,
  sanitizeEmailKey,
  clearSession,
  toast,
  ensureCenterQR,
  markCenterQRPrinted,
  generateHexToken,
  openExternalUrl,
  logout,
  openPopup,
  openStudentDetailPopup,
  openExpenseDetailPopup,
  getDefaulters,
  buildFeeReminderMessage
} from "./app.js";
import { auth, signOut } from "./firebase-config.js";

const session = guard("admin");
if (!session) throw new Error("Unauthorized");

const panelTitles = {
  overview: "Overview",
  "sessions-batches": "Sessions & Batches",
  defaulters: "Fee Defaulters",
  staff: "Staff Management",
  expenses: "Expenses",
  reports: "Revenue Report",
  "timing-logs": "Timing Logs",
  "transfer-admin": "Transfer Admin"
};

const { activatePanel } = initDashboardShell((target) => {
  document.getElementById("topbar-title").textContent = panelTitles[target] || "Admin";
  if (target === "defaulters") {
    renderAdminDefaultersList();
  }
});
document.getElementById("admin-email-badge").textContent = session.email || session.name || "Admin";

// ============================================================================
// STATE
// ============================================================================
const state = {
  sessions: [],
  batches: [],
  students: [],
  staff: [],
  fees: [],
  expenses: [],
  timingOverrides: {},
  adminInvites: {},
  centerQR: null
};

document.getElementById("exp-date").value = today();
document.getElementById("report-month-input").value = monthKey();

// Ensure single center-wide permanent QR exists (only generates once if missing)
ensureCenterQR().catch((err) => console.error("Center QR init error:", err));

// ============================================================================
// RENDER HELPERS
// ============================================================================
function getBatchName(batchId) {
  const b = state.batches.find((x) => x.id === batchId);
  return b ? b.name : "--";
}

function getSessionName(sessionId) {
  const s = state.sessions.find((x) => x.id === sessionId);
  return s ? s.name : "--";
}

function renderOverview() {
  const currentMonth = monthKey();
  const monthFees = state.fees
    .filter((f) => f.month === currentMonth)
    .reduce((sum, f) => sum + (Number(f.amount) || 0), 0);
  const monthExpenses = state.expenses
    .filter((e) => (e.date || "").slice(0, 7) === currentMonth)
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const activeStudents = state.students.filter((s) => s.active !== false);

  const defaulters = getDefaulters(state.students, state.fees, state.batches);
  const totalPendingFees = defaulters.reduce((sum, d) => sum + d.amount, 0);

  document.getElementById("admin-stats-grid").innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Sessions / Batches</div>
      <div class="stat-value">${state.sessions.length} / ${state.batches.length}</div>
      <div class="stat-sub">Active academic structure</div>
    </div>
    <div class="stat-card gold">
      <div class="stat-label">Active Students</div>
      <div class="stat-value">${activeStudents.length}</div>
      <div class="stat-sub">${state.staff.length} Staff members</div>
    </div>
    <div class="stat-card success">
      <div class="stat-label">This Month Fees</div>
      <div class="stat-value">${formatINR(monthFees)}</div>
      <div class="stat-sub">${currentMonth} collections</div>
    </div>
    <div class="stat-card danger" style="cursor: pointer;" title="Click to view fee defaulters">
      <div class="stat-label">Fee Defaulters</div>
      <div class="stat-value">${defaulters.length} Unpaid</div>
      <div class="stat-sub">${formatINR(totalPendingFees)} pending</div>
    </div>
  `;

  const adminStatsGrid = document.getElementById("admin-stats-grid");
  if (adminStatsGrid && !adminStatsGrid.dataset.bound) {
    adminStatsGrid.dataset.bound = "true";
    adminStatsGrid.addEventListener("click", (e) => {
      const card = e.target.closest(".stat-card.danger");
      if (card) {
        activatePanel("defaulters");
      }
    });
  }

  document.getElementById("total-students-badge").textContent = `${activeStudents.length} Active`;
  renderAdminDefaultersList();
  const recent = [...activeStudents]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 10);

  document.getElementById("recent-students-list").innerHTML = recent.length
    ? recent.map((s) => `
        <div class="list-box admin-stu-box" data-id="${escapeHtml(s.id)}">
          <div class="list-box-main">
            <div class="list-box-title"><span class="mono">${escapeHtml(s.id)}</span> · ${escapeHtml(s.name)}</div>
            <div class="list-box-sub">
              <span>${escapeHtml(getBatchName(s.batchId))}</span>
              <span>• ${escapeHtml(s.parentalPhone || s.fatherPhone || s.personalPhone || "--")}</span>
            </div>
          </div>
          <div class="list-box-actions">
            <span class="badge ${s.mode === "online" ? "badge-primary" : "badge-muted"}">${s.mode === "online" ? "Online" : "Offline"}</span>
          </div>
        </div>
      `).join("")
    : `<p class="text-muted" style="margin:0;">No students enrolled yet.</p>`;
}

function renderSessionAndTeacherSelects() {
  const sessionSelect = document.getElementById("batch-session");
  const currentSessVal = sessionSelect.value;
  sessionSelect.innerHTML = state.sessions.length
    ? state.sessions.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("")
    : `<option value="">Create a session first</option>`;
  if (currentSessVal && state.sessions.some((s) => s.id === currentSessVal)) {
    sessionSelect.value = currentSessVal;
  }

  const teacherSelect = document.getElementById("batch-teacher");
  const currentTchVal = teacherSelect.value;
  const teachers = state.staff.filter((st) => st.occupation === "teacher");
  teacherSelect.innerHTML = `<option value="">-- Optional: Select Teacher --</option>` +
    teachers.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${escapeHtml(t.id)})</option>`).join("");
  if (currentTchVal) teacherSelect.value = currentTchVal;
}

function renderSessionsAndBatches() {
  renderSessionAndTeacherSelects();
  const container = document.getElementById("sessions-batches-list");
  if (!state.sessions.length) {
    container.innerHTML = `<p class="text-muted">No academic sessions created yet. Create your first session above (e.g. 2026-27).</p>`;
    return;
  }

  container.innerHTML = state.sessions.map((sess) => {
    const sessBatches = state.batches.filter((b) => b.sessionId === sess.id);
    return `
      <div style="border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 14px; background: #F8FAFC;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px;">
          <div>
            <strong style="font-size: 1.02rem; color: var(--primary);">Session: ${escapeHtml(sess.name)}</strong>
            <span class="badge badge-gold" style="margin-left: 8px;">${sessBatches.length} Batch(es)</span>
          </div>
          <button type="button" class="btn btn-danger btn-sm btn-inline delete-session-btn" data-id="${escapeHtml(sess.id)}">Delete Session</button>
        </div>
        ${
          sessBatches.length
            ? `<div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Batch Name</th>
                      <th>Timing</th>
                      <th>Monthly Fee</th>
                      <th>Full Course</th>
                      <th>Teacher</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${sessBatches.map((b) => `
                      <tr>
                        <td data-label="Batch Name"><strong>${escapeHtml(b.name)}</strong></td>
                        <td data-label="Timing">${escapeHtml(b.timing || "--")}</td>
                        <td data-label="Monthly Fee">${formatINR(b.monthlyFees)}</td>
                        <td data-label="Full Course">${formatINR(b.completeCourseFees)}</td>
                        <td data-label="Teacher">${escapeHtml(b.teacherName || "--")}</td>
                        <td data-label="Actions" class="actions-cell">
                          <button type="button" class="btn btn-outline btn-sm edit-batch-btn" data-id="${escapeHtml(b.id)}">Edit</button>
                          <button type="button" class="btn btn-danger btn-sm delete-batch-btn" data-id="${escapeHtml(b.id)}">Delete</button>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>`
            : `<p class="text-muted" style="margin: 0; font-size: 0.88rem;">No batches inside this session yet.</p>`
        }
      </div>
    `;
  }).join("");
}

function renderStaff() {
  const container = document.getElementById("staff-list");
  if (!state.staff.length) {
    container.innerHTML = `<p class="text-muted" style="margin:0;">No staff accounts created yet.</p>`;
    return;
  }

  container.innerHTML = state.staff.map((st) => `
    <div class="list-box admin-staff-box" data-id="${escapeHtml(st.id)}">
      <div class="list-box-main">
        <div class="list-box-title"><span class="mono">${escapeHtml(st.id)}</span> · ${escapeHtml(st.name)}</div>
        <div class="list-box-sub">
          <span class="badge ${st.occupation === "teacher" ? "badge-primary" : "badge-gold"}" style="text-transform: capitalize;">
            ${escapeHtml(st.occupation)}
          </span>
          <span>${formatINR(st.monthlySalary)}/mo</span>
        </div>
      </div>
      <div class="list-box-actions">
        <button type="button" class="btn btn-outline btn-sm btn-inline edit-staff-btn" data-id="${escapeHtml(st.id)}">Edit</button>
      </div>
    </div>
  `).join("");
}

function renderExpenses() {
  const sorted = [...state.expenses].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const total = sorted.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  document.getElementById("admin-expenses-total").textContent = formatINR(total);

  const container = document.getElementById("admin-expenses-list");
  container.innerHTML = sorted.length
    ? sorted.map((e) => `
        <div class="list-box admin-expense-box" data-id="${escapeHtml(e.id)}">
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
      `).join("")
    : `<p class="text-muted" style="margin:0;">No expenses recorded yet.</p>`;
}

function renderReportPreview() {
  const ym = document.getElementById("report-month-input").value || monthKey();
  const fees = state.fees.filter((f) => f.month === ym);
  const exps = state.expenses.filter((e) => (e.date || "").slice(0, 7) === ym);
  const totalFees = fees.reduce((s, f) => s + (Number(f.amount) || 0), 0);
  const totalExps = exps.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const net = totalFees - totalExps;

  document.getElementById("report-preview-stats").innerHTML = `
    <div class="stat-card success">
      <div class="stat-label">Fees Collected (${escapeHtml(ym)})</div>
      <div class="stat-value">${formatINR(totalFees)}</div>
      <div class="stat-sub">${fees.length} payment(s)</div>
    </div>
    <div class="stat-card danger">
      <div class="stat-label">Expenses (${escapeHtml(ym)})</div>
      <div class="stat-value">${formatINR(totalExps)}</div>
      <div class="stat-sub">${exps.length} entry(s)</div>
    </div>
    <div class="stat-card gold">
      <div class="stat-label">Net Surplus</div>
      <div class="stat-value">${formatINR(net)}</div>
      <div class="stat-sub">Ready for printable PDF</div>
    </div>
  `;
}

function renderTimingLogs() {
  const logs = [];
  Object.entries(state.timingOverrides || {}).forEach(([dateBatchKey, entries]) => {
    if (!entries || typeof entries !== "object") return;
    Object.entries(entries).forEach(([id, entry]) => {
      logs.push({ id, dateBatchKey, ...entry });
    });
  });
  logs.sort((a, b) => (b.overriddenAt || 0) - (a.overriddenAt || 0));

  const tbody = document.getElementById("timing-logs-body");
  tbody.innerHTML = logs.length
    ? logs.map((l) => `
        <tr>
          <td data-label="Date">${escapeHtml(l.date || l.dateBatchKey.split("_")[0] || "--")}</td>
          <td data-label="Batch"><strong>${escapeHtml(getBatchName(l.batchId))}</strong></td>
          <td data-label="New Timing"><span class="badge badge-gold">${escapeHtml(l.newTiming || "--")}</span></td>
          <td data-label="Overridden By">${escapeHtml(l.overriddenBy || "--")}</td>
          <td data-label="Logged At">${l.overriddenAt ? escapeHtml(new Date(l.overriddenAt).toLocaleString("en-IN")) : "--"}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="5" class="empty-cell text-muted">No timing overrides have been logged yet.</td></tr>`;
}

function renderPendingInvites() {
  const box = document.getElementById("pending-invite-box");
  const invites = objectToList(state.adminInvites);
  if (!invites.length) {
    box.classList.add("hidden");
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = invites.map((inv) => `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
      <span>Pending Admin transfer to <strong>${escapeHtml(inv.email)}</strong> (activates on their next Email/Password Admin sign-in).</span>
      <button type="button" class="btn btn-outline btn-sm btn-inline cancel-invite-btn" data-id="${escapeHtml(inv.id)}">Cancel</button>
    </div>
  `).join("");
}

function renderAll() {
  renderOverview();
  renderSessionsAndBatches();
  renderStaff();
  renderExpenses();
  renderReportPreview();
  renderTimingLogs();
  renderPendingInvites();
}

// ============================================================================
// REALTIME DATABASE WATCHERS
// ============================================================================
dbWatch("sessions", (val) => {
  state.sessions = objectToList(val).sort((a, b) => String(b.name || "").localeCompare(String(a.name || "")));
  renderAll();
});
dbWatch("batches", (val) => {
  state.batches = objectToList(val);
  renderAll();
});
dbWatch("students", (val) => {
  state.students = objectToList(val);
  renderOverview();
});
dbWatch("staff", (val) => {
  state.staff = objectToList(val).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  renderAll();
});
dbWatch("fees", (val) => {
  state.fees = objectToList(val);
  renderOverview();
  renderReportPreview();
});
dbWatch("expenses", (val) => {
  state.expenses = objectToList(val);
  renderAll();
});
dbWatch("timingOverrides", (val) => {
  state.timingOverrides = val || {};
  renderTimingLogs();
});
dbWatch("adminInvites", (val) => {
  state.adminInvites = val || {};
  renderPendingInvites();
});
dbWatch("config/centerQR", (val) => {
  state.centerQR = val || null;
  const label = document.getElementById("admin-qr-last-printed");
  if (!label) return;
  if (!val || !val.token) {
    label.textContent = "Center QR: Not initialized";
  } else if (val.printedAt) {
    label.textContent = `Center QR was last printed on ${new Date(val.printedAt).toLocaleString("en-IN")}`;
  } else {
    label.textContent = "Center QR initialized (Not printed yet)";
  }
});

// ============================================================================
// CENTER-WIDE PERMANENT QR CONTROLS (PRINT & ADMIN-ONLY REGENERATE)
// ============================================================================
async function handlePrintCenterQR() {
  try {
    await markCenterQRPrinted();
    openExternalUrl(new URL("qr-print.html", window.location.href).toString());
  } catch (err) {
    console.error(err);
    toast("Failed to prepare Center QR print page.", "error");
  }
}

document.getElementById("admin-print-center-qr-btn").addEventListener("click", handlePrintCenterQR);
document.getElementById("admin-menu-print-qr-btn").addEventListener("click", () => {
  closeAdminMenus();
  handlePrintCenterQR();
});

const adminQrOverflowBtn = document.getElementById("admin-qr-overflow-btn");
const adminQrOverflowMenu = document.getElementById("admin-qr-overflow-menu");
const adminTopbarMoreBtn = document.getElementById("admin-topbar-more-btn");
const adminTopbarMoreMenu = document.getElementById("admin-topbar-more-menu");

function closeAdminMenus() {
  adminQrOverflowMenu.classList.remove("open");
  adminQrOverflowBtn.setAttribute("aria-expanded", "false");
  adminTopbarMoreMenu.classList.remove("open");
  adminTopbarMoreBtn.setAttribute("aria-expanded", "false");
}

adminQrOverflowBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const wasOpen = adminQrOverflowMenu.classList.contains("open");
  closeAdminMenus();
  if (!wasOpen) {
    adminQrOverflowMenu.classList.add("open");
    adminQrOverflowBtn.setAttribute("aria-expanded", "true");
  }
});

adminTopbarMoreBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const wasOpen = adminTopbarMoreMenu.classList.contains("open");
  closeAdminMenus();
  if (!wasOpen) {
    adminTopbarMoreMenu.classList.add("open");
    adminTopbarMoreBtn.setAttribute("aria-expanded", "true");
  }
});

document.addEventListener("click", (e) => {
  if (!e.target.closest(".overflow-menu-wrap")) {
    closeAdminMenus();
  }
});

adminTopbarMoreMenu.querySelectorAll(".admin-more-nav").forEach((btn) => {
  btn.addEventListener("click", () => {
    closeAdminMenus();
    activatePanel(btn.dataset.panel);
  });
});

document.getElementById("admin-topbar-print-qr-btn").addEventListener("click", () => {
  closeAdminMenus();
  handlePrintCenterQR();
});

document.getElementById("admin-topbar-regen-qr-btn").addEventListener("click", () => {
  closeAdminMenus();
  document.getElementById("confirm-regen-center-qr-modal").classList.add("open");
});

document.getElementById("admin-topbar-logout-btn").addEventListener("click", () => {
  closeAdminMenus();
  logout();
});

document.getElementById("open-regen-center-qr-btn").addEventListener("click", () => {
  closeAdminMenus();
  document.getElementById("confirm-regen-center-qr-modal").classList.add("open");
});

["cancel-regen-center-qr-btn", "cancel-regen-center-qr-btn-2"].forEach((id) => {
  document.getElementById(id).addEventListener("click", () => {
    document.getElementById("confirm-regen-center-qr-modal").classList.remove("open");
  });
});

document.getElementById("confirm-regen-center-qr-btn").addEventListener("click", async () => {
  try {
    await dbSet("config/centerQR", {
      token: generateHexToken(32),
      createdAt: Date.now(),
      printedAt: null
    });
    document.getElementById("confirm-regen-center-qr-modal").classList.remove("open");
    toast("New center QR generated. Please print and paste the new QR.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to regenerate center QR.", "error");
  }
});

// ============================================================================
// SESSIONS & BATCHES HANDLERS
// ============================================================================
document.getElementById("create-session-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("session-name").value.trim();
  if (!name) return;
  try {
    await dbPush("sessions", { name, createdAt: Date.now() });
    document.getElementById("session-name").value = "";
    toast(`Session "${name}" created.`, "success");
  } catch (err) {
    console.error(err);
    toast("Failed to create session.", "error");
  }
});

function resetBatchForm() {
  document.getElementById("batch-edit-id").value = "";
  document.getElementById("batch-form").reset();
  document.getElementById("batch-form-title").textContent = "Create Batch";
  document.getElementById("batch-submit-btn").textContent = "Create Batch";
  document.getElementById("cancel-batch-edit").classList.add("hidden");
  renderSessionAndTeacherSelects();
}

document.getElementById("cancel-batch-edit").addEventListener("click", resetBatchForm);

document.getElementById("batch-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const editId = document.getElementById("batch-edit-id").value;
  const sessionId = document.getElementById("batch-session").value;
  const name = document.getElementById("batch-name").value.trim();
  const startTime = document.getElementById("batch-start").value;
  const endTime = document.getElementById("batch-end").value;
  const monthlyFees = Number(document.getElementById("batch-monthly").value);
  const completeCourseFees = Number(document.getElementById("batch-complete").value);
  const teacherId = document.getElementById("batch-teacher").value;

  if (!sessionId) {
    toast("Please create/select a session first.", "error");
    return;
  }

  const teacher = state.staff.find((t) => t.id === teacherId);
  const timing = `${format24To12(startTime)} - ${format24To12(endTime)}`;
  const payload = {
    sessionId,
    name,
    startTime,
    endTime,
    timing,
    monthlyFees,
    completeCourseFees,
    teacherId: teacher ? teacher.id : "",
    teacherName: teacher ? teacher.name : "",
    teacherPhone: teacher ? (teacher.phone || "") : ""
  };

  try {
    if (editId) {
      await dbUpdate(`batches/${editId}`, payload);
      toast("Batch updated.", "success");
    } else {
      await dbPush("batches", { ...payload, createdAt: Date.now() });
      toast("Batch created.", "success");
    }
    resetBatchForm();
  } catch (err) {
    console.error(err);
    toast("Failed to save batch.", "error");
  }
});

document.getElementById("sessions-batches-list").addEventListener("click", async (e) => {
  const delSessBtn = e.target.closest(".delete-session-btn");
  if (delSessBtn) {
    const id = delSessBtn.dataset.id;
    const hasBatches = state.batches.some((b) => b.sessionId === id);
    if (hasBatches) {
      toast("Delete all batches in this session first.", "error");
      return;
    }
    await dbRemove(`sessions/${id}`);
    toast("Session deleted.", "info");
    return;
  }

  const editBatchBtn = e.target.closest(".edit-batch-btn");
  if (editBatchBtn) {
    const batch = state.batches.find((b) => b.id === editBatchBtn.dataset.id);
    if (!batch) return;
    document.getElementById("batch-edit-id").value = batch.id;
    document.getElementById("batch-session").value = batch.sessionId;
    document.getElementById("batch-name").value = batch.name || "";
    document.getElementById("batch-start").value = batch.startTime || "16:00";
    document.getElementById("batch-end").value = batch.endTime || "17:30";
    document.getElementById("batch-monthly").value = batch.monthlyFees || 0;
    document.getElementById("batch-complete").value = batch.completeCourseFees || 0;
    document.getElementById("batch-teacher").value = batch.teacherId || "";
    document.getElementById("batch-form-title").textContent = "Edit Batch";
    document.getElementById("batch-submit-btn").textContent = "Update Batch";
    document.getElementById("cancel-batch-edit").classList.remove("hidden");
    document.getElementById("batch-form").scrollIntoView({ behavior: "smooth" });
    return;
  }

  const delBatchBtn = e.target.closest(".delete-batch-btn");
  if (delBatchBtn) {
    await dbRemove(`batches/${delBatchBtn.dataset.id}`);
    toast("Batch deleted.", "info");
  }
});

// ============================================================================
// STAFF MANAGEMENT HANDLERS (PLAIN TEXT PASSWORD STORAGE)
// ============================================================================
function nextStaffId(occupation) {
  const prefix = occupation === "teacher" ? "TCH" : "REC";
  let maxNum = 0;
  state.staff.forEach((st) => {
    if (String(st.id).startsWith(prefix)) {
      const n = parseInt(String(st.id).slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  return prefix + String(maxNum + 1).padStart(2, "0");
}

function showStaffCreds(id, name, password, phone) {
  const banner = document.getElementById("staff-cred-banner");
  banner.classList.remove("hidden");
  banner.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
      <div>
        <strong>Credentials for ${escapeHtml(name)}:</strong>
        ID: <span class="mono"><strong>${escapeHtml(id)}</strong></span> |
        Password: <span class="mono"><strong>${escapeHtml(password)}</strong></span>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn-outline btn-sm btn-inline" id="copy-staff-cred-btn">Copy</button>
        <button type="button" class="btn btn-wa btn-sm btn-inline" id="wa-staff-cred-btn">Send on WhatsApp</button>
      </div>
    </div>
  `;

  const msg = `Hello ${name}, your ${CONFIG.tuitionName} portal login is ready.\nUser ID: ${id}\nPassword: ${password}\nLogin at: ${window.location.origin}/index.html`;
  document.getElementById("copy-staff-cred-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(msg);
    toast("Credentials copied.", "success");
  });
  document.getElementById("wa-staff-cred-btn").addEventListener("click", () => {
    openWhatsApp(phone || CONFIG.whatsapp, msg);
  });
}

function resetStaffForm() {
  document.getElementById("staff-edit-id").value = "";
  document.getElementById("staff-form").reset();
  document.getElementById("staff-password-wrap").classList.remove("hidden");
  document.getElementById("staff-password").required = true;
  document.getElementById("staff-occupation").disabled = false;
  document.getElementById("staff-form-title").textContent = "Create Staff Account";
  document.getElementById("staff-submit-btn").textContent = "Create Staff Account";
  document.getElementById("cancel-staff-edit").classList.add("hidden");
}

document.getElementById("cancel-staff-edit").addEventListener("click", resetStaffForm);

document.getElementById("staff-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const editId = document.getElementById("staff-edit-id").value;
  const name = document.getElementById("staff-name").value.trim();
  const occupation = document.getElementById("staff-occupation").value;
  const phone = document.getElementById("staff-phone").value.trim();
  const monthlySalary = Number(document.getElementById("staff-salary").value);
  const password = document.getElementById("staff-password").value;

  try {
    if (editId) {
      await dbUpdate(`staff/${editId}`, { name, phone, monthlySalary });
      toast(`Updated ${editId}.`, "success");
      resetStaffForm();
      return;
    }

    const id = nextStaffId(occupation);
    await dbSet(`staff/${id}`, {
      id,
      name,
      occupation,
      phone,
      monthlySalary,
      password,
      createdAt: Date.now()
    });
    showStaffCreds(id, name, password, phone);
    toast(`Created staff account ${id}.`, "success");
    resetStaffForm();
  } catch (err) {
    console.error(err);
    toast("Failed to save staff account.", "error");
  }
});

function startEditStaff(st) {
  if (!st) return;
  document.getElementById("staff-edit-id").value = st.id;
  document.getElementById("staff-name").value = st.name || "";
  document.getElementById("staff-occupation").value = st.occupation || "teacher";
  document.getElementById("staff-occupation").disabled = true;
  document.getElementById("staff-phone").value = st.phone || "";
  document.getElementById("staff-salary").value = st.monthlySalary || 0;
  document.getElementById("staff-password-wrap").classList.add("hidden");
  document.getElementById("staff-password").required = false;
  document.getElementById("staff-form-title").textContent = `Edit Staff (${st.id})`;
  document.getElementById("staff-submit-btn").textContent = "Update Staff";
  document.getElementById("cancel-staff-edit").classList.remove("hidden");
  document.getElementById("staff-form").scrollIntoView({ behavior: "smooth" });
}

function openStaffDetailPopup(st) {
  if (!st) return;
  const digits = String(st.phone || "").replace(/\D/g, "");
  const { body, close } = openPopup(
    `${st.name} (${st.id})`,
    `
    <div class="popup-mini-list">
      <div class="popup-mini-row"><span>Staff ID</span><strong class="mono">${escapeHtml(st.id)}</strong></div>
      <div class="popup-mini-row"><span>Role</span><span class="badge ${st.occupation === "teacher" ? "badge-primary" : "badge-gold"}" style="text-transform:capitalize;">${escapeHtml(st.occupation)}</span></div>
      <div class="popup-mini-row"><span>Monthly Salary</span><strong>${escapeHtml(formatINR(st.monthlySalary))}</strong></div>
      <div class="popup-mini-row"><span>Phone</span><strong class="mono">${escapeHtml(st.phone || "--")}</strong></div>
      <div class="popup-mini-row"><span>Password</span><strong class="mono">${escapeHtml(st.password || "--")}</strong></div>
    </div>
    <div class="popup-actions-bar">
      ${digits ? `<a href="tel:${escapeHtml(digits)}" class="btn btn-outline">📞 Call</a>` : ""}
      ${st.phone ? `<button type="button" class="btn btn-wa" id="popup-staff-wa">💬 WhatsApp</button>` : ""}
    </div>
    <div class="popup-actions-bar">
      <button type="button" class="btn btn-outline" id="popup-staff-edit">✏ Edit</button>
      <button type="button" class="btn btn-gold" id="popup-staff-reset">🔑 Reset Password</button>
      <button type="button" class="btn btn-danger" id="popup-staff-del">🗑 Delete</button>
    </div>
  `
  );

  const waBtn = body.querySelector("#popup-staff-wa");
  if (waBtn) {
    waBtn.addEventListener("click", () => {
      openWhatsApp(st.phone, `Hello ${st.name}, message from ${CONFIG.tuitionName}.`);
    });
  }
  body.querySelector("#popup-staff-edit").addEventListener("click", () => {
    close();
    startEditStaff(st);
  });
  body.querySelector("#popup-staff-reset").addEventListener("click", () => {
    close();
    document.getElementById("reset-staff-id").value = st.id;
    document.getElementById("reset-staff-label").textContent = `${st.name} (${st.id})`;
    document.getElementById("reset-staff-new-pwd").value = st.password || "";
    document.getElementById("reset-pwd-modal").classList.add("open");
  });
  body.querySelector("#popup-staff-del").addEventListener("click", async () => {
    await dbRemove(`staff/${st.id}`);
    close();
    toast("Staff account deleted.", "info");
  });
}

document.getElementById("staff-list").addEventListener("click", (e) => {
  const editBtn = e.target.closest(".edit-staff-btn");
  if (editBtn) {
    e.stopPropagation();
    const st = state.staff.find((x) => x.id === editBtn.dataset.id);
    startEditStaff(st);
    return;
  }
  const box = e.target.closest(".admin-staff-box");
  if (box) {
    const st = state.staff.find((x) => x.id === box.dataset.id);
    openStaffDetailPopup(st);
  }
});

document.getElementById("recent-students-list").addEventListener("click", (e) => {
  const box = e.target.closest(".admin-stu-box");
  if (!box) return;
  const stu = state.students.find((s) => s.id === box.dataset.id);
  if (!stu) return;
  openStudentDetailPopup(stu, {
    batchName: getBatchName(stu.batchId),
    sessionName: getSessionName(stu.sessionId),
    feesList: state.fees,
    canManage: true,
    onDelete: async (target) => {
      await dbRemove(`students/${target.id}`);
      toast("Student deleted.", "info");
    }
  });
});

function renderAdminDefaultersList() {
  const defaulters = getDefaulters(state.students, state.fees, state.batches);
  const badge = document.getElementById("admin-defaulters-count-badge");
  if (badge) badge.textContent = `${defaulters.length} Defaulter${defaulters.length === 1 ? "" : "s"}`;
  const container = document.getElementById("admin-defaulters-list");
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
        <div class="list-box admin-defaulter-box" data-id="${escapeHtml(student.id)}">
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
            ${primaryPhone ? `<button type="button" class="btn btn-wa btn-sm btn-inline admin-wa-def-btn" data-id="${escapeHtml(student.id)}" data-ym="${escapeHtml(prevYm)}">💬 WhatsApp</button>` : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

const adminDefListEl = document.getElementById("admin-defaulters-list");
if (adminDefListEl) {
  adminDefListEl.addEventListener("click", (e) => {
    const waBtn = e.target.closest(".admin-wa-def-btn");
    if (waBtn) {
      e.stopPropagation();
      const stdId = waBtn.dataset.id;
      const ym = waBtn.dataset.ym;
      const stu = state.students.find((s) => s.id === stdId);
      const batchObj = state.batches.find((b) => b.id === (stu ? stu.batchId : null));
      if (stu) {
        const msg = buildFeeReminderMessage(stu, batchObj, ym);
        openWhatsApp(stu.parentalPhone || stu.fatherPhone || stu.personalPhone, msg);
      }
      return;
    }
    const box = e.target.closest(".admin-defaulter-box");
    if (!box) return;
    const stu = state.students.find((s) => s.id === box.dataset.id);
    if (!stu) return;
    openStudentDetailPopup(stu, {
      batchName: getBatchName(stu.batchId),
      sessionName: getSessionName(stu.sessionId),
      feesList: state.fees,
      canManage: false
    });
  });
}

document.getElementById("close-reset-modal").addEventListener("click", () => {
  document.getElementById("reset-pwd-modal").classList.remove("open");
});

document.getElementById("reset-staff-pwd-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("reset-staff-id").value;
  const newPwd = document.getElementById("reset-staff-new-pwd").value;
  const st = state.staff.find((x) => x.id === id);
  if (!st || !newPwd) return;

  try {
    await dbUpdate(`staff/${id}`, { password: newPwd });
    document.getElementById("reset-pwd-modal").classList.remove("open");
    showStaffCreds(id, st.name, newPwd, st.phone);
    toast(`Password updated for ${id}.`, "success");
  } catch (err) {
    console.error(err);
    toast("Failed to reset password.", "error");
  }
});

// ============================================================================
// EXPENSES HANDLERS (Strictly Amount, Category, Date — NO note)
// ============================================================================
document.getElementById("admin-expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = Number(document.getElementById("exp-amount").value);
  const category = document.getElementById("exp-category").value;
  const date = document.getElementById("exp-date").value;
  if (!amount || amount <= 0 || !date) return;

  try {
    await dbPush("expenses", {
      amount,
      category,
      date,
      addedBy: session.email || session.name || "Admin",
      addedAt: Date.now()
    });
    document.getElementById("exp-amount").value = "";
    toast("Expense recorded.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to record expense.", "error");
  }
});

document.getElementById("admin-expenses-list").addEventListener("click", (e) => {
  const box = e.target.closest(".admin-expense-box");
  if (!box) return;
  const exp = state.expenses.find((x) => x.id === box.dataset.id);
  if (!exp) return;
  openExpenseDetailPopup(exp, {
    canDelete: true,
    onDelete: async (target) => {
      await dbRemove(`expenses/${target.id}`);
      toast("Expense deleted.", "info");
    }
  });
});

// ============================================================================
// REVENUE REPORT LAUNCHER
// ============================================================================
document.getElementById("report-month-input").addEventListener("change", renderReportPreview);
document.getElementById("open-report-btn").addEventListener("click", () => {
  const ym = document.getElementById("report-month-input").value || monthKey();
  window.location.href = `report.html?month=${encodeURIComponent(ym)}`;
});

// ============================================================================
// TRANSFER ADMIN OWNERSHIP
// ============================================================================
document.getElementById("transfer-admin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const targetEmail = document.getElementById("new-admin-email").value.trim().toLowerCase();
  if (!targetEmail || !targetEmail.includes("@")) {
    toast("Enter a valid email address.", "error");
    return;
  }
  if (targetEmail === (session.email || "").toLowerCase()) {
    toast("You are already the active Admin for this email.", "error");
    return;
  }

  try {
    const [emailUsers, googleUsers] = await Promise.all([
      dbGet("emailUsers"),
      dbGet("googleUsers")
    ]);
    const combinedUsers = { ...(googleUsers || {}), ...(emailUsers || {}) };
    const matchedEntry = Object.entries(combinedUsers).find(
      ([, u]) => String(u.email || "").toLowerCase() === targetEmail
    );

    if (matchedEntry) {
      const [targetUid, userInfo] = matchedEntry;
      await dbSet(`admins/${targetUid}`, {
        email: targetEmail,
        name: userInfo.name || "Admin",
        active: true,
        expired: false,
        createdAt: Date.now()
      });
      await dbUpdate(`admins/${session.id}`, {
        active: false,
        expired: true
      });
      toast("Admin ownership transferred! Signing out...", "success");
      clearSession();
      await signOut(auth);
      window.location.href = "index.html";
      return;
    }

    const inviteKey = sanitizeEmailKey(targetEmail);
    await dbSet(`adminInvites/${inviteKey}`, {
      email: targetEmail,
      transferredBy: session.id,
      createdAt: Date.now()
    });
    document.getElementById("new-admin-email").value = "";
    toast("Transfer invite queued! New Admin activates as soon as they sign in on index.html.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to initiate Admin transfer.", "error");
  }
});

document.getElementById("pending-invite-box").addEventListener("click", async (e) => {
  const btn = e.target.closest(".cancel-invite-btn");
  if (!btn) return;
  await dbRemove(`adminInvites/${btn.dataset.id}`);
  toast("Pending transfer invite cancelled.", "info");
});
