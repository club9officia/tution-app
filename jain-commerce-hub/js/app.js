// js/app.js
import {
  auth,
  rtdb,
  signOut,
  signInAnonymously,
  onAuthStateChanged,
  ref,
  get,
  set,
  push,
  update,
  remove,
  onValue
} from "./firebase-config.js";

// ============================================================================
// SINGLE SOURCE OF TRUTH CONFIG
// ============================================================================
export const CONFIG = {
  tuitionName: "Jain Commerce Hub",
  whatsapp: "919719190358",
  whatsappDisplay: "+91 97191 90358",
  logoPath: "/assets/aistudio/image-removebg-preview_60776aef.png"
};

export const SESSION_KEY = "jch_session";

// ============================================================================
// DATE & FORMAT UTILITIES (NO PASSWORD HASHING)
// ============================================================================
export function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function monthKey(dateInput) {
  if (!dateInput) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (typeof dateInput === "string") {
    return dateInput.slice(0, 7);
  }
  return `${dateInput.getFullYear()}-${String(dateInput.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || "";
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export function formatINR(amount) {
  const n = Number(amount) || 0;
  return "₹" + n.toLocaleString("en-IN");
}

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function sanitizeEmailKey(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");
}

export function diffDaysFromToday(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00");
  const cur = new Date(today() + "T00:00:00");
  return Math.round((target.getTime() - cur.getTime()) / 86400000);
}



// ============================================================================
// WHATSAPP HELPER (Direct wa.me links only — NO APIs)
// ============================================================================
export function normalizePhoneForWhatsApp(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return CONFIG.whatsapp;
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  return digits;
}

export function openWhatsApp(phone, message) {
  const target = normalizePhoneForWhatsApp(phone || CONFIG.whatsapp);
  const text = encodeURIComponent(message || `Hello ${CONFIG.tuitionName}, I have a query.`);
  const url = `https://wa.me/${target}?text=${text}`;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function openExternalUrl(url) {
  if (!url) return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function nowTimeHMS() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function formatTimeHM(hms) {
  if (!hms) return "";
  return String(hms).slice(0, 5);
}

export function generateHexToken(bytesLen = 32) {
  const arr = new Uint8Array(bytesLen);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function pickDefaultPhone(student, preference = "parental") {
  if (!student || typeof student !== "object") return "";
  const map = {
    parental: String(student.parentalPhone || "").trim(),
    father: String(student.fatherPhone || "").trim(),
    mother: String(student.motherPhone || "").trim(),
    personal: String(student.personalPhone || "").trim()
  };

  if (preference && map[preference]) {
    return map[preference];
  }
  return map.parental || map.father || map.mother || map.personal || "";
}

export function sendStudentWhatsApp(student, message, preference = "parental") {
  const phone = pickDefaultPhone(student, preference);
  if (!phone) {
    toast("No phone on file.", "error");
    return false;
  }
  openWhatsApp(phone, message);
  return true;
}

// ============================================================================
// TOAST NOTIFICATIONS (Top-center on mobile)
// ============================================================================
export function toast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 260);
  }, 3400);
}

// ============================================================================
// SESSION & ROLE GUARD
// ============================================================================
export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(data) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export async function logout() {
  clearSession();
  try {
    await signOut(auth);
  } catch {
    // Ignore signOut errors if not Firebase Auth signed in
  }
  window.location.href = "index.html";
}

export function guard(requiredRole) {
  const session = getSession();
  if (!session || session.role !== requiredRole) {
    window.location.href = "index.html";
    return null;
  }

  if (requiredRole === "admin") {
    onAuthStateChanged(auth, async (user) => {
      if (!user || user.isAnonymous || user.uid !== session.id) {
        clearSession();
        window.location.href = "index.html";
        return;
      }
      try {
        const snap = await get(ref(rtdb, `admins/${user.uid}`));
        const record = snap.val();
        if (!record || record.active !== true || record.expired === true) {
          clearSession();
          await signOut(auth);
          window.location.href = "index.html";
        }
      } catch {
        // Keep active if transient network hiccup; RTDB writes still enforce rules
      }
    });
  }

  return session;
}

// ============================================================================
// FIREBASE RTDB HELPERS
// ============================================================================
export async function ensureAnonAuthIfNeeded() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const res = await signInAnonymously(auth);
    return res.user;
  } catch {
    return null;
  }
}

export async function dbGet(path) {
  try {
    const snap = await get(ref(rtdb, path));
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    if (err && String(err.code || err.message || "").toLowerCase().includes("permission")) {
      const user = await ensureAnonAuthIfNeeded();
      if (user) {
        const snap = await get(ref(rtdb, path));
        return snap.exists() ? snap.val() : null;
      }
    }
    throw err;
  }
}

export async function dbSet(path, data) {
  try {
    return await set(ref(rtdb, path), data);
  } catch (err) {
    if (err && String(err.code || err.message || "").toLowerCase().includes("permission")) {
      const user = await ensureAnonAuthIfNeeded();
      if (user) return await set(ref(rtdb, path), data);
    }
    throw err;
  }
}

export async function dbPush(path, data) {
  const newRef = push(ref(rtdb, path));
  await set(newRef, data);
  return newRef.key;
}

export async function dbUpdate(path, data) {
  try {
    return await update(ref(rtdb, path), data);
  } catch (err) {
    if (err && String(err.code || err.message || "").toLowerCase().includes("permission")) {
      const user = await ensureAnonAuthIfNeeded();
      if (user) return await update(ref(rtdb, path), data);
    }
    throw err;
  }
}

export async function dbRemove(path) {
  return remove(ref(rtdb, path));
}

export function dbWatch(path, cb) {
  return onValue(ref(rtdb, path), (snap) => {
    cb(snap.exists() ? snap.val() : null);
  });
}

// ============================================================================
// v6 CENTER-WIDE PERMANENT QR & CHECK-IN HELPERS
// ============================================================================
export async function getCenterQR(db = rtdb) {
  try {
    const snap = await get(ref(db, "config/centerQR"));
    return snap.exists() ? snap.val() : null;
  } catch (err) {
    if (err && String(err.code || err.message || "").toLowerCase().includes("permission")) {
      const user = await ensureAnonAuthIfNeeded();
      if (user) {
        const snap = await get(ref(db, "config/centerQR"));
        return snap.exists() ? snap.val() : null;
      }
    }
    throw err;
  }
}

