// js/teacher.js
import {
  guard,
  initDashboardShell,
  dbGet,
  dbSet,
  dbPush,
  dbUpdate,
  dbRemove,
  dbWatch,
  objectToList,
  cleanupWeeklyContent,
  today,
  diffDaysFromToday,
  openExternalUrl,
  escapeHtml,
  toast,
  pickDefaultPhone,
  sendStudentWhatsApp,
  formatTimeHM,
  openWhatsApp,
  logout,
  openStudentDetailPopup,
  openLeaveDetailPopup,
  openAttendanceDetailPopup,
  openTestResultDetailPopup
} from "./app.js";

const session = guard("teacher");
if (!session) throw new Error("Unauthorized");

const panelTitles = {
  batches: "My Batches",
  tests: "Routine Tests",
  results: "Test Results",
  weekly: "Weekly Content",
  datesheets: "Date Sheets",
  ptms: "PTMs",
  notices: "Notices",
  leaves: "Student Leaves",
  attendance: "Attendance View",
  settings: "Settings / Password",
  more: "More Options"
};

const { activatePanel } = initDashboardShell((target) => {
  document.getElementById("topbar-title").textContent = panelTitles[target] || "Teacher";
});
document.getElementById("teacher-user-badge").textContent = `${session.name} (${session.id})`;

document.querySelectorAll(".tch-more-nav").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.panel) activatePanel(btn.dataset.panel);
  });
});
const tchMoreLogoutBtn = document.getElementById("tch-more-logout-btn");
if (tchMoreLogoutBtn) {
  tchMoreLogoutBtn.addEventListener("click", logout);
}

document.getElementById("wk-start").value = today();
document.getElementById("ptm-date").value = today();
document.getElementById("t-att-date").value = today();

const state = {
  sessions: [],
  batches: [],
  students: [],
  timingOverrides: {},
  tests: [],
  testResults: {},
  weeklyContent: [],
  dateSheets: [],
  ptms: [],
  notices: [],
  leaves: [],
  attendance: {}
};

// Clean up weekly content older than 7 days on load
cleanupWeeklyContent();

// ============================================================================
// BATCH RESOLUTION HELPERS
// ============================================================================
function getSessionName(sessionId) {
  const s = state.sessions.find((x) => x.id === sessionId);
  return s ? s.name : "--";
}

function getBatch(batchId) {
  return state.batches.find((b) => b.id === batchId) || null;
}

function getBatchName(batchId) {
  if (batchId === "all") return "All Batches";
  const b = getBatch(batchId);
  return b ? b.name : "--";
}

function getTeacherBatches() {
  const assigned = state.batches.filter((b) => b.teacherId === session.id);
  return assigned.length ? assigned : state.batches;
}

function getTeacherBatchIdSet() {
  return new Set(getTeacherBatches().map((b) => b.id));
}

function getTodayTiming(batch) {
  const key = `${today()}_${batch.id}`;
  const ovs = objectToList(state.timingOverrides[key]).sort(
    (a, b) => (b.overriddenAt || 0) - (a.overriddenAt || 0)
  );
  if (ovs.length) {
    return { timing: ovs[0].newTiming, overridden: true };
  }
  return { timing: batch.timing || "--", overridden: false };
}

function populateBatchSelectors() {
  const batches = getTeacherBatches();
  const optionsHtml = batches.length
    ? batches
        .map(
          (b) =>
            `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)} (${escapeHtml(
              getSessionName(b.sessionId)
            )})</option>`
        )
        .join("")
    : `<option value="">No batches available</option>`;

  ["test-batch", "wk-batch", "ds-batch", "ptm-batch", "t-att-batch"].forEach((id) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = optionsHtml;
    if (prev && batches.some((b) => b.id === prev)) sel.value = prev;
  });

  const testFilterSel = document.getElementById("test-filter-batch");
  if (testFilterSel) {
    const prev = testFilterSel.value;
    testFilterSel.innerHTML = `<option value="">All My Batches</option>` + optionsHtml;
    if (prev && batches.some((b) => b.id === prev)) testFilterSel.value = prev;
  }

  const noticeSel = document.getElementById("notice-batch");
  if (noticeSel) {
    const prev = noticeSel.value;
    noticeSel.innerHTML = `<option value="all">All Batches (Center-wide)</option>` + optionsHtml;
    if (prev && (prev === "all" || batches.some((b) => b.id === prev))) noticeSel.value = prev;
  }
}

// ============================================================================
// 3-DAY EXAM REMINDER BANNERS (Persisted per day in localStorage)
// ============================================================================
function getDismissedReminderKey() {
  return `jch_dismissed_reminders_${today()}`;
}

