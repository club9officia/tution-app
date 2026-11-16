// js/student.js
import {
  CONFIG,
  guard,
  logout,
  initDashboardShell,
  dbGet,
  dbSet,
  dbPush,
  dbUpdate,
  dbWatch,
  objectToList,
  cleanupWeeklyContent,
  today,
  monthKey,
  diffDaysFromToday,
  escapeHtml,
  openWhatsApp,
  toast,
  formatTimeHM,
  openAttendanceDetailPopup,
  openTestResultDetailPopup,
  openLeaveDetailPopup
} from "./app.js";

const session = guard("student");
if (!session) throw new Error("Unauthorized");

const panelTitles = {
  home: "Home",
  attendance: "Attendance",
  tests: "Test Marks",
  weekly: "Weekly Content",
  datesheets: "Date Sheets",
  ptms: "PTMs",
  notices: "Notices",
  leaves: "Apply for Leave",
  notifications: "Notifications",
  profile: "Profile & Password",
  more: "More Options"
};

const { activatePanel } = initDashboardShell((target) => {
  const titleEl = document.getElementById("topbar-title");
  if (titleEl) titleEl.textContent = panelTitles[target] || "Student Portal";
});

document.querySelectorAll(".stu-more-nav").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.panel) activatePanel(btn.dataset.panel);
  });
});

const moreLogoutBtn = document.getElementById("stu-more-logout-btn");
if (moreLogoutBtn) moreLogoutBtn.addEventListener("click", logout);

const viewNoticesBtn = document.getElementById("stu-view-notices-btn");
if (viewNoticesBtn) {
  viewNoticesBtn.addEventListener("click", () => activatePanel("notices"));
}

document.getElementById("stu-header-id").textContent = session.id;
document.getElementById("leave-from").value = today();
document.getElementById("leave-to").value = today();

const state = {
  student: null,
  batch: null,
  sessionObj: null,
  teacherPhone: CONFIG.whatsapp,
  teacherName: "Batch Teacher",
  staffMap: {},
  notifications: [],
  tests: [],
  testResults: {},
  weeklyContent: [],
  notices: [],
  dateSheets: [],
  ptms: [],
  leaves: [],
  attendanceDays: []
};

cleanupWeeklyContent();

// ============================================================================
// LOAD STUDENT PROFILE, BATCH, TEACHER & TIMING
// ============================================================================
function renderStudentProfile() {
  const container = document.getElementById("stu-profile-details");
  if (!container || !state.student) return;
  const s = state.student;
  const batchLabel = state.batch ? state.batch.name : "--";
  const sessLabel = state.sessionObj ? state.sessionObj.name : "--";
  container.innerHTML = `
    <div class="popup-mini-row"><span>Name</span><strong>${escapeHtml(s.name)}</strong></div>
    <div class="popup-mini-row"><span>Student ID</span><strong class="mono">${escapeHtml(s.id)}</strong></div>
    <div class="popup-mini-row"><span>Batch</span><strong>${escapeHtml(batchLabel)}</strong></div>
    <div class="popup-mini-row"><span>Session</span><strong>${escapeHtml(sessLabel)}</strong></div>
    <div class="popup-mini-row"><span>Mode</span><span class="badge ${s.mode === "online" ? "badge-primary" : "badge-muted"}">${s.mode === "online" ? "Online" : "Offline"}</span></div>
    <div class="popup-mini-row"><span>Joined</span><strong class="mono">${escapeHtml(s.joiningDate || "--")}</strong></div>
    <div class="popup-mini-row"><span>Parental Mobile (Primary)</span><strong class="mono">${escapeHtml(s.parentalPhone || "--")}</strong></div>
    ${s.fatherPhone ? `<div class="popup-mini-row"><span>Father Mobile</span><strong class="mono">${escapeHtml(s.fatherPhone)}</strong></div>` : ""}
    ${s.motherPhone ? `<div class="popup-mini-row"><span>Mother Mobile</span><strong class="mono">${escapeHtml(s.motherPhone)}</strong></div>` : ""}
    ${s.personalPhone ? `<div class="popup-mini-row"><span>Personal Mobile</span><strong class="mono">${escapeHtml(s.personalPhone)}</strong></div>` : ""}
  `;
}