export async function ensureCenterQR() {
  const existing = await getCenterQR();
  if (existing && existing.token) {
    return existing;
  }
  const payload = {
    token: generateHexToken(32),
    createdAt: Date.now(),
    printedAt: null
  };
  await dbSet("config/centerQR", payload);
  return payload;
}

export async function markCenterQRPrinted() {
  await ensureCenterQR();
  const printedAt = Date.now();
  await dbUpdate("config/centerQR", { printedAt });
  return printedAt;
}

export function buildCenterCheckinUrl(token, baseHref = typeof window !== "undefined" ? window.location.href : "") {
  const url = new URL("checkin.html", baseHref);
  url.searchParams.set("token", String(token || ""));
  return url.toString();
}

export function formatTime12(timeVal) {
  if (!timeVal && timeVal !== 0) return "";
  if (typeof timeVal === "string" && (timeVal.includes("AM") || timeVal.includes("PM"))) {
    return timeVal.trim();
  }
  if (typeof timeVal === "number") {
    return new Date(timeVal).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  }
  if (typeof timeVal === "string" && timeVal.includes(":")) {
    const parts = timeVal.split(":");
    let h = parseInt(parts[0], 10);
    const m = parts[1] || "00";
    if (isNaN(h)) return timeVal;
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    const hStr = String(h).padStart(2, "0");
    return `${hStr}:${m} ${ampm}`;
  }
  return String(timeVal);
}

export function nowTime12() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}

export function formatRecordTimeHM(record) {
  if (!record || typeof record !== "object") return "";
  if (record.checkinTime) return formatTime12(record.checkinTime);
  if (record.markedAt || record.timestamp) {
    return formatTime12(record.markedAt || record.timestamp);
  }
  return "";
}

export function validateCenterCheckin({ token, centerQR, existingAttendance }) {
  if (!centerQR || !centerQR.token) {
    return { ok: false, code: "not_initialized", message: "QR not initialized. Please contact the receptionist." };
  }
  if (!token || String(token) !== String(centerQR.token)) {
    return { ok: false, code: "invalid_token", message: "Invalid or outdated QR. Please scan the current QR at the gate." };
  }
  if (existingAttendance && existingAttendance.status) {
    const recordedTime = formatRecordTimeHM(existingAttendance) || "earlier today";
    if (existingAttendance.source === "manual") {
      return {
        ok: false,
        code: "manual_override",
        message: `Attendance already recorded by the receptionist at ${recordedTime}`,
        recordedTime
      };
    }
    if (existingAttendance.source === "qr") {
      return {
        ok: false,
        code: "already_checked_in",
        message: `✅ Already checked in today at ${recordedTime}`,
        recordedTime
      };
    }
    return {
      ok: false,
      code: "already_checked_in",
      message: `✅ Already checked in today at ${recordedTime}`,
      recordedTime
    };
  }
  return { ok: true };
}

export function objectToList(obj, idField = "id") {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj).map(([key, val]) => ({
    [idField]: key,
    ...(val && typeof val === "object" ? val : { value: val })
  }));
}

// ============================================================================
// WEEKLY CONTENT AUTO-CLEANUP (Deletes entries older than 7 days)
// ============================================================================
export async function cleanupWeeklyContent() {
  try {
    const data = await dbGet("weeklyContent");
    if (!data) return 0;
    const now = Date.now();
    const sevenDaysMs = 7 * 86400000;
    const updates = {};
    let removed = 0;

    Object.entries(data).forEach(([id, item]) => {
      if (!item) return;
      let refTime = item.createdAt || 0;
      if (item.weekStart && /^\d{4}-\d{2}-\d{2}$/.test(item.weekStart)) {
        refTime = new Date(item.weekStart + "T00:00:00").getTime();
      }
      if (refTime > 0 && now - refTime > sevenDaysMs) {
        updates[`weeklyContent/${id}`] = null;
        removed += 1;
      }
    });

    if (removed > 0) {
      await dbUpdate("", updates);
    }
    return removed;
  } catch {
    return 0;
  }
}

// ============================================================================
// TIME PARSING HELPERS (for batch timing & attendance auto-absent)
// ============================================================================
export function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const s = String(timeStr).trim().toUpperCase();
  const match12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = parseInt(match12[2], 10);
    const mer = match12[3];
    if (mer === "PM" && h < 12) h += 12;
    if (mer === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  const match24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
  }
  return null;
}