function getDismissedReminders() {
  try {
    const raw = localStorage.getItem(getDismissedReminderKey());
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function dismissReminder(key) {
  const set = getDismissedReminders();
  set.add(key);
  localStorage.setItem(getDismissedReminderKey(), JSON.stringify([...set]));
  renderExamReminders();
}

function renderExamReminders() {
  const container = document.getElementById("teacher-exam-reminders");
  const myIds = getTeacherBatchIdSet();
  const dismissed = getDismissedReminders();
  const reminders = [];

  state.dateSheets.forEach((sheet) => {
    if (!myIds.has(sheet.batchId)) return;
    const subjects = Array.isArray(sheet.subjects) ? sheet.subjects : [];
    subjects.forEach((entry, idx) => {
      if (!entry || !entry.date) return;
      if (diffDaysFromToday(entry.date) === 3) {
        const key = `${sheet.id}_${idx}`;
        if (!dismissed.has(key)) {
          reminders.push({
            key,
            batchName: getBatchName(sheet.batchId),
            schoolName: sheet.schoolName || "School",
            subject: entry.subject || "Exam",
            date: entry.date
          });
        }
      }
    });
  });

  if (!reminders.length) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = reminders
    .map(
      (r) => `
      <div class="alert alert-gold reminder-item" style="margin-bottom:0;">
        <div>
          <strong>⏰ 3-Day Exam Reminder:</strong>
          ${escapeHtml(r.batchName)} • ${escapeHtml(r.schoolName)} —
          <strong>${escapeHtml(r.subject)}</strong> exam is in 3 days (${escapeHtml(r.date)}).
        </div>
        <button type="button" class="btn btn-outline btn-sm btn-inline dismiss-reminder-btn" data-key="${escapeHtml(r.key)}">
          Dismiss
        </button>
      </div>
    `
    )
    .join("");
}

document.getElementById("teacher-exam-reminders").addEventListener("click", (e) => {
  const btn = e.target.closest(".dismiss-reminder-btn");
  if (!btn) return;
  dismissReminder(btn.dataset.key);
});

// ============================================================================
// 1. MY BATCHES + WHATSAPP GROUP HOMEWORK LINK
// ============================================================================
function openWhatsAppGroupModal(batchId) {
  const batch = getBatch(batchId);
  if (!batch) return;
  document.getElementById("wa-batch-id").value = batchId;
  document.getElementById("wa-modal-title").textContent = `WhatsApp Group: ${batch.name}`;
  document.getElementById("wa-group-url").value = batch.whatsappGroupLink || "";
  document.getElementById("wa-group-modal").classList.add("open");
}

document.getElementById("close-wa-modal").addEventListener("click", () => {
  document.getElementById("wa-group-modal").classList.remove("open");
});

document.getElementById("wa-group-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const batchId = document.getElementById("wa-batch-id").value;
  const link = document.getElementById("wa-group-url").value.trim();
  if (!batchId || !link) return;

  try {
    new URL(link);
  } catch {
    toast("Please enter a valid https:// WhatsApp group URL.", "error");
    return;
  }

  try {
    await dbUpdate(`batches/${batchId}`, { whatsappGroupLink: link });
    document.getElementById("wa-group-modal").classList.remove("open");
    toast("Batch WhatsApp group link saved.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to save group link.", "error");
  }
});

function renderBatches() {
  const container = document.getElementById("teacher-batches-list");
  const assigned = state.batches.filter((b) => b.teacherId === session.id);
  const batchesToShow = getTeacherBatches();

  document.getElementById("teacher-batch-count").textContent = `${batchesToShow.length} Batch(es)`;

  if (!batchesToShow.length) {
    container.innerHTML = `<p class="text-muted">No batches have been created yet.</p>`;
    return;
  }

  const noticeHtml =
    !assigned.length && state.batches.length
      ? `<div class="alert alert-info">No specific batches are assigned to your Teacher ID yet — showing all center batches.</div>`
      : "";

  container.innerHTML =
    noticeHtml +
    batchesToShow
      .map((batch) => {
        const { timing, overridden } = getTodayTiming(batch);
        const roster = state.students.filter((s) => s.active !== false && s.batchId === batch.id);
        const hasWaLink = Boolean(batch.whatsappGroupLink);
        return `
      <div style="border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 16px; background: #F8FAFC;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom: 12px;">
          <div>
            <span class="badge badge-primary">${escapeHtml(getSessionName(batch.sessionId))}</span>
            <h3 style="margin: 6px 0 2px; color: var(--primary);">${escapeHtml(batch.name)}</h3>
            <div class="text-muted" style="font-size:0.88rem;">
              Default Timing: ${escapeHtml(batch.timing || "--")}
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:8px; align-items:flex-end;">
            <span class="badge ${overridden ? "badge-gold" : "badge-success"}">
              Today: ${escapeHtml(timing)}${overridden ? " (Updated Today)" : ""}
            </span>
            <div class="actions-cell">
              <button type="button" class="btn btn-wa btn-sm open-hw-btn" data-id="${escapeHtml(batch.id)}">
                📤 Homework
              </button>
              <button type="button" class="btn btn-outline btn-sm edit-wa-link-btn" data-id="${escapeHtml(batch.id)}">
                ${hasWaLink ? "Edit Group Link" : "Set Group Link"}
              </button>
            </div>
          </div>
        </div>

        ${
          roster.length
            ? `<div class="list-box-stack">
                ${roster
                  .map(
                    (stu) => `
                  <div class="list-box teacher-stu-box" data-id="${escapeHtml(stu.id)}" role="button" tabindex="0">
                    <div class="list-box-main">
                      <div class="list-box-title">
                        <span class="mono">${escapeHtml(stu.id)}</span> · ${escapeHtml(stu.name)}
                      </div>
                      <div class="list-box-sub">Joined ${escapeHtml(stu.joiningDate || "--")}</div>
                    </div>
                    <div class="list-box-right">
                      <span class="badge ${stu.mode === "online" ? "badge-primary" : "badge-muted"}">
                        ${stu.mode === "online" ? "Online" : "Offline"}
                      </span>
                    </div>
                  </div>
                `
                  )
                  .join("")}
              </div>`
            : `<p class="text-muted" style="margin:0;">No students enrolled in this batch yet.</p>`
        }
      </div>
    `;
      })
      .join("");
}

function openTeacherStudentDetail(stdId) {
  const stu = state.students.find((s) => s.id === stdId);
  if (!stu) return;
  openStudentDetailPopup(stu, {
    batchName: getBatchName(stu.batchId),
    sessionName: getSessionName(stu.sessionId),
    testsList: state.tests,
    testResultsMap: state.testResults,
    canManage: false,
    allowMessageComposer: true
  });
}

document.getElementById("close-t-stu-modal").addEventListener("click", () => {
  document.getElementById("teacher-student-modal").classList.remove("open");
});

document.getElementById("teacher-batches-list").addEventListener("click", (e) => {
  const hwBtn = e.target.closest(".open-hw-btn");
  if (hwBtn) {
    const batch = getBatch(hwBtn.dataset.id);
    if (!batch) return;
    if (batch.whatsappGroupLink) {
      openExternalUrl(batch.whatsappGroupLink);
    } else {
      openWhatsAppGroupModal(batch.id);
    }
    return;
  }

  const editLinkBtn = e.target.closest(".edit-wa-link-btn");
  if (editLinkBtn) {
    openWhatsAppGroupModal(editLinkBtn.dataset.id);
    return;
  }

  const stuBox = e.target.closest(".teacher-stu-box");
  if (stuBox) {
    openTeacherStudentDetail(stuBox.dataset.id);
  }
});

// ============================================================================
// 2. ROUTINE TESTS
// ============================================================================
function renderTests() {
  const myIds = getTeacherBatchIdSet();
  const filterBatch = document.getElementById("test-filter-batch").value;
  const list = state.tests
    .filter((t) => myIds.has(t.batchId) && (!filterBatch || t.batchId === filterBatch))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const tbody = document.getElementById("tests-table-body");
  tbody.innerHTML = list.length
    ? list
        .map(
          (t) => `
        <tr>
          <td data-label="Test Name"><strong>${escapeHtml(t.name)}</strong></td>
          <td data-label="Topic">${escapeHtml(t.topic || "--")}</td>
          <td data-label="Batch">${escapeHtml(getBatchName(t.batchId))}</td>
          <td data-label="Max Marks"><strong>${escapeHtml(t.maxMarks)}</strong></td>
          <td data-label="Actions" class="actions-cell">
            <button type="button" class="btn btn-primary btn-sm enter-results-btn" data-id="${escapeHtml(t.id)}">
              Enter / Edit Results
            </button>
            <button type="button" class="btn btn-danger btn-sm del-test-btn" data-id="${escapeHtml(t.id)}">
              Delete
            </button>
          </td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="5" class="empty-cell text-muted">No routine tests created yet.</td></tr>`;

  // Also keep Results test selector in sync
  const resSelect = document.getElementById("res-test-select");
  const prevTest = resSelect.value;
  const myTests = state.tests
    .filter((t) => myIds.has(t.batchId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  resSelect.innerHTML = myTests.length
    ? `<option value="">-- Select Test --</option>` +
      myTests
        .map(
          (t) =>
            `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)} — ${escapeHtml(
              getBatchName(t.batchId)
            )} (/${escapeHtml(t.maxMarks)})</option>`
        )
        .join("")
    : `<option value="">No tests created yet</option>`;

  if (prevTest && myTests.some((t) => t.id === prevTest)) {
    resSelect.value = prevTest;
  }
  renderResultsCards();
}

document.getElementById("test-filter-batch").addEventListener("change", renderTests);

document.getElementById("test-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const batchId = document.getElementById("test-batch").value;
  const name = document.getElementById("test-name").value.trim();
  const topic = document.getElementById("test-topic").value.trim();
  const maxMarks = Number(document.getElementById("test-max").value);

  if (!batchId || !name || !topic || !(maxMarks > 0)) {
    toast("Please fill all test fields validly.", "error");
    return;
  }

  try {
    await dbPush("tests", {
      batchId,
      name,
      topic,
      maxMarks,
      teacherId: session.id,
      createdAt: Date.now()
    });
    document.getElementById("test-form").reset();
    populateBatchSelectors();
    toast("Routine test created.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to create test.", "error");
  }
});

document.getElementById("tests-table-body").addEventListener("click", async (e) => {
  const enterBtn = e.target.closest(".enter-results-btn");
  if (enterBtn) {
    const testId = enterBtn.dataset.id;
    activatePanel("results");
    document.getElementById("res-test-select").value = testId;
    renderResultsCards();
    return;
  }

  const delBtn = e.target.closest(".del-test-btn");
  if (delBtn) {
    const testId = delBtn.dataset.id;
    try {
      await dbRemove(`tests/${testId}`);
      await dbRemove(`testResults/${testId}`);
      toast("Test and its results deleted.", "info");
    } catch (err) {
      console.error(err);
      toast("Failed to delete test.", "error");
    }
  }
});

// ============================================================================
// 3. TEST RESULTS (CARD LIST + BLANK = ABSENT BY DEFAULT, TYPING MARKS = PRESENT)
// ============================================================================
function renderResultsCards() {
  const testId = document.getElementById("res-test-select").value;
  const container = document.getElementById("results-card-list");
  const metaBox = document.getElementById("res-test-meta");
  const saveWrap = document.getElementById("results-save-wrap");

  const test = state.tests.find((t) => t.id === testId);
  if (!test) {
    metaBox.classList.add("hidden");
    saveWrap.classList.add("hidden");
    container.innerHTML = `<p class="text-muted" style="margin:0;">Select a test to enter marks.</p>`;
    return;
  }

  metaBox.classList.remove("hidden");
  metaBox.innerHTML = `<strong>${escapeHtml(test.name)}</strong> • Topic: ${escapeHtml(
    test.topic || "--"
  )} • Batch: ${escapeHtml(getBatchName(test.batchId))} • Max Marks: <strong>${escapeHtml(
    test.maxMarks
  )}</strong>. Leave marks blank for Absent.`;

  const students = state.students.filter((s) => s.active !== false && s.batchId === test.batchId);
  if (!students.length) {
    saveWrap.classList.add("hidden");
    container.innerHTML = `<p class="text-muted" style="margin:0;">No active students in this batch.</p>`;
    return;
  }

  saveWrap.classList.remove("hidden");
  const existingMap = state.testResults[testId] || {};

  container.innerHTML = students
    .map((stu) => {
      const rec = existingMap[stu.id];
      const hasMarks =
        rec && rec.status !== "absent" && rec.marks !== null && rec.marks !== undefined && rec.marks !== "";
      const valStr = hasMarks ? String(rec.marks) : "";
      return `
      <div class="result-entry-card ${hasMarks ? "" : "absent-row"}" data-std="${escapeHtml(stu.id)}">
        <div class="result-entry-info" data-std="${escapeHtml(stu.id)}" role="button" tabindex="0">
          <div class="list-box-title">
            <span class="mono">${escapeHtml(stu.id)}</span> · ${escapeHtml(stu.name)}
          </div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:4px;">
            <span class="badge res-status-badge ${hasMarks ? "badge-success" : "badge-danger"}">
              ${hasMarks ? "Present" : "Absent"}
            </span>
            <span class="text-muted">Tap for details</span>
          </div>
        </div>
        <div class="result-entry-input-wrap">
          <input
            type="number"
            class="res-marks-input"
            data-std="${escapeHtml(stu.id)}"
            min="0"
            max="${escapeHtml(test.maxMarks)}"
            step="0.5"
            value="${escapeHtml(valStr)}"
            placeholder="/ ${escapeHtml(test.maxMarks)}"
            aria-label="Marks for ${escapeHtml(stu.name)}"
          />
        </div>
      </div>
    `;
    })
    .join("");
}

document.getElementById("res-test-select").addEventListener("change", renderResultsCards);

document.getElementById("results-card-list").addEventListener("input", (e) => {
  const input = e.target.closest(".res-marks-input");
  if (!input) return;
  const card = input.closest(".result-entry-card");
  const badge = card ? card.querySelector(".res-status-badge") : null;
  const hasVal = input.value.trim() !== "";
  if (card) card.classList.toggle("absent-row", !hasVal);
  if (badge) {
    badge.textContent = hasVal ? "Present" : "Absent";
    badge.className = `badge res-status-badge ${hasVal ? "badge-success" : "badge-danger"}`;
  }
});

document.getElementById("results-card-list").addEventListener("click", (e) => {
  if (e.target.closest(".res-marks-input")) return;
  const infoEl = e.target.closest(".result-entry-info") || e.target.closest(".result-entry-card");
  if (!infoEl) return;

  const stdId = infoEl.dataset.std;
  const testId = document.getElementById("res-test-select").value;
  const test = state.tests.find((t) => t.id === testId);
  const stu = state.students.find((s) => s.id === stdId);
  if (!test || !stu) return;

  const card = infoEl.closest(".result-entry-card");
  const inp = card ? card.querySelector(".res-marks-input") : null;
  const rec = state.testResults[testId] ? state.testResults[testId][stdId] || null : null;

  openTestResultDetailPopup({
    test,
    student: stu,
    record: rec,
    currentMarksValue: inp ? inp.value.trim() : "",
    onFocusInput: (id) => {
      const targetInp = document.querySelector(`#results-card-list .res-marks-input[data-std="${CSS.escape(id)}"]`);
      if (targetInp) {
        targetInp.focus();
        targetInp.select();
      }
    }
  });
});

document.getElementById("close-marks-modal").addEventListener("click", () => {
  document.getElementById("student-marks-modal").classList.remove("open");
});

document.getElementById("results-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const testId = document.getElementById("res-test-select").value;
  const test = state.tests.find((t) => t.id === testId);
  if (!test) return;

  const inputs = Array.from(document.querySelectorAll("#results-card-list .res-marks-input"));
  const payload = {};
  for (const inp of inputs) {
    const stdId = inp.dataset.std;
    const raw = inp.value.trim();
    if (raw === "") {
      payload[stdId] = {
        marks: null,
        status: "absent",
        updatedAt: Date.now(),
        updatedBy: session.id
      };
    } else {
      const val = Number(raw);
      if (Number.isNaN(val) || val < 0 || val > Number(test.maxMarks)) {
        toast(`Invalid marks for ${stdId}. Must be between 0 and ${test.maxMarks}.`, "error");
        inp.focus();
        return;
      }
      payload[stdId] = {
        marks: val,
        status: "present",
        updatedAt: Date.now(),
        updatedBy: session.id
      };
    }
  }

  try {
    await dbSet(`testResults/${testId}`, payload);
    toast("Test results saved successfully.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to save test results.", "error");
  }
});

// ============================================================================
// 4. WEEKLY CONTENT (7-DAY AUTO-CLEANUP)
// ============================================================================
function renderWeeklyContent() {
  const myIds = getTeacherBatchIdSet();
  const list = state.weeklyContent
    .filter((w) => myIds.has(w.batchId))
    .sort((a, b) => (b.weekStart || "").localeCompare(a.weekStart || "") || (b.createdAt || 0) - (a.createdAt || 0));

  const tbody = document.getElementById("weekly-table-body");
  tbody.innerHTML = list.length
    ? list
        .map(
          (w) => `
        <tr>
          <td data-label="Week Start"><strong>${escapeHtml(w.weekStart || "--")}</strong></td>
          <td data-label="Batch">${escapeHtml(getBatchName(w.batchId))}</td>
          <td data-label="Content" style="white-space: pre-wrap;">${escapeHtml(w.content || "")}</td>
          <td data-label="Actions" class="actions-cell">
            <button type="button" class="btn btn-danger btn-sm del-weekly-btn" data-id="${escapeHtml(w.id)}">
              Delete
            </button>
          </td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="4" class="empty-cell text-muted">No weekly content posted in the last 7 days.</td></tr>`;
}

document.getElementById("weekly-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const batchId = document.getElementById("wk-batch").value;
  const weekStart = document.getElementById("wk-start").value;
  const content = document.getElementById("wk-content").value.trim();

  if (!batchId || !weekStart || !content) {
    toast("Please complete all weekly content fields.", "error");
    return;
  }

  try {
    await dbPush("weeklyContent", {
      batchId,
      weekStart,
      content,
      teacherId: session.id,
      createdAt: Date.now()
    });
    document.getElementById("wk-content").value = "";
    toast("Weekly content published.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to publish weekly content.", "error");
  }
});

document.getElementById("weekly-table-body").addEventListener("click", async (e) => {
  const btn = e.target.closest(".del-weekly-btn");
  if (!btn) return;
  try {
    await dbRemove(`weeklyContent/${btn.dataset.id}`);
    toast("Weekly content removed.", "info");
  } catch (err) {
    console.error(err);
    toast("Failed to delete weekly content.", "error");
  }
});











// ============================================================================
// 6. SCHOOL DATE SHEETS
// ============================================================================
function addDateSheetRow(subjectVal = "", dateVal = "") {
  const container = document.getElementById("ds-rows-container");
  const row = document.createElement("div");
  row.className = "ds-subject-row";
  row.style.cssText =
    "display:grid; grid-template-columns: 1fr 1fr auto; gap:8px; align-items:center;";
  row.innerHTML = `
    <input type="text" class="ds-sub-input" placeholder="Subject" value="${escapeHtml(subjectVal)}" required />
    <input type="date" class="ds-date-input" value="${escapeHtml(dateVal)}" required />
    <button type="button" class="btn btn-danger btn-sm btn-inline ds-remove-row-btn" aria-label="Remove row">✕</button>
  `;
  container.appendChild(row);
}

document.getElementById("open-datesheet-modal-btn").addEventListener("click", () => {
  document.getElementById("datesheet-form").reset();
  populateBatchSelectors();
  document.getElementById("ds-rows-container").innerHTML = "";
  addDateSheetRow();
  document.getElementById("datesheet-modal").classList.add("open");
});

document.getElementById("close-datesheet-modal").addEventListener("click", () => {
  document.getElementById("datesheet-modal").classList.remove("open");
});

document.getElementById("ds-add-row-btn").addEventListener("click", () => {
  addDateSheetRow();
});

document.getElementById("ds-rows-container").addEventListener("click", (e) => {
  const btn = e.target.closest(".ds-remove-row-btn");
  if (!btn) return;
  const rows = document.querySelectorAll("#ds-rows-container .ds-subject-row");
  if (rows.length <= 1) {
    toast("At least one subject and date row is required.", "error");
    return;
  }
  btn.closest(".ds-subject-row").remove();
});

document.getElementById("datesheet-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const batchId = document.getElementById("ds-batch").value;
  const schoolName = document.getElementById("ds-school").value.trim();
  const rows = Array.from(document.querySelectorAll("#ds-rows-container .ds-subject-row"));
  const subjects = rows
    .map((r) => ({
      subject: r.querySelector(".ds-sub-input").value.trim(),
      date: r.querySelector(".ds-date-input").value
    }))
    .filter((s) => s.subject && s.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!batchId || !schoolName || !subjects.length) {
    toast("Please enter batch, school name, and at least one exam.", "error");
    return;
  }

  try {
    await dbPush("dateSheets", {
      batchId,
      schoolName,
      subjects,
      teacherId: session.id,
      createdAt: Date.now()
    });
    document.getElementById("datesheet-modal").classList.remove("open");
    toast("Date sheet saved.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to save date sheet.", "error");
  }
});

function renderDateSheets() {
  const myIds = getTeacherBatchIdSet();
  const list = state.dateSheets
    .filter((d) => myIds.has(d.batchId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const container = document.getElementById("datesheets-list");
  if (!list.length) {
    container.innerHTML = `<p class="text-muted">No school date sheets added yet.</p>`;
    return;
  }

  container.innerHTML = list
    .map((sheet) => {
      const subs = Array.isArray(sheet.subjects) ? sheet.subjects : [];
      return `
      <details open style="border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 12px; background: #F8FAFC;">
        <summary style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; font-weight:700; color:var(--primary);">
          <span>${escapeHtml(sheet.schoolName)} — ${escapeHtml(getBatchName(sheet.batchId))} (${subs.length} Exam(s))</span>
          <button type="button" class="btn btn-danger btn-sm btn-inline del-ds-btn" data-id="${escapeHtml(sheet.id)}">Delete</button>
        </summary>
        <div class="table-wrap" style="margin-top: 12px;">
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Exam Date</th>
                <th>Countdown</th>
              </tr>
            </thead>
            <tbody>
              ${subs
                .map((s) => {
                  const diff = diffDaysFromToday(s.date);
                  let badge = `<span class="badge badge-muted">${escapeHtml(s.date)}</span>`;
                  if (diff === 3) badge = `<span class="badge badge-gold">In 3 Days!</span>`;
                  else if (diff > 0) badge = `<span class="badge badge-primary">In ${diff} day(s)</span>`;
                  else if (diff === 0) badge = `<span class="badge badge-danger">Today</span>`;
                  else if (diff < 0) badge = `<span class="badge badge-muted">Completed</span>`;
                  return `
                  <tr>
                    <td data-label="Subject"><strong>${escapeHtml(s.subject)}</strong></td>
                    <td data-label="Exam Date">${escapeHtml(s.date)}</td>
                    <td data-label="Countdown">${badge}</td>
                  </tr>
                `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </details>
    `;
    })
    .join("");
}

document.getElementById("datesheets-list").addEventListener("click", async (e) => {
  const btn = e.target.closest(".del-ds-btn");
  if (!btn) return;
  e.preventDefault();
  try {
    await dbRemove(`dateSheets/${btn.dataset.id}`);
    toast("Date sheet deleted.", "info");
  } catch (err) {
    console.error(err);
    toast("Failed to delete date sheet.", "error");
  }
});

// ============================================================================
// 7. PTMs
// ============================================================================
function renderPtms() {
  const myIds = getTeacherBatchIdSet();
  const list = state.ptms
    .filter((p) => myIds.has(p.batchId))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  const tbody = document.getElementById("ptms-table-body");
  tbody.innerHTML = list.length
    ? list
        .map(
          (p) => `
        <tr>
          <td data-label="Date & Time"><strong>${escapeHtml(p.date)}</strong><br><span class="text-muted">${escapeHtml(p.time)}</span></td>
          <td data-label="Batch">${escapeHtml(getBatchName(p.batchId))}</td>
          <td data-label="Agenda">${escapeHtml(p.agenda)}</td>
          <td data-label="Actions" class="actions-cell">
            <button type="button" class="btn btn-danger btn-sm del-ptm-btn" data-id="${escapeHtml(p.id)}">Delete</button>
          </td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="4" class="empty-cell text-muted">No PTMs scheduled yet.</td></tr>`;
}

document.getElementById("ptm-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const batchId = document.getElementById("ptm-batch").value;
  const date = document.getElementById("ptm-date").value;
  const time = document.getElementById("ptm-time").value.trim();
  const agenda = document.getElementById("ptm-agenda").value.trim();

  if (!batchId || !date || !time || !agenda) {
    toast("Please fill all PTM fields.", "error");
    return;
  }

  try {
    await dbPush("ptms", {
      batchId,
      date,
      time,
      agenda,
      teacherId: session.id,
      createdAt: Date.now()
    });
    document.getElementById("ptm-form").reset();
    document.getElementById("ptm-date").value = today();
    populateBatchSelectors();
    toast("PTM scheduled.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to schedule PTM.", "error");
  }
});

document.getElementById("ptms-table-body").addEventListener("click", async (e) => {
  const btn = e.target.closest(".del-ptm-btn");
  if (!btn) return;
  try {
    await dbRemove(`ptms/${btn.dataset.id}`);
    toast("PTM deleted.", "info");
  } catch (err) {
    console.error(err);
    toast("Failed to delete PTM.", "error");
  }
});

// ============================================================================
// 8. NOTICES
// ============================================================================
function renderNotices() {
  const myIds = getTeacherBatchIdSet();
  const list = state.notices
    .filter((n) => n.batchId === "all" || myIds.has(n.batchId))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const tbody = document.getElementById("notices-table-body");
  tbody.innerHTML = list.length
    ? list
        .map(
          (n) => `
        <tr>
          <td data-label="Title"><strong>${escapeHtml(n.title)}</strong></td>
          <td data-label="Target"><span class="badge badge-primary">${escapeHtml(getBatchName(n.batchId))}</span></td>
          <td data-label="Message" style="white-space: pre-wrap;">${escapeHtml(n.message)}</td>
          <td data-label="Actions" class="actions-cell">
            <button type="button" class="btn btn-danger btn-sm del-notice-btn" data-id="${escapeHtml(n.id)}">Delete</button>
          </td>
        </tr>
      `
        )
        .join("")
    : `<tr><td colspan="4" class="empty-cell text-muted">No notices published yet.</td></tr>`;
}

document.getElementById("notice-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("notice-title").value.trim();
  const batchId = document.getElementById("notice-batch").value;
  const message = document.getElementById("notice-msg").value.trim();

  if (!title || !batchId || !message) {
    toast("Please fill all notice fields.", "error");
    return;
  }

  try {
    await dbPush("notices", {
      title,
      batchId,
      message,
      teacherId: session.id,
      createdAt: Date.now()
    });
    document.getElementById("notice-form").reset();
    populateBatchSelectors();
    toast("Notice published.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to publish notice.", "error");
  }
});

document.getElementById("notices-table-body").addEventListener("click", async (e) => {
  const btn = e.target.closest(".del-notice-btn");
  if (!btn) return;
  try {
    await dbRemove(`notices/${btn.dataset.id}`);
    toast("Notice deleted.", "info");
  } catch (err) {
    console.error(err);
    toast("Failed to delete notice.", "error");
  }
});

// ============================================================================
// 9. LEAVES (READ-ONLY CLICKABLE BOXES)
// ============================================================================
function renderTeacherLeaves() {
  const myIds = getTeacherBatchIdSet();
  const list = state.leaves
    .filter((l) => myIds.has(l.batchId))
    .sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));

  const container = document.getElementById("teacher-leaves-list");
  container.innerHTML = list.length
    ? list
        .map((l) => {
          const st = l.status || "pending";
          const badgeCls =
            st === "approved" ? "badge-success" : st === "rejected" ? "badge-danger" : "badge-gold";
          const label = st.charAt(0).toUpperCase() + st.slice(1);
          return `
          <div class="list-box teacher-leave-box" data-id="${escapeHtml(l.id)}" role="button" tabindex="0">
            <div class="list-box-main">
              <div class="list-box-title">
                ${escapeHtml(l.studentName || l.studentId)}
                <span class="mono text-muted">(${escapeHtml(l.studentId)})</span>
              </div>
              <div class="list-box-sub">
                ${escapeHtml(getBatchName(l.batchId))} • ${escapeHtml(l.fromDate)} to ${escapeHtml(l.toDate)}
              </div>
            </div>
            <div class="list-box-right">
              <span class="badge ${badgeCls}">${escapeHtml(label)}</span>
            </div>
          </div>
        `;
        })
        .join("")
    : `<p class="text-muted" style="margin:0;">No leave applications found for your batches.</p>`;
}