async function loadStudentPortal() {
  try {
    const student = await dbGet(`students/${session.id}`);
    if (!student || student.active === false) {
      toast("Student account inactive. Signing out.", "error");
      logout();
      return;
    }
    state.student = student;

    const [batch, sessObj, staffRaw, todayOvRaw] = await Promise.all([
      student.batchId ? dbGet(`batches/${student.batchId}`) : null,
      student.sessionId ? dbGet(`sessions/${student.sessionId}`) : null,
      dbGet("staff"),
      student.batchId ? dbGet(`timingOverrides/${today()}_${student.batchId}`) : null
    ]);

    state.batch = batch;
    state.sessionObj = sessObj;
    state.staffMap = staffRaw || {};

    // Resolve batch teacher WhatsApp number
    const staffList = objectToList(staffRaw);
    let assignedTeacher = null;
    if (batch && batch.teacherId) {
      assignedTeacher = staffList.find((t) => t.id === batch.teacherId) || null;
    }
    if (!assignedTeacher) {
      assignedTeacher = staffList.find((t) => t.occupation === "teacher" && t.phone) || null;
    }

    if (assignedTeacher && assignedTeacher.phone) {
      state.teacherPhone = assignedTeacher.phone;
      state.teacherName = assignedTeacher.name || "Batch Teacher";
    } else if (batch && batch.teacherPhone) {
      state.teacherPhone = batch.teacherPhone;
      state.teacherName = batch.teacherName || "Batch Teacher";
    } else {
      state.teacherPhone = CONFIG.whatsapp;
      state.teacherName = "Jain Commerce Hub Faculty";
    }

    document.getElementById("stu-name-heading").textContent = `Welcome, ${student.name}`;
    document.getElementById("stu-session-badge").textContent = sessObj ? `Session ${sessObj.name}` : "Student Portal";
    document.getElementById("stu-batch-subtitle").textContent = batch
      ? `Batch: ${batch.name} • Student ID: ${student.id}`
      : `Student ID: ${student.id}`;
    document.getElementById("doubt-teacher-hint").textContent = `Direct WhatsApp to ${state.teacherName}`;

    // Today's Timing (override if today, else default)
    const ovList = objectToList(todayOvRaw).sort((a, b) => (b.overriddenAt || 0) - (a.overriddenAt || 0));
    const timingEl = document.getElementById("stu-today-timing");
    const timingBadge = document.getElementById("stu-timing-badge");
    const timingNote = document.getElementById("stu-timing-note");

    if (ovList.length) {
      timingEl.textContent = ovList[0].newTiming;
      timingBadge.textContent = "Updated Today";
      timingBadge.className = "badge badge-gold";
      timingNote.textContent =
        batch && batch.timing
          ? `Default timing: ${batch.timing} (overridden for today only)`
          : "Special timing applies for today only.";
    } else if (batch && batch.timing) {
      timingEl.textContent = batch.timing;
      timingBadge.textContent = "Regular Schedule";
      timingBadge.className = "badge badge-primary";
      timingNote.textContent = "No timing changes announced for today.";
    } else {
      timingEl.textContent = "Not Scheduled";
      timingBadge.textContent = "Pending";
      timingNote.textContent = "Contact receptionist for batch timing details.";
    }

    renderStudentProfile();
    watchAttendance(student.batchId);
    watchNotifications();
    watchAcademics(student.batchId);
    watchLeaves();
  } catch (err) {
    console.error(err);
    toast("Failed to load student dashboard.", "error");
  }
}

// ============================================================================
// ASK A DOUBT ON WHATSAPP -> BATCH TEACHER
// ============================================================================
document.getElementById("ask-doubt-wa-btn").addEventListener("click", () => {
  const stuName = state.student ? state.student.name : session.name;
  const batchName = state.batch ? state.batch.name : "my batch";
  const msg = `Hello ${state.teacherName}, I am ${stuName} (${session.id}) from ${batchName} at ${CONFIG.tuitionName}. I have a doubt regarding today's topic: `;
  openWhatsApp(state.teacherPhone, msg);
});