export function format24To12(time24) {
  if (!time24 || !/^\d{2}:\d{2}$/.test(time24)) return time24 || "";
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const mer = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${mStr} ${mer}`;
}

export function getBatchEndMinutes(batch) {
  if (!batch) return null;
  if (batch.endTime) {
    const mins = parseTimeToMinutes(batch.endTime);
    if (mins !== null) return mins;
  }
  const timing = String(batch.timing || "");
  const parts = timing.split(/[-–to]+/i);
  if (parts.length >= 2) {
    const mins = parseTimeToMinutes(parts[parts.length - 1]);
    if (mins !== null) return mins;
  }
  return null;
}

// ============================================================================
// SELF-CONTAINED CLIENT-SIDE QR GENERATOR (No CDN, No External API)
// Supports Byte-mode ECC-L across QR Versions 1-10 -> DataURL
// ============================================================================
const QR_GF_EXP = new Uint8Array(512);
const QR_GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    QR_GF_EXP[i] = x;
    QR_GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    QR_GF_EXP[i] = QR_GF_EXP[i - 255];
  }
})();

function qrGfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return QR_GF_EXP[QR_GF_LOG[a] + QR_GF_LOG[b]];
}

function qrRsPoly(ecCount) {
  let poly = [1];
  for (let i = 0; i < ecCount; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = QR_GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= qrGfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function qrRsEncode(data, ecCount) {
  const gen = qrRsPoly(ecCount);
  const res = new Uint8Array(data.length + ecCount);
  res.set(data);
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        res[i + j] ^= qrGfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// [version]: { totalCodewords, ecPerBlock, blocks: [group1Count, group1Data, group2Count, group2Data], align }
const QR_VERSIONS_L = {
  1: { total: 26, ec: 7, blocks: [1, 19, 0, 0], align: [] },
  2: { total: 44, ec: 10, blocks: [1, 34, 0, 0], align: [6, 18] },
  3: { total: 70, ec: 15, blocks: [1, 55, 0, 0], align: [6, 22] },
  4: { total: 100, ec: 20, blocks: [1, 80, 0, 0], align: [6, 26] },
  5: { total: 134, ec: 26, blocks: [1, 108, 0, 0], align: [6, 30] },
  6: { total: 172, ec: 18, blocks: [2, 68, 0, 0], align: [6, 34] },
  7: { total: 196, ec: 20, blocks: [2, 78, 0, 0], align: [6, 22, 38] },
  8: { total: 242, ec: 24, blocks: [2, 97, 0, 0], align: [6, 24, 42] },
  9: { total: 292, ec: 30, blocks: [2, 116, 0, 0], align: [6, 26, 46] },
  10: { total: 346, ec: 18, blocks: [2, 68, 2, 69], align: [6, 28, 50] }
};

function qrFormatBits(maskPattern) {
  // ECC Level L (01) + 3-bit mask -> BCH(15, 5)
  const data = (1 << 3) | maskPattern;
  let rem = data << 10;
  const gen = 0x537;
  for (let i = 14; i >= 10; i--) {
    if (rem & (1 << i)) rem ^= gen << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function qrVersionBits(version) {
  let rem = version << 12;
  const gen = 0x1f25;
  for (let i = 17; i >= 12; i--) {
    if (rem & (1 << i)) rem ^= gen << (i - 12);
  }
  return (version << 12) | rem;
}

export function buildQRMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let version = 1;
  while (version <= 10) {
    const spec = QR_VERSIONS_L[version];
    const capacityBytes = spec.blocks[0] * spec.blocks[1] + spec.blocks[2] * spec.blocks[3];
    const lenBits = version < 10 ? 8 : 16;
    const neededBits = 4 + lenBits + bytes.length * 8;
    if (neededBits <= capacityBytes * 8) break;
    version += 1;
  }
  if (version > 10) {
    throw new Error("QR payload exceeds supported length.");
  }

  const spec = QR_VERSIONS_L[version];
  const dataCapacity = spec.blocks[0] * spec.blocks[1] + spec.blocks[2] * spec.blocks[3];
  const bitBuf = [];
  const pushBits = (val, count) => {
    for (let i = count - 1; i >= 0; i--) {
      bitBuf.push((val >> i) & 1);
    }
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);
  const terminator = Math.min(4, dataCapacity * 8 - bitBuf.length);
  pushBits(0, terminator);
  while (bitBuf.length % 8 !== 0) bitBuf.push(0);
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bitBuf.length < dataCapacity * 8) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx += 1;
  }

  const dataBytes = new Uint8Array(dataCapacity);
  for (let i = 0; i < dataCapacity; i++) {
    let v = 0;
    for (let b = 0; b < 8; b++) v = (v << 1) | bitBuf[i * 8 + b];
    dataBytes[i] = v;
  }

  // Split into RS blocks & interleave
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let g = 0; g < 2; g++) {
    const count = spec.blocks[g * 2];
    const len = spec.blocks[g * 2 + 1];
    for (let c = 0; c < count; c++) {
      const slice = dataBytes.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(slice);
      ecBlocks.push(qrRsEncode(slice, spec.ec));
    }
  }

  const finalCodewords = [];
  const maxDataLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) finalCodewords.push(blk[i]);
    }
  }
  for (let i = 0; i < spec.ec; i++) {
    for (const ec of ecBlocks) {
      finalCodewords.push(ec[i]);
    }
  }

  const size = version * 4 + 17;
  const matrix = Array.from({ length: size }, () => new Int8Array(size).fill(-1));
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

  const setModule = (r, c, dark, func = true) => {
    matrix[r][c] = dark ? 1 : 0;
    if (func) isFunc[r][c] = 1;
  };

  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inBorder = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const dark =
          inBorder &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setModule(r, c, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Alignment patterns
  const centers = spec.align;
  for (const r0 of centers) {
    for (const c0 of centers) {
      if (isFunc[r0][c0]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setModule(r0 + dr, c0 + dc, dark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunc[6][i]) setModule(6, i, i % 2 === 0);
    if (!isFunc[i][6]) setModule(i, 6, i % 2 === 0);
  }

  // Dark module & reserve format info
  setModule(size - 8, 8, true);
  for (let i = 0; i < 9; i++) {
    if (!isFunc[8][i]) setModule(8, i, false);
    if (!isFunc[i][8]) setModule(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunc[8][size - 1 - i]) setModule(8, size - 1 - i, false);
    if (!isFunc[size - 1 - i][8]) setModule(size - 1 - i, 8, false);
  }

  // Version info for >= 7
  if (version >= 7) {
    const vBits = qrVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vBits >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setModule(r, c, bit);
      setModule(c, r, bit);
    }
  }

  // Place data bits (zigzag upward/downward right-to-left)
  const totalBits = [];
  for (const cw of finalCodewords) {
    for (let b = 7; b >= 0; b--) totalBits.push((cw >> b) & 1);
  }
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (!isFunc[r][c]) {
          const bit = bitIndex < totalBits.length ? totalBits[bitIndex++] : 0;
          matrix[r][c] = bit;
        }
      }
    }
  }

  // Evaluate mask 0..7 and select lowest penalty
  const maskFns = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  let bestMask = 0;
  let bestScore = Infinity;
  let bestMatrix = null;

  for (let m = 0; m < 8; m++) {
    const candidate = matrix.map((row) => Int8Array.from(row));
    const fn = maskFns[m];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunc[r][c] && fn(r, c)) {
          candidate[r][c] ^= 1;
        }
      }
    }
    const fBits = qrFormatBits(m);
    for (let i = 0; i < 6; i++) candidate[8][i] = (fBits >> i) & 1;
    candidate[8][7] = (fBits >> 6) & 1;
    candidate[8][8] = (fBits >> 7) & 1;
    candidate[7][8] = (fBits >> 8) & 1;
    for (let i = 9; i < 15; i++) candidate[14 - i][8] = (fBits >> i) & 1;
    for (let i = 0; i < 8; i++) candidate[size - 1 - i][8] = (fBits >> i) & 1;
    for (let i = 8; i < 15; i++) candidate[8][size - 15 + i] = (fBits >> i) & 1;

    // Simple penalty: runs >= 5 + 2x2 blocks
    let score = 0;
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (candidate[r][c] === candidate[r][c - 1]) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (candidate[r][c] === candidate[r - 1][c]) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = candidate[r][c];
        if (v === candidate[r + 1][c] && v === candidate[r][c + 1] && v === candidate[r + 1][c + 1]) {
          score += 3;
        }
      }
    }
    if (score < bestScore) {
      bestScore = score;
      bestMask = m;
      bestMatrix = candidate;
    }
  }

  return bestMatrix;
}

export function generateQR(text) {
  const mat = buildQRMatrix(text);
  const n = mat.length;
  const quiet = 4;
  const scale = 6;
  const px = (n + quiet * 2) * scale;

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = "#0F172A";
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (mat[r][c] === 1) {
            ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
          }
        }
      }
      return canvas.toDataURL("image/png");
    }
  }

  let rects = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mat[r][c] === 1) {
        rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1" fill="#0F172A"/>`;
      }
    }
  }
  const view = n + quiet * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}" width="260" height="260"><rect width="100%" height="100%" fill="#fff"/>${rects}</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// ============================================================================