document.getElementById("teacher-leaves-list").addEventListener("click", (e) => {
  const box = e.target.closest(".teacher-leave-box");
  if (!box) return;
  const leave = state.leaves.find((l) => l.id === box.dataset.id);
  if (!leave) return;
  openLeaveDetailPopup(leave, {
    batchName: getBatchName(leave.batchId),
    canReview: false
  });
});

// ============================================================================
// 10. ATTENDANCE VIEW (READ-ONLY CLICKABLE BOXES)
// ============================================================================
function renderTeacherAttendance() {
  const batchId = document.getElementById("t-att-batch").value;
  const dateStr = document.getElementById("t-att-date").value || today();
  const container = document.getElementById("teacher-att-list");

  if (!batchId) {
    container.innerHTML = `<p class="text-muted" style="margin:0;">Select a batch to view attendance.</p>`;
    return;
  }

  const key = `${dateStr}_${batchId}`;
  const attMap = state.attendance[key] || {};
  const roster = state.students.filter((s) => s.active !== false && s.batchId === batchId);

  container.innerHTML = roster.length
    ? roster
        .map((stu) => {
          const rec = attMap[stu.id];
          const status = rec ? rec.status : "unmarked";
          const timeHM = rec && rec.checkinTime ? formatTimeHM(rec.checkinTime) : "";

          const badge =
            status === "present"
              ? `<span class="badge badge-success">✓ Present${
                  rec && rec.source === "qr" && timeHM ? ` (${escapeHtml(timeHM)})` : ""
                }</span>`
              : status === "online"
                ? `<span class="badge badge-primary">🌐 Online</span>`
                : status === "absent"
                  ? `<span class="badge badge-danger">Absent</span>`
                  : `<span class="badge badge-muted">Unmarked</span>`;

          return `
          <div class="list-box teacher-att-box" data-id="${escapeHtml(stu.id)}" role="button" tabindex="0">
            <div class="list-box-main">
              <div class="list-box-title">
                <span class="mono">${escapeHtml(stu.id)}</span> · ${escapeHtml(stu.name)}
              </div>
            </div>
            <div class="list-box-right">
              ${badge}
            </div>
          </div>
        `;
        })
        .join("")
    : `<p class="text-muted" style="margin:0;">No active students in this batch.</p>`;
}

