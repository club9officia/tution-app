# Jain Commerce Hub — Tuition Management Web App (v9)

A zero-framework, mobile-first, plain HTML, pure CSS, and vanilla JavaScript (ES Modules) tuition management platform powered by **Firebase Authentication** and **Firebase Realtime Database** (CDN v10 modular SDK) with direct `wa.me` WhatsApp integration.

---

## v9 Highlights & Implementation Confirmations

1. **Complete Removal of MCQ & Assignments**:
   - **Teacher Portal (`teacher.html`, `js/teacher.js`)**: Completely removed the "MCQ Assignments" tab from sidebar and bottom navigation, Section 5 panel, prompt copy helper, JSON parsing/validation, question staging, preview modals, assignment creation form, grouped list, and submission results modal.
   - **Student Portal (`student.html`, `js/student.js`)**: Removed "Assignments" from sidebar and bottom navigation, assignment card list, interactive MCQ runner, question navigation, confirmation dialog, score screen, and answer review modal.
   - **Data Model & Rules (`firebase-rules.json`)**: Removed `/assignments` and `/assignmentSubmissions` rules completely.
   - **Shared Code & Styles (`js/app.js`, `css/style.css`)**: Removed `MCQ_PROMPT_TEXT`, `validateMCQQuestion`, `parseCorrectIndex`, `sanitizeMCQQuestion`, `openAssignmentDetailPopup`, and all `.mcq-*` styling rules.

2. **Removal of "Scan to Check-In" Button from Student Portal**:
   - Removed the "Scan to check in" button from the student home card and dashboard.
   - Students access check-in exclusively by physically scanning the center-wide QR code pasted at the coaching center gate using their phone's native camera or Google Lens.

3. **Reinforced One Check-In Per Day Per Student (`checkin.html`, `js/app.js`)**:
   - A student can be marked present at most **ONCE per day**, regardless of how many times they scan the gate QR code.
   - When a student scans the QR and logs in:
     - If `source === "qr"` already exists: displays `"✅ Already checked in today at [checkinTime]"` on a green success card without overwriting or re-writing to Firebase.
     - If `source === "manual"` already exists (marked by receptionist): displays `"Attendance already recorded by the receptionist at [checkinTime]"` without overwriting.
     - If no attendance record exists today: writes the new attendance record with `status: "present"`, `source: "qr"`, 12-hour formatted `checkinTime`, and displays `"✅ Checked in successfully at [checkinTime]"`.

---

## v8 Highlights & Implementation Confirmations

1. **Fee Defaulters List (`receptionist.html`, `admin.html`, `js/app.js`, `js/receptionist.js`, `js/admin.js`)**:
   - Lists students whose previous month's fees are unpaid after the 10th of the current month (`joiningDate <= previous_month_01`, no fee record for previous month, today > 10th).
   - Appears in **Receptionist portal** as a new tab (`⚠️ Defaulters`) and **Admin portal** as an overview card (`"N students with unpaid fees · ₹X pending"`) linking to the defaulters view.
   - Each card provides student details, overdue status, `📞 Call Parent` (using parental phone fallback chain), `💬 WhatsApp Reminder` (pre-filled reminder message), and card tap to open the Student Detail popup.
2. **Student Enrollment Modal & FAB (`receptionist.html`, `js/receptionist.js`)**:
   - The student enrollment/edit form is now hidden by default on the Students tab and opens via a floating action button (`.fab-btn`, 56×56px, bottom-right) in a full-screen mobile / centered desktop modal.
   - Supports auto-generating STD ID (`STD01`, `STD02`, ...), saving to `/students`, Edit (prefilled modal), and Delete with confirmation.
3. **Session & Batch Filter Relaxation**:
   - Removed session/batch selection requirements from QR check-in, Fees tab search, Defaulters list, and Student list (which shows all students with batch chips). Session/batch requirement is strictly retained only for student enrollment and manual attendance marking.
4. **Center-Wide Permanent QR & Core Features**:
   - Single center-wide permanent QR code (`/config/centerQR`), plain-text passwords, zero horizontal scroll, and all v1–v7 features fully intact.

---

## v6 Highlights & Implementation Confirmations