// v7 UTILITIES: DEBOUNCE, MONTH PICKER HELPERS & FEE STATUS
// ============================================================================
export function debounce(fn, delay = 250) {
  let timer = null;
  return function (...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, delay);
  };
}

export function getPreviousMonthYM(ym) {
  const base = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : monthKey();
  const [y, m] = base.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function getRecentMonthsList(count = 13, fromYm = monthKey()) {
  const [y, m] = fromYm.split("-").map(Number);
  const list = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    list.push({ ym, label: formatMonthLabel(ym) });
  }
  return list;
}

export function computeFeeDueInfo(ym, feeRecord) {
  if (feeRecord) {
    const modeLabel = (feeRecord.mode || "cash").toUpperCase();
    return {
      status: "paid",
      label: `Paid (${modeLabel})`,
      badgeClass: "badge-success"
    };
  }
  const todayStr = today();
  const curYm = monthKey(todayStr);
  const dueDateStr = `${ym}-10`;
  if (todayStr > dueDateStr) {
    const tDate = new Date(todayStr + "T00:00:00");
    const dDate = new Date(dueDateStr + "T00:00:00");
    const diffDays = Math.max(1, Math.floor((tDate.getTime() - dDate.getTime()) / 86400000));
    return {
      status: "overdue",
      days: diffDays,
      label: `Overdue (${diffDays} day${diffDays === 1 ? "" : "s"})`,
      badgeClass: "badge-danger"
    };
  }
  if (ym === curYm) {
    return {
      status: "pending",
      label: "Pending (Due 1st–10th)",
      badgeClass: "badge-gold"
    };
  }
  return {
    status: "upcoming",
    label: "Pending",
    badgeClass: "badge-muted"
  };
}

export function getDefaulters(students, fees, batches) {
  const todayStr = today();
  const todayDate = new Date(todayStr + "T00:00:00");
  if (todayDate.getDate() <= 10) return [];

  const curYm = monthKey(todayStr);
  const prevYm = getPreviousMonthYM(curYm);
  const [prevY, prevM] = prevYm.split("-").map(Number);
  const prevMonthJoiningLimit = `${prevY}-${String(prevM).padStart(2, "0")}-01`;

  const activeStudents = Array.isArray(students) ? students.filter((s) => s.active !== false) : [];
  const feeRecords = Array.isArray(fees) ? fees : [];
  const batchMap = new Map((Array.isArray(batches) ? batches : []).map((b) => [b.id, b]));

  const defaulters = [];
  for (const stu of activeStudents) {
    if (!stu.joiningDate || stu.joiningDate > prevMonthJoiningLimit) {
      continue;
    }
    const paidForPrevMonth = feeRecords.some((f) => f.studentId === stu.id && f.month === prevYm);
    if (!paidForPrevMonth) {
      const batch = batchMap.get(stu.batchId) || null;
      const amount = batch ? Number(batch.monthlyFees) || 0 : 0;
      defaulters.push({
        student: stu,
        batch,
        prevYm,
        prevMonthLabel: formatMonthLabel(prevYm),
        amount
      });
    }
  }
  return defaulters;
}

export function buildFeeReminderMessage(student, batch, prevYm) {
  const amount = batch ? Number(batch.monthlyFees) || 0 : 0;
  const monthLbl = formatMonthLabel(prevYm);
  return `Dear Parent, gentle fee reminder from ${CONFIG.tuitionName}: Tuition fee of ${formatINR(amount)} for ${monthLbl} for ${student.name} (${student.id}) is overdue. Please pay at your earliest convenience. Thank you!`;
}

// ============================================================================
// v7 REUSABLE POPUP SYSTEM & SHARED DETAIL POPUPS
// ============================================================================
let activePopupEscHandler = null;

export function closePopup() {
  const backdrop = document.getElementById("jch-global-popup");
  if (backdrop) {
    backdrop.classList.remove("open");
  }
  if (activePopupEscHandler) {
    document.removeEventListener("keydown", activePopupEscHandler);
    activePopupEscHandler = null;
  }
}