document.getElementById("teacher-att-list").addEventListener("click", (e) => {
  const box = e.target.closest(".teacher-att-box");
  if (!box) return;
  const stdId = box.dataset.id;
  const stu = state.students.find((s) => s.id === stdId);
  if (!stu) return;
  const batchId = document.getElementById("t-att-batch").value;
  const dateStr = document.getElementById("t-att-date").value || today();
  const key = `${dateStr}_${batchId}`;
  const rec = (state.attendance[key] || {})[stdId] || null;

  openAttendanceDetailPopup({
    student: stu,
    batchName: getBatchName(batchId),
    dateStr,
    record: rec,
    canOverride: false
  });
});

document.getElementById("t-att-batch").addEventListener("change", renderTeacherAttendance);
document.getElementById("t-att-date").addEventListener("change", renderTeacherAttendance);

// ============================================================================
// REALTIME WATCHERS
// ============================================================================
function refreshBatchDependentViews() {
  populateBatchSelectors();
  renderExamReminders();
  renderBatches();
  renderTests();
  renderWeeklyContent();
  renderDateSheets();
  renderPtms();
  renderNotices();
  renderTeacherLeaves();
  renderTeacherAttendance();
}

dbWatch("sessions", (val) => {
  state.sessions = objectToList(val);
  refreshBatchDependentViews();
});