1. **Single Center-Wide Permanent QR (`/config/centerQR`)**:
   - All per-batch QR tokens and per-batch QR print links are replaced with **one permanent QR code for the entire coaching center**, stored at `/config/centerQR` (`{ token, createdAt, printedAt }`).
   - Generated **once** on first Admin login (never auto-regenerates). Only the **Admin** can explicitly regenerate it via **⋮ → 🔄 Regenerate Center QR** (behind a confirmation modal), resetting `printedAt` to `null`.
   - Both **Admin** and **Receptionist** have **🖨 Print Center QR**, which updates `/config/centerQR/printedAt` and opens `qr-print.html` (A4 & mobile print-friendly sheet with minimum `300×300px` QR code on print).
   - QR encodes `checkin.html?token=<centerQR.token>` (no `batch` parameter — batch is resolved automatically from the student's database record after login).
2. **One-Per-Day Check-In & Manual Override Rules (`checkin.html`)**:
   - Validates `/config/centerQR` (shows *"QR not initialized. Please contact the receptionist."* if missing) and compares URL `token` (shows *"Invalid or outdated QR. Please scan the current QR at the gate."* if mismatched).
   - Verifies Student ID + plain password and derives `student.batchId`.
   - Enforces one check-in per day: if `/attendance/{today}_{student.batchId}/{stdId}` already has `source: "qr"`, displays **"Already checked in today at [time]"** without overwriting; if `source: "manual"`, displays **"Attendance already recorded by receptionist at [time]"** without overwriting.
   - Otherwise writes `{ status: "present", checkinDate, checkinTime, markedAt, source: "qr" }` and displays **"✅ Attendance Marked — [Student Name] at [HH:MM]"** with batch name and date.
   - Receptionist manual Present/Online/Absent marking overwrites any QR record and sets `source: "manual"`. Tapping a student row in Receptionist Attendance opens the Attendance Detail popup (`checkinDate`, `checkinTime`, `source`, `markedBy`, override).
   - Student dashboard shows check-in time chips on present days and a **"📷 Scan to check in"** helper button (no QR image rendered for students). Teacher Attendance view displays `✓ Present (HH:MM)` + detail popup (no QR generation/printing rights).
3. **Student Phone Restructure (`parentalPhone` Primary + Fallback Chain)**:
   - `parentalPhone` is the **only required** phone field on student enrollment/edit; `fatherPhone`, `motherPhone`, and `personalPhone` are optional.
   - WhatsApp sends default to `parentalPhone` with recipient dropdowns (`Parental (Primary)`, `Father`, `Mother`, `Personal`) and fallback chain: `parentalPhone → fatherPhone → motherPhone → personalPhone → toast("No phone on file.")`.
   - Student Detail popup displays all 4 numbers clearly labeled with direct `tel:` Call and WhatsApp actions.
4. **Plain-Text Passwords, Zero Horizontal Scroll & Direct `wa.me` Links**:
   - Passwords are stored and compared as plain text under `/staff/{id}/password` and `/students/{id}/password` (`crypto.subtle` / SHA-256 removed).
   - Zero horizontal scroll (`overflow-x: hidden`), zero horizontal scrolling tables, built-in inline QR generator (`generateQR`), v4 MCQ engine (`/assignments` & `/assignmentSubmissions`), and all v3 features intact.

---

## 1. Project File Structure

- `index.html` — Multi-role Portal Login (Admin Email & Password; Staff & Student ID + plain password)
- `admin.html` & `js/admin.js` — Admin dashboard (Overview, Sessions & Batches, Staff creation/reset, Expenses, Monthly Report launcher, Topbar `⋮` More menu for Timing Logs / Transfer Admin / Print Center QR / Regenerate Center QR / Logout, click-box-to-popup details)
- `receptionist.html` & `js/receptionist.js` — Receptionist dashboard (Student enrollment & clickable list, Fees Month Picker + 250ms debounced search + Single Student Fee Card + Paid Receipts, P-button Attendance list with conditional Offline/Online pill + Print Center QR, Leave Approvals, Today's Timing Override, Expenses, `More` panel)
- `qr-print.html` — Printable single center-wide permanent QR sheet (no URL params; fetches `/config/centerQR`, `@media print` A4-ready with 300×300px+ QR and instructions)
- `checkin.html` — Center-wide QR Self Check-In (`?token=<centerQR.token>`) authenticating Student ID + plain password, deriving batch from student record, enforcing once-per-day & manual-override guards
- `teacher.html` & `js/teacher.js` — Teacher portal (4-tab bottom nav + `More` panel, 3-day Exam Reminder banners, My Batches + clickable Student Detail Popup, Routine Tests, Card-based Test Results with sticky Save bar, Weekly Content with 7-day cleanup, School Date Sheets, PTMs, Notices, Student Leaves & Attendance read-only clickable box lists, Change Own Password)
- `student.html` & `js/student.js` — Student portal (4-tab bottom nav + `More` panel, Home summary cards + **Ask a Doubt on WhatsApp**, Today's Timing, Monthly Attendance cards, zero-table Routine Test Marks, Weekly Content, Notices, School Date Sheets, PTMs, Apply for Leave, Notifications, Profile & Change Own Password)
- `report.html` — Printable Monthly P&L and Revenue Report (`window.print()` PDF export)
- `js/firebase-config.js` — Firebase configuration and CDN v10 modular SDK imports
- `js/app.js` — Shared `CONFIG`, center QR helpers, `debounce`, `getPreviousMonthYM`, `getRecentMonthsList`, `computeFeeDueInfo`, `openPopup`/`closePopup`, shared detail popups (`openStudentDetailPopup`, `openFeeDetailPopup`, `openAttendanceDetailPopup`, `openLeaveDetailPopup`, `openExpenseDetailPopup`, `openTestResultDetailPopup`), `openWhatsApp`, `openExternalUrl`, `pickDefaultPhone`, `sendStudentWhatsApp`, `toast`, `guard`, `today`, `monthKey`, `diffDaysFromToday`, `cleanupWeeklyContent`, inline `generateQR`, and Firebase RTDB helpers
- `css/style.css` — Mobile-first responsive design system (`14px` mobile floor, `44px` touch targets, full-screen mobile modals, bottom tab bars, P-button & month picker UI, `@media print` A4 stylesheet)
- `firebase-rules.json` — Realtime Database security rules (includes `"config": { "centerQR": { ".read": true, ".write": true }, ".read": "auth != null", ".write": "auth != null" }`)

---

## 2. Firebase Project & Config Setup

1. Open [Firebase Console](https://console.firebase.google.com/) and create or select your project.
2. Register a **Web App** in **Project Settings → Your apps → Web**.
3. Copy your `firebaseConfig` object and paste it at the top of `js/firebase-config.js`.
4. Update the `CONFIG` object at the top of `js/app.js` (`whatsapp`, `whatsappDisplay`, `tuitionName`) if needed.

---

## 3. Enabling Email/Password Authentication & Realtime Database

1. In Firebase Console, go to **Authentication → Sign-in method**:
   - Enable **Email/Password** (required for Admin login).
   - Optionally enable **Anonymous** if you restrict `/students` and `/staff` reads to `auth != null`.
2. Go to **Realtime Database → Create Database** and choose your region.

---

## 4. Importing `firebase-rules.json`

1. Open **Realtime Database → Rules** in the Firebase Console.
2. Copy the contents of `firebase-rules.json` and paste them into the Rules editor, or deploy via CLI:
   ```bash
   firebase deploy --only database
   ```

---

## 5. First-Time Admin Login & Ownership Transfer

1. Open `index.html` and click the **Admin** tab.
2. Enter your Admin email and password (minimum 6 characters) and click **Sign In as Admin**.
3. On the very first login (when `/admins` in Realtime Database is empty), your Firebase Auth account is created and registered under `/admins/{uid}` with `{ active: true, expired: false }`.
4. Subsequent unauthorized email accounts are denied access and signed out automatically.
5. **Transferring Ownership**: From `admin.html → Transfer Admin`, enter the new owner's email. If they have signed in before, ownership transfers immediately and your account is marked `{ active: false, expired: true }`. If they haven't signed in yet, an invite is queued in `/adminInvites` and activates automatically when they sign in with their email & password on `index.html`.