export function openPopup(title, htmlContent, opts = {}) {
  let backdrop = document.getElementById("jch-global-popup");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "jch-global-popup";
    backdrop.className = "modal-backdrop";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.innerHTML = `
      <div class="modal" id="jch-global-popup-dialog">
        <div class="modal-head">
          <h3 id="jch-global-popup-title">Details</h3>
          <button type="button" id="jch-global-popup-close" class="btn btn-outline btn-sm btn-inline popup-close-btn" aria-label="Close popup" style="min-width:44px; min-height:44px;">✕</button>
        </div>
        <div id="jch-global-popup-body"></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) {
        closePopup();
      }
    });
    backdrop.querySelector("#jch-global-popup-close").addEventListener("click", closePopup);
  }

  const dialog = backdrop.querySelector("#jch-global-popup-dialog");
  dialog.classList.toggle("modal-wide", Boolean(opts.wide));
  backdrop.querySelector("#jch-global-popup-title").textContent = title || "Details";
  const body = backdrop.querySelector("#jch-global-popup-body");
  body.innerHTML = htmlContent || "";
  backdrop.classList.add("open");

  if (activePopupEscHandler) {
    document.removeEventListener("keydown", activePopupEscHandler);
  }
  activePopupEscHandler = (e) => {
    if (e.key === "Escape") closePopup();
  };
  document.addEventListener("keydown", activePopupEscHandler);

  return { backdrop, body, close: closePopup };
}

function renderPhoneRowHtml(label, phone, isPrimary) {
  const digits = String(phone || "").replace(/\D/g, "");
  const telHref = digits ? `tel:${digits}` : "";
  return `
    <div class="phone-item ${isPrimary ? "phone-item-primary" : ""}">
      <div>
        <div class="phone-item-head">
          <strong>${label}</strong>
          ${isPrimary ? `<span class="badge badge-primary">Primary</span>` : ""}
        </div>
        <div class="mono" style="margin-top:4px; font-size:15px;">
          ${phone ? escapeHtml(phone) : `<span class="text-muted">Not on file</span>`}
        </div>
      </div>
      <div class="phone-item-actions">
        ${
          telHref
            ? `<a href="${escapeHtml(telHref)}" class="btn btn-outline btn-sm btn-inline">📞 Call</a>`
            : `<span class="badge badge-muted">No number</span>`
        }
        ${
          phone
            ? `<button type="button" class="btn btn-wa btn-sm btn-inline popup-stu-wa-btn" data-phone="${escapeHtml(phone)}">💬 WhatsApp</button>`
            : ""
        }
      </div>
    </div>
  `;
}

export async function openStudentDetailPopup(student, options = {}) {
  if (!student) return;
  const {
    batchName = "--",
    sessionName = "--",
    feesList = null,
    attendanceMap = null,
    testsList = null,
    testResultsMap = null,
    canManage = false,
    allowMessageComposer = true,
    onEdit = null,
    onResetPassword = null,
    onDelete = null
  } = options;

  const { body, close } = openPopup(`${student.name} (${student.id})`, `<p class="text-muted">Loading student profile...</p>`, {
    wide: true
  });

  let resolvedFees = Array.isArray(feesList) ? feesList : null;
  let resolvedAttendance = attendanceMap && typeof attendanceMap === "object" ? attendanceMap : null;
  let resolvedTests = Array.isArray(testsList) ? testsList : null;
  let resolvedResults = testResultsMap && typeof testResultsMap === "object" ? testResultsMap : null;

  try {
    const fetches = await Promise.all([
      resolvedFees ? Promise.resolve(null) : dbGet("fees").catch(() => null),
      resolvedAttendance ? Promise.resolve(null) : dbGet("attendance").catch(() => null),
      resolvedTests ? Promise.resolve(null) : dbGet("tests").catch(() => null),
      resolvedResults ? Promise.resolve(null) : dbGet("testResults").catch(() => null)
    ]);
    if (!resolvedFees) resolvedFees = objectToList(fetches[0]);
    if (!resolvedAttendance) resolvedAttendance = fetches[1] || {};
    if (!resolvedTests) resolvedTests = objectToList(fetches[2]);
    if (!resolvedResults) resolvedResults = fetches[3] || {};
  } catch {
    resolvedFees = resolvedFees || [];
    resolvedAttendance = resolvedAttendance || {};
    resolvedTests = resolvedTests || [];
    resolvedResults = resolvedResults || {};
  }

  // Current month fee status
  const curYm = monthKey();
  const monthFee = resolvedFees.find((f) => f.studentId === student.id && f.month === curYm) || null;
  const feeInfo = computeFeeDueInfo(curYm, monthFee);

  // Last 10 days attendance for this student's batch
  const attDays = [];
  Object.entries(resolvedAttendance || {}).forEach(([key, stuMap]) => {
    if (!student.batchId || !key.endsWith("_" + student.batchId)) return;
    const dateStr = key.split("_")[0];
    const rec = stuMap && stuMap[student.id];
    if (rec && rec.status) {
      attDays.push({
        date: dateStr,
        status: rec.status,
        source: rec.source || "manual",
        timeHM: formatRecordTimeHM(rec)
      });
    }
  });
  attDays.sort((a, b) => b.date.localeCompare(a.date));
  const last10Att = attDays.slice(0, 10);

  // Last 5 test results for this student's batch
  const batchTests = resolvedTests
    .filter((t) => t.batchId === student.batchId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 5);

  const manageButtonsHtml = canManage
    ? `<div class="popup-actions-bar">
        ${onEdit ? `<button type="button" class="btn btn-outline" id="popup-stu-edit-btn">✏ Edit</button>` : ""}
        ${onResetPassword ? `<button type="button" class="btn btn-gold" id="popup-stu-reset-btn">🔑 Reset Password</button>` : ""}
        ${onDelete ? `<button type="button" class="btn btn-danger" id="popup-stu-del-btn">🗑 Delete</button>` : ""}
      </div>`
    : "";

  const messageComposerHtml = allowMessageComposer
    ? `<div class="popup-section">
        <h4 class="popup-section-title">Quick WhatsApp Message</h4>
        <div class="form-group" style="margin-bottom:10px;">
          <textarea id="popup-stu-wa-msg" rows="2" placeholder="Write message for parent/student...">Hello, update regarding ${escapeHtml(student.name)} (${escapeHtml(student.id)}) at ${escapeHtml(CONFIG.tuitionName)}: </textarea>
        </div>
        <div class="wa-send-group">
          <select id="popup-stu-wa-target" aria-label="WhatsApp target phone">
            <option value="parental" selected>Parental (Primary)</option>
            <option value="father">Father</option>
            <option value="mother">Mother</option>
            <option value="personal">Personal</option>
          </select>
          <button type="button" id="popup-stu-wa-send-btn" class="btn btn-wa">💬 Send on WhatsApp</button>
        </div>
      </div>`
    : "";

  body.innerHTML = `
    <div class="popup-section">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <span class="badge badge-primary">${escapeHtml(batchName)}</span>
        <span class="badge badge-muted">Session: ${escapeHtml(sessionName)}</span>
        <span class="badge ${student.mode === "online" ? "badge-gold" : "badge-muted"}">Mode: ${student.mode === "online" ? "Online" : "Offline"}</span>
        <span class="badge badge-muted">Joined: ${escapeHtml(student.joiningDate || "--")}</span>
        ${student.password && canManage ? `<span class="badge badge-muted mono">Pwd: ${escapeHtml(student.password)}</span>` : ""}
      </div>
    </div>

    <div class="popup-section">
      <h4 class="popup-section-title">This Month's Fee (${escapeHtml(formatMonthLabel(curYm))})</h4>
      <div class="popup-mini-row">
        <span>Status</span>
        <span class="badge ${feeInfo.badgeClass}">${escapeHtml(feeInfo.label)}</span>
      </div>
      ${
        monthFee
          ? `<div class="popup-mini-row" style="margin-top:6px;">
              <span>Paid ${escapeHtml(formatINR(monthFee.amount))}</span>
              <span>${monthFee.paidAt ? escapeHtml(new Date(monthFee.paidAt).toLocaleDateString("en-IN")) : ""}</span>
            </div>`
          : ""
      }
    </div>

    <div class="popup-section">
      <h4 class="popup-section-title">Contact Numbers</h4>
      <div class="phone-list">
        ${renderPhoneRowHtml("👨‍👩‍👧 Parental (Primary)", student.parentalPhone, true)}
        ${renderPhoneRowHtml("👨 Father", student.fatherPhone, false)}
        ${renderPhoneRowHtml("👩 Mother", student.motherPhone, false)}
        ${renderPhoneRowHtml("📱 Personal", student.personalPhone, false)}
      </div>
    </div>

    ${messageComposerHtml}

    <div class="popup-section">
      <h4 class="popup-section-title">Recent Attendance (Last 10 Days)</h4>
      ${
        last10Att.length
          ? `<div class="popup-mini-list">
              ${last10Att
                .map((d) => {
                  const cls = d.status === "present" ? "badge-success" : d.status === "online" ? "badge-primary" : "badge-danger";
                  const txt =
                    d.status === "present"
                      ? `✓ Present${d.timeHM ? ` (${d.timeHM})` : ""}`
                      : d.status === "online"
                        ? "🌐 Online"
                        : "Absent";
                  return `<div class="popup-mini-row">
                    <strong>${escapeHtml(d.date)}</strong>
                    <span class="badge ${cls}">${escapeHtml(txt)}</span>
                  </div>`;
                })
                .join("")}
            </div>`
          : `<p class="text-muted" style="margin:0;">No recent attendance recorded.</p>`
      }
    </div>

    <div class="popup-section">
      <h4 class="popup-section-title">Recent Test Results (Last 5)</h4>
      ${
        batchTests.length
          ? `<div class="popup-mini-list">
              ${batchTests
                .map((t) => {
                  const resMap = resolvedResults[t.id];
                  const rec = resMap ? resMap[student.id] : null;
                  let badge = `<span class="badge badge-muted">Pending</span>`;
                  if (resMap) {
                    if (rec && rec.status === "present" && rec.marks !== null && rec.marks !== undefined) {
                      badge = `<span class="badge badge-success">${escapeHtml(rec.marks)} / ${escapeHtml(t.maxMarks)}</span>`;
                    } else {
                      badge = `<span class="badge badge-danger">Absent</span>`;
                    }
                  }
                  return `<div class="popup-mini-row">
                    <div>
                      <strong>${escapeHtml(t.name)}</strong>
                      <div class="text-muted">${escapeHtml(t.topic || "")}</div>
                    </div>
                    ${badge}
                  </div>`;
                })
                .join("")}
            </div>`
          : `<p class="text-muted" style="margin:0;">No routine tests found for this batch.</p>`
      }
    </div>

    ${manageButtonsHtml}
  `;

  body.querySelectorAll(".popup-stu-wa-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const msgEl = body.querySelector("#popup-stu-wa-msg");
      const msg = (msgEl && msgEl.value.trim()) || `Hello, message regarding ${student.name} (${student.id}) from ${CONFIG.tuitionName}.`;
      openWhatsApp(btn.dataset.phone, msg);
    });
  });

  const sendBtn = body.querySelector("#popup-stu-wa-send-btn");
  if (sendBtn) {
    sendBtn.addEventListener("click", () => {
      const pref = body.querySelector("#popup-stu-wa-target").value || "parental";
      const msgEl = body.querySelector("#popup-stu-wa-msg");
      const msg = (msgEl && msgEl.value.trim()) || `Hello, message regarding ${student.name} (${student.id}) from ${CONFIG.tuitionName}.`;
      sendStudentWhatsApp(student, msg, pref);
    });
  }

  const editBtn = body.querySelector("#popup-stu-edit-btn");
  if (editBtn && onEdit) {
    editBtn.addEventListener("click", () => {
      close();
      onEdit(student);
    });
  }
  const resetBtn = body.querySelector("#popup-stu-reset-btn");
  if (resetBtn && onResetPassword) {
    resetBtn.addEventListener("click", async () => {
      await onResetPassword(student);
      close();
    });
  }
  const delBtn = body.querySelector("#popup-stu-del-btn");
  if (delBtn && onDelete) {
    delBtn.addEventListener("click", async () => {
      await onDelete(student);
      close();
    });
  }
}

export function openFeeDetailPopup(fee, { student = null, batchName = "--" } = {}) {
  if (!fee) return;
  const paidDate = fee.paidAt ? new Date(fee.paidAt).toLocaleString("en-IN") : today();
  const monthLabel = formatMonthLabel(fee.month);
  const receiptText = [
    `*${CONFIG.tuitionName} — Fee Receipt*`,
    `Receipt ID: ${fee.id || "--"}`,
    `Date: ${paidDate}`,
    `Student: ${fee.studentName} (${fee.studentId})`,
    `Batch: ${batchName}`,
    `Month: ${monthLabel}`,
    `Amount Paid: ${formatINR(fee.amount)} (${(fee.mode || "cash").toUpperCase()})`,
    `Marked By: ${fee.markedBy || "Receptionist"}`,
    `Status: PAID`,
    `WhatsApp: ${CONFIG.whatsappDisplay}`
  ].join("\n");

  const { body } = openPopup(
    `Fee Receipt — ${fee.studentName}`,
    `
    <div class="invoice-box">
      <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:12px; margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <img src="${CONFIG.logoPath}" alt="Logo" style="width:42px; height:42px; object-fit:contain;" />
          <div>
            <strong style="color:var(--primary); font-size:1.05rem;">${escapeHtml(CONFIG.tuitionName)}</strong>
            <div class="text-muted">WhatsApp: ${escapeHtml(CONFIG.whatsappDisplay)}</div>
          </div>
        </div>
        <span class="badge badge-success">PAID</span>
      </div>
      <div class="popup-mini-list">
        <div class="popup-mini-row"><span>Student</span><strong>${escapeHtml(fee.studentName)} (${escapeHtml(fee.studentId)})</strong></div>
        <div class="popup-mini-row"><span>Batch</span><strong>${escapeHtml(batchName)}</strong></div>
        <div class="popup-mini-row"><span>Month</span><strong>${escapeHtml(monthLabel)}</strong></div>
        <div class="popup-mini-row"><span>Amount</span><strong style="color:var(--primary); font-size:1.05rem;">${escapeHtml(formatINR(fee.amount))}</strong></div>
        <div class="popup-mini-row"><span>Mode</span><span class="badge badge-primary">${escapeHtml((fee.mode || "cash").toUpperCase())}</span></div>
        <div class="popup-mini-row"><span>Paid At</span><span>${escapeHtml(paidDate)}</span></div>
        <div class="popup-mini-row"><span>Marked By</span><span>${escapeHtml(fee.markedBy || "--")}</span></div>
      </div>
    </div>
    <div style="display:flex; flex-direction:column; gap:10px;">
      <button type="button" id="popup-copy-receipt-btn" class="btn btn-outline btn-block">📋 Copy Receipt Text</button>
      <div class="wa-send-group">
        <select id="popup-fee-wa-target" aria-label="Select WhatsApp recipient phone">
          <option value="parental" selected>Parental (Primary)</option>
          <option value="father">Father</option>
          <option value="mother">Mother</option>
          <option value="personal">Personal</option>
        </select>
        <button type="button" id="popup-wa-receipt-btn" class="btn btn-wa">💬 Send on WhatsApp</button>
      </div>
    </div>
  `
  );

  body.querySelector("#popup-copy-receipt-btn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(receiptText);
    } catch {
      const t = document.createElement("textarea");
      t.value = receiptText;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    toast("Receipt copied to clipboard.", "success");
  });

  body.querySelector("#popup-wa-receipt-btn").addEventListener("click", () => {
    const pref = body.querySelector("#popup-fee-wa-target").value || "parental";
    sendStudentWhatsApp(student, receiptText, pref);
  });
}

export function openAttendanceDetailPopup({
  student,
  batchName = "--",
  dateStr = today(),
  record = null,
  canOverride = false,
  onOverride = null
}) {
  if (!student) return;
  const status = record ? record.status : "unmarked";
  let sourceDisplay = "--";
  if (record) {
    if (status === "online") sourceDisplay = "Online";
    else if (record.source === "qr") sourceDisplay = "QR Scan";
    else if (record.autoMarked) sourceDisplay = "Auto-Absent";
    else sourceDisplay = "Manual";
  }
  const checkinTimeVal = record && record.checkinTime
    ? record.checkinTime
    : record && record.markedAt
      ? new Date(record.markedAt).toLocaleTimeString("en-IN", { hour12: false })
      : "--";
  const markedByVal = record && record.source === "qr"
    ? "Student QR Scan"
    : record && record.markedBy
      ? record.markedBy
      : "--";

  const statusBadgeCls =
    status === "present"
      ? "badge-success"
      : status === "online"
        ? "badge-primary"
        : status === "absent"
          ? "badge-danger"
          : "badge-muted";

  const { body, close } = openPopup(
    `${student.name} (${student.id})`,
    `
    <div class="popup-section">
      <div class="popup-mini-list">
        <div class="popup-mini-row"><span>Batch</span><strong>${escapeHtml(batchName)}</strong></div>
        <div class="popup-mini-row"><span>Date</span><strong class="mono">${escapeHtml(dateStr)}</strong></div>
        <div class="popup-mini-row"><span>Status</span><span class="badge ${statusBadgeCls}" style="text-transform:capitalize;">${escapeHtml(status)}</span></div>
        <div class="popup-mini-row"><span>Source</span><strong>${escapeHtml(sourceDisplay)}</strong></div>
        <div class="popup-mini-row"><span>Check-in Time</span><strong class="mono">${escapeHtml(checkinTimeVal)}</strong></div>
        <div class="popup-mini-row"><span>Marked By</span><strong>${escapeHtml(markedByVal)}</strong></div>
      </div>
    </div>
    ${
      canOverride && onOverride
        ? `<div class="popup-section">
            <h4 class="popup-section-title">Manual Override</h4>
            <div class="popup-actions-bar">
              <button type="button" class="btn btn-success att-ov-btn" data-status="present">✓ Present</button>
              <button type="button" class="btn btn-primary att-ov-btn" data-status="online">🌐 Online</button>
              <button type="button" class="btn btn-danger att-ov-btn" data-status="absent">✕ Absent</button>
            </div>
          </div>`
        : ""
    }
  `
  );

  if (canOverride && onOverride) {
    body.querySelectorAll(".att-ov-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await onOverride(btn.dataset.status);
        close();
      });
    });
  }
}

export function openLeaveDetailPopup(leave, { batchName = "--", canReview = false, onApprove = null, onReject = null } = {}) {
  if (!leave) return;
  const st = leave.status || "pending";
  const badgeCls = st === "approved" ? "badge-success" : st === "rejected" ? "badge-danger" : "badge-gold";
  const appliedLabel = leave.appliedAt ? new Date(leave.appliedAt).toLocaleString("en-IN") : "--";

  const { body, close } = openPopup(
    `Leave — ${leave.studentName || leave.studentId}`,
    `
    <div class="popup-mini-list">
      <div class="popup-mini-row"><span>Student</span><strong>${escapeHtml(leave.studentName || "--")} (${escapeHtml(leave.studentId)})</strong></div>
      <div class="popup-mini-row"><span>Batch</span><strong>${escapeHtml(batchName)}</strong></div>
      <div class="popup-mini-row"><span>From Date</span><strong class="mono">${escapeHtml(leave.fromDate)}</strong></div>
      <div class="popup-mini-row"><span>To Date</span><strong class="mono">${escapeHtml(leave.toDate)}</strong></div>
      <div class="popup-mini-row"><span>Status</span><span class="badge ${badgeCls}" style="text-transform:capitalize;">${escapeHtml(st)}</span></div>
      <div class="popup-mini-row"><span>Applied At</span><span>${escapeHtml(appliedLabel)}</span></div>
    </div>
    <div class="popup-section" style="margin-top:14px;">
      <h4 class="popup-section-title">Reason</h4>
      <p style="margin:0; white-space:pre-wrap;">${escapeHtml(leave.reason || "--")}</p>
    </div>
    ${
      canReview && onApprove && onReject
        ? `<div class="popup-actions-bar">
            <button type="button" class="btn btn-success" id="popup-leave-approve-btn">✓ Approve</button>
            <button type="button" class="btn btn-danger" id="popup-leave-reject-btn">✕ Reject</button>
          </div>`
        : ""
    }
  `
  );

  if (canReview && onApprove && onReject) {
    body.querySelector("#popup-leave-approve-btn").addEventListener("click", async () => {
      await onApprove(leave);
      close();
    });
    body.querySelector("#popup-leave-reject-btn").addEventListener("click", async () => {
      await onReject(leave);
      close();
    });
  }
}

export function openExpenseDetailPopup(expense, { canDelete = false, onDelete = null } = {}) {
  if (!expense) return;
  const addedAtLabel = expense.addedAt ? new Date(expense.addedAt).toLocaleString("en-IN") : "--";
  const { body, close } = openPopup(
    `Expense — ${formatINR(expense.amount)}`,
    `
    <div class="popup-mini-list">
      <div class="popup-mini-row"><span>Amount</span><strong style="color:var(--danger); font-size:1.1rem;">${escapeHtml(formatINR(expense.amount))}</strong></div>
      <div class="popup-mini-row"><span>Category</span><span class="badge badge-muted" style="text-transform:capitalize;">${escapeHtml(expense.category || "other")}</span></div>
      <div class="popup-mini-row"><span>Date</span><strong class="mono">${escapeHtml(expense.date || "--")}</strong></div>
      <div class="popup-mini-row"><span>Added By</span><strong>${escapeHtml(expense.addedBy || "--")}</strong></div>
      <div class="popup-mini-row"><span>Added At</span><span>${escapeHtml(addedAtLabel)}</span></div>
    </div>
    ${
      canDelete && onDelete
        ? `<div class="popup-actions-bar">
            <button type="button" class="btn btn-danger" id="popup-expense-del-btn">🗑 Delete Expense</button>
          </div>`
        : ""
    }
  `
  );

  if (canDelete && onDelete) {
    body.querySelector("#popup-expense-del-btn").addEventListener("click", async () => {
      await onDelete(expense);
      close();
    });
  }
}

export function openTestResultDetailPopup({ test, student, record = null, currentMarksValue = "", onFocusInput = null }) {
  if (!test || !student) return;
  const hasVal = currentMarksValue !== "" && currentMarksValue !== null && currentMarksValue !== undefined;
  const marksNum = hasVal ? Number(currentMarksValue) : record && record.status === "present" ? Number(record.marks) : null;
  const isPresent = marksNum !== null && !Number.isNaN(marksNum);
  const pct = isPresent && Number(test.maxMarks) > 0 ? Math.round((marksNum / Number(test.maxMarks)) * 100) : 0;

  const { body, close } = openPopup(
    `${student.name} (${student.id})`,
    `
    <div class="popup-mini-list">
      <div class="popup-mini-row"><span>Test Name</span><strong>${escapeHtml(test.name)}</strong></div>
      <div class="popup-mini-row"><span>Topic</span><strong>${escapeHtml(test.topic || "--")}</strong></div>
      <div class="popup-mini-row"><span>Max Marks</span><strong>${escapeHtml(test.maxMarks)}</strong></div>
      <div class="popup-mini-row"><span>Marks Obtained</span><strong>${isPresent ? `${escapeHtml(marksNum)} / ${escapeHtml(test.maxMarks)}` : "Absent"}</strong></div>
      <div class="popup-mini-row"><span>Percentage</span><strong>${isPresent ? `${pct}%` : "--"}</strong></div>
      <div class="popup-mini-row"><span>Status</span><span class="badge ${isPresent ? "badge-success" : "badge-danger"}">${isPresent ? "Present" : "Absent"}</span></div>
    </div>
    ${
      onFocusInput
        ? `<div class="popup-actions-bar">
            <button type="button" class="btn btn-primary" id="popup-edit-marks-btn">✏ Edit Marks</button>
          </div>`
        : ""
    }
  `
  );

  if (onFocusInput) {
    body.querySelector("#popup-edit-marks-btn").addEventListener("click", () => {
      close();
      onFocusInput(student.id);
    });
  }
}


// ============================================================================
// SHARED UI: MOBILE DRAWER + BOTTOM TAB BAR + LOGOUT
// ============================================================================
export function initDashboardShell(onPanelSwitch) {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("sidebar-toggle");
  const overlay = document.getElementById("sidebar-overlay");

  function openDrawer() {
    if (sidebar) sidebar.classList.add("open");
    if (overlay) overlay.classList.add("open");
  }

  function closeDrawer() {
    if (sidebar) sidebar.classList.remove("open");
    if (overlay) overlay.classList.remove("open");
  }

  if (toggle && sidebar) {
    toggle.addEventListener("click", () => {
      if (sidebar.classList.contains("open")) {
        closeDrawer();
      } else {
        openDrawer();
      }
    });
  }
  if (overlay) {
    overlay.addEventListener("click", closeDrawer);
  }

  function activatePanel(target) {
    document.querySelectorAll(".nav-item").forEach((b) => {
      b.classList.toggle("active", b.dataset.panel === target);
    });
    document.querySelectorAll(".mobile-tab-btn[data-panel]").forEach((b) => {
      b.classList.toggle("active", b.dataset.panel === target);
    });
    document.querySelectorAll(".panel").forEach((p) => {
      p.classList.toggle("active", p.id === `panel-${target}`);
    });
    if (typeof onPanelSwitch === "function") {
      onPanelSwitch(target);
    }
    if (window.innerWidth < 768) {
      closeDrawer();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => activatePanel(item.dataset.panel));
  });

  document.querySelectorAll(".mobile-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "menu") {
        openDrawer();
      } else if (btn.dataset.panel) {
        activatePanel(btn.dataset.panel);
      }
    });
  });

  document.querySelectorAll("#logout-btn, #topbar-logout-btn").forEach((btn) => {
    btn.addEventListener("click", logout);
  });

  return { activatePanel, openDrawer, closeDrawer };
}