// ============================================================================
// THIS MONTH'S ATTENDANCE LIST (Card boxes — clickable detail popup)
// ============================================================================
function watchAttendance(batchId) {
  dbWatch("attendance", (val) => {
    const listEl = document.getElementById("stu-att-list");
    const pctBadge = document.getElementById("stu-att-pct");
    const summaryEl = document.getElementById("stu-att-summary");
    const homePctBadge = document.getElementById("stu-home-att-pct");
    const homeSummaryEl = document.getElementById("stu-home-att-summary");

    if (!batchId || !val) {
      state.attendanceDays = [];
      pctBadge.textContent = "0%";
      summaryEl.textContent = "No attendance recorded for this month yet.";
      if (homePctBadge) homePctBadge.textContent = "0%";
      if (homeSummaryEl) homeSummaryEl.textContent = "No attendance recorded for this month yet.";
      listEl.innerHTML = `<p class="text-muted" style="margin:0;">No attendance records yet.</p>`;
      return;
    }

    const curYm = monthKey();
    const days = [];
    Object.entries(val).forEach(([key, studentsMap]) => {
      if (!key.startsWith(curYm + "-") || !key.endsWith("_" + batchId)) return;
      const dateStr = key.split("_")[0];
      const rec = studentsMap && studentsMap[session.id];
      if (rec && rec.status) {
        days.push({
          date: dateStr,
          record: rec,
          status: rec.status,
          source: rec.source || "manual",
          checkinTime: rec.checkinTime || "",
          autoMarked: !!rec.autoMarked
        });
      }
    });

    days.sort((a, b) => b.date.localeCompare(a.date));
    state.attendanceDays = days;

    const presentCount = days.filter((d) => d.status === "present").length;
    const onlineCount = days.filter((d) => d.status === "online").length;
    const absentCount = days.filter((d) => d.status === "absent").length;
    const attendedCount = presentCount + onlineCount;
    const pct = days.length ? Math.round((attendedCount / days.length) * 100) : 0;
    const pctCls = `badge ${pct >= 75 ? "badge-success" : pct >= 50 ? "badge-gold" : "badge-danger"}`;
    const sumStr = `${presentCount} Present • ${onlineCount} Online • ${absentCount} Absent out of ${days.length} class(es) this month.`;

    pctBadge.textContent = `${pct}%`;
    pctBadge.className = pctCls;
    summaryEl.textContent = sumStr;

    if (homePctBadge) {
      homePctBadge.textContent = `${pct}%`;
      homePctBadge.className = pctCls;
    }
    if (homeSummaryEl) homeSummaryEl.textContent = sumStr;

    listEl.innerHTML = days.length
      ? days
          .map((d, idx) => {
            const timeHM = formatTimeHM(d.checkinTime);
            const chip =
              d.status === "present"
                ? `<span class="badge badge-success">✓ Present${d.source === "qr" && timeHM ? ` (${escapeHtml(timeHM)})` : ""}</span>`
                : d.status === "online"
                  ? `<span class="badge badge-primary">🌐 Online</span>`
                  : `<span class="badge badge-danger">Absent</span>`;
            const sub =
              d.source === "qr"
                ? "QR Check-In"
                : d.autoMarked
                  ? "Auto-Marked Absent"
                  : "Recorded by Receptionist";
            return `
          <div class="list-box stu-att-box" data-idx="${idx}" role="button" tabindex="0">
            <div class="list-box-main">
              <div class="list-box-title mono">${escapeHtml(d.date)}</div>
              <div class="list-box-sub">${escapeHtml(sub)}</div>
            </div>
            <div class="list-box-right">
              ${chip}
            </div>
          </div>
        `;
          })
          .join("")
      : `<p class="text-muted" style="margin:0;">No attendance recorded for ${escapeHtml(curYm)} yet.</p>`;
  });
}

document.getElementById("stu-att-list").addEventListener("click", (e) => {
  const box = e.target.closest(".stu-att-box");
  if (!box || !state.student) return;
  const item = state.attendanceDays[Number(box.dataset.idx)];
  if (!item) return;
  openAttendanceDetailPopup({
    student: state.student,
    batchName: state.batch ? state.batch.name : "--",
    dateStr: item.date,
    record: item.record,
    canOverride: false
  });
});