dbWatch("batches", (val) => {
  state.batches = objectToList(val);
  refreshBatchDependentViews();
});

dbWatch("students", (val) => {
  state.students = objectToList(val).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  renderBatches();
  renderResultsCards();
  renderTeacherAttendance();
});

dbWatch("timingOverrides", (val) => {
  state.timingOverrides = val || {};
  renderBatches();
});

dbWatch("tests", (val) => {
  state.tests = objectToList(val);
  renderTests();
});

dbWatch("testResults", (val) => {
  state.testResults = val || {};
  renderResultsCards();
});

dbWatch("weeklyContent", (val) => {
  state.weeklyContent = objectToList(val);
  renderWeeklyContent();
});



dbWatch("dateSheets", (val) => {
  state.dateSheets = objectToList(val);
  renderDateSheets();
  renderExamReminders();
});

dbWatch("ptms", (val) => {
  state.ptms = objectToList(val);
  renderPtms();
});

dbWatch("notices", (val) => {
  state.notices = objectToList(val);
  renderNotices();
});

dbWatch("leaves", (val) => {
  state.leaves = objectToList(val);
  renderTeacherLeaves();
});

dbWatch("attendance", (val) => {
  state.attendance = val || {};
  renderTeacherAttendance();
});

// ============================================================================
// 11. CHANGE OWN PASSWORD (PLAIN TEXT COMPARISON & STORAGE)
// ============================================================================
document.getElementById("teacher-pwd-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const currPwd = document.getElementById("tch-curr-pwd").value;
  const newPwd = document.getElementById("tch-new-pwd").value;
  const confirmPwd = document.getElementById("tch-confirm-pwd").value;

  if (newPwd !== confirmPwd) {
    toast("New passwords do not match.", "error");
    return;
  }

  try {
    const staffRecord = await dbGet(`staff/${session.id}`);
    if (!staffRecord || staffRecord.password !== currPwd) {
      toast("Current password is incorrect.", "error");
      return;
    }

    await dbUpdate(`staff/${session.id}`, { password: newPwd });
    document.getElementById("teacher-pwd-form").reset();
    toast("Password updated successfully.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to update password.", "error");
  }
});