// ============================================================================
// ACADEMICS WATCHERS (ZERO TABLES — ALL CARD BOXES)
// ============================================================================
function renderTestMarks(batchId) {
  const container = document.getElementById("stu-test-marks-list");
  const myTests = state.tests
    .filter((t) => t.batchId === batchId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  container.innerHTML = myTests.length
    ? myTests
        .map((t) => {
          const map = state.testResults[t.id];
          const rec = map ? map[session.id] : null;
          let badge = `<span class="badge badge-muted">Pending</span>`;

          if (map) {
            if (rec && rec.status === "present" && rec.marks !== null && rec.marks !== undefined) {
              badge = `<span class="badge badge-success">${escapeHtml(rec.marks)} / ${escapeHtml(t.maxMarks)}</span>`;
            } else {
              badge = `<span class="badge badge-danger">Absent</span>`;
            }
          }

          return `
        <div class="list-box stu-test-box" data-id="${escapeHtml(t.id)}" role="button" tabindex="0">
          <div class="list-box-main">
            <div class="list-box-title">${escapeHtml(t.name)}</div>
            <div class="list-box-sub">${escapeHtml(t.topic || "--")} • Max ${escapeHtml(t.maxMarks)}</div>
          </div>
          <div class="list-box-right">
            ${badge}
          </div>
        </div>
      `;
        })
        .join("")
    : `<p class="text-muted" style="margin:0;">No routine tests found for your batch yet.</p>`;
}

document.getElementById("stu-test-marks-list").addEventListener("click", (e) => {
  const box = e.target.closest(".stu-test-box");
  if (!box || !state.student) return;
  const test = state.tests.find((t) => t.id === box.dataset.id);
  if (!test) return;
  const map = state.testResults[test.id];
  const rec = map ? map[session.id] || null : null;
  openTestResultDetailPopup({
    test,
    student: state.student,
    record: rec,
    currentMarksValue: rec && rec.status === "present" && rec.marks !== null && rec.marks !== undefined ? rec.marks : ""
  });
});







function renderWeeklyContent(batchId) {
  const container = document.getElementById("stu-weekly-list");
  const list = state.weeklyContent
    .filter((w) => w.batchId === batchId)
    .sort((a, b) => (b.weekStart || "").localeCompare(a.weekStart || "") || (b.createdAt || 0) - (a.createdAt || 0));

  container.innerHTML = list.length
    ? list
        .map(
          (w) => `
        <div class="list-box" style="cursor:default; flex-direction:column; align-items:flex-start; gap:8px;">
          <span class="badge badge-primary">Week of ${escapeHtml(w.weekStart || "--")}</span>
          <div style="white-space: pre-wrap;">${escapeHtml(w.content || "")}</div>
        </div>
      `
        )
        .join("")
    : `<p class="text-muted" style="margin:0;">No weekly content posted for your batch right now.</p>`;
}

function renderNotices(batchId) {
  const container = document.getElementById("stu-notices-list");
  const latestEl = document.getElementById("stu-latest-notice");
  const list = state.notices
    .filter((n) => n.batchId === batchId || n.batchId === "all")
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const renderNoticeCard = (n) => `
    <div class="list-box" style="cursor:default; flex-direction:column; align-items:flex-start; gap:6px;">
      <div style="width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <strong style="color:var(--primary);">${escapeHtml(n.title)}</strong>
        <span class="badge ${n.batchId === "all" ? "badge-gold" : "badge-primary"}">
          ${n.batchId === "all" ? "All Batches" : "My Batch"}
        </span>
      </div>
      <div style="white-space: pre-wrap;">${escapeHtml(n.message)}</div>
    </div>
  `;

  container.innerHTML = list.length
    ? list.map(renderNoticeCard).join("")
    : `<p class="text-muted" style="margin:0;">No notices posted yet.</p>`;

  if (latestEl) {
    latestEl.innerHTML = list.length
      ? renderNoticeCard(list[0])
      : `<p class="text-muted" style="margin:0;">No notices posted yet.</p>`;
  }
}

function renderDateSheets(batchId) {
  const container = document.getElementById("stu-datesheets-list");
  const list = state.dateSheets
    .filter((d) => d.batchId === batchId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!list.length) {
    container.innerHTML = `<p class="text-muted" style="margin:0;">No school date sheets uploaded for your batch yet.</p>`;
    return;
  }

  container.innerHTML = list
    .map((sheet) => {
      const subs = Array.isArray(sheet.subjects) ? sheet.subjects : [];
      return `
      <div style="border: 1px solid var(--border); border-radius: 12px; padding: 14px; margin-bottom: 12px; background: #F8FAFC;">
        <h3 style="margin: 0 0 10px; font-size: 1rem; color: var(--primary);">${escapeHtml(sheet.schoolName)}</h3>
        <div class="list-box-stack">
          ${subs
            .map((s) => {
              const diff = diffDaysFromToday(s.date);
              let badge = `<span class="badge badge-muted">${escapeHtml(s.date)}</span>`;
              if (diff === 3) badge = `<span class="badge badge-gold">In 3 Days</span>`;
              else if (diff > 0) badge = `<span class="badge badge-primary">In ${diff} day(s)</span>`;
              else if (diff === 0) badge = `<span class="badge badge-danger">Today</span>`;
              else if (diff < 0) badge = `<span class="badge badge-muted">Done</span>`;
              return `
              <div class="list-box" style="cursor:default;">
                <div class="list-box-main">
                  <div class="list-box-title">${escapeHtml(s.subject)}</div>
                  <div class="list-box-sub mono">${escapeHtml(s.date)}</div>
                </div>
                <div class="list-box-right">
                  ${badge}
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
      </div>
    `;
    })
    .join("");
}

function renderPtms(batchId) {
  const container = document.getElementById("stu-ptms-list");
  const list = state.ptms
    .filter((p) => p.batchId === batchId)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  container.innerHTML = list.length
    ? list
        .map(
          (p) => `
        <div class="list-box" style="cursor:default; flex-direction:column; align-items:flex-start; gap:6px;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <span class="badge badge-primary mono">${escapeHtml(p.date)}</span>
            <span class="badge badge-gold">${escapeHtml(p.time)}</span>
          </div>
          <div style="font-weight:600; color:var(--text);">${escapeHtml(p.agenda)}</div>
        </div>
      `
        )
        .join("")
    : `<p class="text-muted" style="margin:0;">No PTMs scheduled for your batch.</p>`;
}

function watchAcademics(batchId) {
  dbWatch("tests", (val) => {
    state.tests = objectToList(val);
    renderTestMarks(batchId);
  });

  dbWatch("testResults", (val) => {
    state.testResults = val || {};
    renderTestMarks(batchId);
  });

  dbWatch("weeklyContent", (val) => {
    state.weeklyContent = objectToList(val);
    renderWeeklyContent(batchId);
  });

  dbWatch("notices", (val) => {
    state.notices = objectToList(val);
    renderNotices(batchId);
  });

  dbWatch("dateSheets", (val) => {
    state.dateSheets = objectToList(val);
    renderDateSheets(batchId);
  });

  dbWatch("ptms", (val) => {
    state.ptms = objectToList(val);
    renderPtms(batchId);
  });
}

// ============================================================================
// LEAVE APPLICATIONS (Clickable cards opening detail popup)
// ============================================================================
function renderMyLeaves() {
  const container = document.getElementById("stu-leaves-list");
  const mine = state.leaves
    .filter((l) => l.studentId === session.id)
    .sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0));

  container.innerHTML = mine.length
    ? mine
        .map((l) => {
          const st = l.status || "pending";
          const badgeCls =
            st === "approved" ? "badge-success" : st === "rejected" ? "badge-danger" : "badge-gold";
          const label = st.charAt(0).toUpperCase() + st.slice(1);
          return `
        <div class="list-box stu-leave-box" data-id="${escapeHtml(l.id)}" role="button" tabindex="0">
          <div class="list-box-main">
            <div class="list-box-title mono">${escapeHtml(l.fromDate)} to ${escapeHtml(l.toDate)}</div>
            <div class="list-box-sub">${escapeHtml(l.reason)}</div>
          </div>
          <div class="list-box-right">
            <span class="badge ${badgeCls}">${escapeHtml(label)}</span>
          </div>
        </div>
      `;
        })
        .join("")
    : `<p class="text-muted" style="margin:0;">No leave applications submitted yet.</p>`;
}

document.getElementById("stu-leaves-list").addEventListener("click", (e) => {
  const box = e.target.closest(".stu-leave-box");
  if (!box) return;
  const leave = state.leaves.find((l) => l.id === box.dataset.id);
  if (!leave) return;
  openLeaveDetailPopup(leave, {
    batchName: state.batch ? state.batch.name : "--",
    canReview: false
  });
});

function watchLeaves() {
  dbWatch("leaves", (val) => {
    state.leaves = objectToList(val);
    renderMyLeaves();
  });
}

document.getElementById("stu-leave-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fromDate = document.getElementById("leave-from").value;
  const toDate = document.getElementById("leave-to").value;
  const reason = document.getElementById("leave-reason").value.trim();

  if (!fromDate || !toDate || !reason) {
    toast("Please fill all leave fields.", "error");
    return;
  }
  if (toDate < fromDate) {
    toast("To Date cannot be earlier than From Date.", "error");
    return;
  }

  try {
    await dbPush("leaves", {
      studentId: session.id,
      studentName: state.student ? state.student.name : session.name,
      batchId: state.student ? state.student.batchId : "",
      fromDate,
      toDate,
      reason,
      status: "pending",
      appliedAt: Date.now()
    });
    document.getElementById("leave-reason").value = "";
    toast("Leave request submitted to receptionist.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to submit leave request.", "error");
  }
});

// ============================================================================
// NOTIFICATIONS (Click marks read: true)
// ============================================================================
function watchNotifications() {
  dbWatch(`notifications/${session.id}`, (val) => {
    const list = objectToList(val).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    state.notifications = list;

    const unreadCount = list.filter((n) => !n.read).length;
    document.getElementById("stu-unread-badge").textContent = `${unreadCount} Unread`;

    const container = document.getElementById("stu-notif-list");
    container.innerHTML = list.length
      ? list
          .map(
            (n) => `
          <div class="notif-item ${n.read ? "" : "unread"}" data-id="${escapeHtml(n.id)}">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px; flex-wrap:wrap;">
              <span class="badge ${n.read ? "badge-muted" : "badge-primary"}">${n.read ? "Read" : "New"}</span>
              <span class="text-muted">
                ${n.createdAt ? escapeHtml(new Date(n.createdAt).toLocaleString("en-IN")) : ""}
              </span>
            </div>
            <div>${escapeHtml(n.message)}</div>
          </div>
        `
          )
          .join("")
      : `<p class="text-muted" style="margin:0;">No notifications yet.</p>`;
  });
}

document.getElementById("stu-notif-list").addEventListener("click", async (e) => {
  const item = e.target.closest(".notif-item");
  if (!item) return;
  const id = item.dataset.id;
  const target = state.notifications.find((n) => n.id === id);
  if (!target || target.read) return;
  await dbUpdate(`notifications/${session.id}/${id}`, { read: true });
});

document.getElementById("mark-all-read-btn").addEventListener("click", async () => {
  const unread = state.notifications.filter((n) => !n.read);
  if (!unread.length) return;
  const updates = {};
  unread.forEach((n) => {
    updates[`${n.id}/read`] = true;
  });
  await dbUpdate(`notifications/${session.id}`, updates);
  toast("All notifications marked as read.", "success");
});

// ============================================================================
// CHANGE OWN PASSWORD (PLAIN TEXT COMPARISON & STORAGE)
// ============================================================================
document.getElementById("student-pwd-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const currPwd = document.getElementById("stu-curr-pwd").value;
  const newPwd = document.getElementById("stu-new-pwd").value;
  const confirmPwd = document.getElementById("stu-confirm-pwd").value;

  if (newPwd !== confirmPwd) {
    toast("New passwords do not match.", "error");
    return;
  }

  try {
    const freshStudent = await dbGet(`students/${session.id}`);
    if (!freshStudent || freshStudent.password !== currPwd) {
      toast("Current password is incorrect.", "error");
      return;
    }

    await dbUpdate(`students/${session.id}`, { password: newPwd });
    document.getElementById("student-pwd-form").reset();
    toast("Password updated successfully.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to update password.", "error");
  }
});

loadStudentPortal();
