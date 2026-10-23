import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getDatabase,
  ref,
  query,
  orderByChild,
  equalTo,
  push,
  set,
  get,
  update,
  remove,
  onValue,
} from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCFRKd9unO2RRuPt5MuvqzZAa98tl9hdCQ",
  authDomain: "absensi-siswa-4c1cd.firebaseapp.com",
  databaseURL: "https://absensi-siswa-4c1cd-default-rtdb.firebaseio.com",
  projectId: "absensi-siswa-4c1cd",
  storageBucket: "absensi-siswa-4c1cd.firebasestorage.app",
  messagingSenderId: "261250257958",
  appId: "1:261250257958:web:c48c6c0ee56ac7901dc2e7",
  measurementId: "G-2ZXNNJVSP7",
};

const app = initializeApp(firebaseConfig);

let analytics = null;
isSupported()
  .then((ok) => { if (ok) analytics = getAnalytics(app); })
  .catch(() => { analytics = null; });

const auth = getAuth(app);
const db = getDatabase(app);
const absensiRef = ref(db, "absensi");
const usersRef = ref(db, "users");
const STATUS_LIST = ["Hadir", "Izin", "Sakit"];

// Peran ditentukan otomatis dari email. Hanya akun admin di bawah ini yang
// menjadi admin; akun lain selalu menjadi siswa.
//
// Karena alfredo@gmail.com adalah email dummy (tidak bisa dipakai reset
// password), login dummy tersebut dipetakan ke akun Firebase internal berikut.
// Password login yang dipakai pengguna tetap: alfredo123.
const ADMIN_LOGIN_EMAIL = "alfredo@gmail.com";
const ADMIN_AUTH_EMAIL = "admin.alfredo@absensi-siswa.test";
const ADMIN_AUTH_PASSWORD = "alfredo123";
const ADMIN_EMAILS = [ADMIN_LOGIN_EMAIL, ADMIN_AUTH_EMAIL];

const ROLE_LABEL = { admin: "Admin", siswa: "Siswa" };

function roleForEmail(email) {
  return ADMIN_EMAILS.includes(String(email || "").toLowerCase()) ? "admin" : "siswa";
}

function displayEmail(email) {
  const value = String(email || "").toLowerCase();
  return value === ADMIN_AUTH_EMAIL ? ADMIN_LOGIN_EMAIL : value;
}

async function signInWithCredentials(email, password) {
  if (email !== ADMIN_LOGIN_EMAIL) {
    return signInWithEmailAndPassword(auth, email, password);
  }
  // Login admin dummy: password dicek di sini, lalu autentikasi memakai akun
  // Firebase internal agar data tetap aman dan tersimpan dengan auth != null.
  if (password !== ADMIN_AUTH_PASSWORD) {
    const err = new Error("Password akun admin salah.");
    err.code = "auth/invalid-credential";
    throw err;
  }
  try {
    return await signInWithEmailAndPassword(auth, ADMIN_AUTH_EMAIL, ADMIN_AUTH_PASSWORD);
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try {
        return await createUserWithEmailAndPassword(auth, ADMIN_AUTH_EMAIL, ADMIN_AUTH_PASSWORD);
      } catch (createErr) {
        if (createErr.code !== "auth/email-already-in-use") throw createErr;
        return signInWithEmailAndPassword(auth, ADMIN_AUTH_EMAIL, ADMIN_AUTH_PASSWORD);
      }
    }
    throw err;
  }
}

const $ = (id) => document.getElementById(id);

function showMsg(el, text, type) {
  if (!el) return;
  el.textContent = text;
  el.className = "msg " + type;
  el.classList.remove("hidden");
}
function hideMsg(el) { if (el) el.classList.add("hidden"); }

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function setToday(input) {
  if (input && !input.value) input.valueAsDate = new Date();
}
function formatTanggalID(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}
function formatDateTimeID(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}
function normalizeRole(role) {
  return role === "admin" ? "admin" : "siswa";
}

function authErrorMessage(err) {
  const map = {
    "auth/invalid-email": "Format email tidak valid.",
    "auth/missing-password": "Password wajib diisi.",
    "auth/weak-password": "Password minimal 6 karakter.",
    "auth/email-already-in-use": "Email sudah terdaftar. Silakan login.",
    "auth/invalid-credential": 'Email atau password salah. Belum punya akun? Klik "Daftar".',
    "auth/wrong-password": 'Email atau password salah. Belum punya akun? Klik "Daftar".',
    "auth/user-not-found": 'Akun belum terdaftar. Klik "Daftar" untuk membuat akun.',
    "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi beberapa saat.",
    "auth/network-request-failed": "Koneksi gagal. Periksa jaringan internet Anda.",
    "auth/operation-not-allowed": "Login email/password belum diaktifkan di Firebase Console.",
  };
  return map[err && err.code] || (err && err.message) || "Terjadi kesalahan.";
}

function dbErrorMessage(err) {
  const message = (err && err.message) || "";
  if (
    (err && err.code === "PERMISSION_DENIED") ||
    /permission[_\s]denied/i.test(message)
  ) {
    return (
      "Akses ditolak oleh Realtime Database Rules. Buka Firebase Console → " +
      'Realtime Database → Rules, lalu izinkan pengguna login (".read" dan ' +
      '".write": "auth != null") dan klik Publish.'
    );
  }
  return message || "Terjadi kesalahan.";
}

let currentUser = null;
let currentProfile = null;
let currentRole = null;
let records = [];
let allUsers = [];
let subscriptions = [];
let pendingRegistration = null;

const loginSection = $("loginSection");
const appSection = $("appSection");
const navUser = $("navUser");
const loginForm = $("loginForm");
const registerForm = $("registerForm");
const absensiForm = $("absensiForm");
const editForm = $("editForm");
const editModal = $("editModal");
const tbody = $("tbody");
const accountsBody = $("accountsBody");

/* ------------------------------- Role UI ------------------------------- */

function applyRoleVisibility(role) {
  document.querySelectorAll(".data-admin-only").forEach((el) => {
    el.classList.toggle("hidden", role !== "admin");
  });
  document.querySelectorAll(".data-student-only").forEach((el) => {
    el.classList.toggle("hidden", role !== "siswa");
  });
}

/* ------------------------------ Login form ----------------------------- */

function showLoginForm() {
  loginForm.classList.remove("hidden");
  registerForm.classList.add("hidden");
  $("btnShowRegister").classList.remove("hidden");
}
function showRegisterForm() {
  loginForm.classList.add("hidden");
  registerForm.classList.remove("hidden");
  hideMsg($("loginMsg"));
}

$("btnShowRegister").addEventListener("click", showRegisterForm);
$("btnBackToLogin").addEventListener("click", () => {
  registerForm.reset();
  hideMsg($("loginMsg"));
  showLoginForm();
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const loginMsg = $("loginMsg");
  hideMsg(loginMsg);
  const email = loginForm.email.value.trim().toLowerCase();
  const password = loginForm.password.value;
  if (!email || !password) {
    showMsg(loginMsg, "Email dan password wajib diisi.", "error");
    return;
  }
  const btn = $("btnLogin");
  btn.disabled = true;
  try {
    await signInWithCredentials(email, password);
    loginForm.reset();
  } catch (err) {
    showMsg(loginMsg, authErrorMessage(err), "error");
  } finally {
    btn.disabled = false;
  }
});

$("btnForgotPassword").addEventListener("click", async () => {
  const loginMsg = $("loginMsg");
  hideMsg(loginMsg);
  const email = loginForm.email.value.trim().toLowerCase();
  if (!email) {
    showMsg(loginMsg, "Isi email terlebih dahulu, lalu klik Lupa password.", "error");
    return;
  }
  if (email === ADMIN_LOGIN_EMAIL || email === ADMIN_AUTH_EMAIL) {
    showMsg(
      loginMsg,
      "Akun admin demo memakai password tetap yang sudah ditentukan. Fitur reset password tidak tersedia untuk akun dummy ini.",
      "error"
    );
    return;
  }
  const btn = $("btnForgotPassword");
  btn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    showMsg(
      loginMsg,
      `Email reset password telah dikirim ke ${email}. Periksa kotak masuk/spam, lalu buat password baru.`,
      "success"
    );
  } catch (err) {
    showMsg(loginMsg, authErrorMessage(err), "error");
  } finally {
    btn.disabled = false;
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const loginMsg = $("loginMsg");
  hideMsg(loginMsg);

  const nama = $("regNama").value.trim();
  const kelas = $("regKelas").value.trim();
  const email = $("regEmail").value.trim().toLowerCase();
  const password = $("regPassword").value;

  if (!nama) {
    showMsg(loginMsg, "Nama lengkap wajib diisi.", "error");
    return;
  }
  if (!kelas) {
    showMsg(loginMsg, "Kelas wajib diisi.", "error");
    return;
  }
  if (!email || !password) {
    showMsg(loginMsg, "Email dan password wajib diisi.", "error");
    return;
  }
  if (password.length < 6) {
    showMsg(loginMsg, "Password minimal 6 karakter.", "error");
    return;
  }

  pendingRegistration = { nama, kelas };
  const btn = $("btnRegisterSubmit");
  btn.disabled = true;
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    registerForm.reset();
  } catch (err) {
    pendingRegistration = null;
    showMsg(loginMsg, authErrorMessage(err), "error");
  } finally {
    btn.disabled = false;
  }
});

$("btnLogout").addEventListener("click", async () => {
  hideMsg($("loginMsg"));
  hideMsg($("formMsg"));
  try {
    await signOut(auth);
  } catch (err) {
    showMsg($("formMsg"), "Gagal logout: " + err.message, "error");
  }
});

/* ------------------------------- Profile ------------------------------- */

function userProfileRef(uid) {
  return ref(db, "users/" + uid);
}

async function ensureUserProfile(user) {
  const profileRef = userProfileRef(user.uid);
  const now = new Date().toISOString();
  const snap = await get(profileRef);
  const role = roleForEmail(user.email);
  const email = displayEmail(user.email);

  if (!snap.exists()) {
    const profile = {
      uid: user.uid,
      email,
      role,
      nama: (pendingRegistration && pendingRegistration.nama) || (role === "admin" ? "Administrator" : ""),
      kelas: (pendingRegistration && pendingRegistration.kelas) || "",
      createdAt: now,
      lastLoginAt: now,
    };
    await set(profileRef, profile);
    return profile;
  }

  const profile = snap.val() || {};
  const patch = { lastLoginAt: now };
  if (profile.email !== email) patch.email = email;
  // Peran selalu mengikuti email: alfredo@gmail.com = admin, lainnya siswa.
  if (normalizeRole(profile.role) !== role) patch.role = role;
  if (role === "admin" && !profile.nama) patch.nama = "Administrator";
  if (pendingRegistration) {
    if (pendingRegistration.nama) patch.nama = pendingRegistration.nama;
    if (pendingRegistration.kelas) patch.kelas = pendingRegistration.kelas;
  }
  await update(profileRef, patch);
  return { ...profile, ...patch };
}

/* -------------------------------- Data -------------------------------- */

function startData() {
  stopData();
  $("dataInfo").textContent = "Memuat data dari Firebase...";

  if (currentRole === "admin") {
    subscriptions.push(
      onValue(
        absensiRef,
        (snap) => {
          const value = snap.val() || {};
          records = Object.entries(value).map(([id, d]) => ({ id, ...d }));
          renderTable();
        },
        (err) => {
          records = [];
          $("dataInfo").textContent = "Gagal memuat data: " + dbErrorMessage(err);
          tbody.innerHTML = `<tr><td colspan="5" class="center muted">Tidak bisa membaca data</td></tr>`;
        }
      ),
      onValue(
        usersRef,
        (snap) => {
          const value = snap.val() || {};
          allUsers = Object.entries(value).map(([uid, d]) => ({ uid, ...d }));
          renderAccounts();
          renderStats();
          populateStudentPicker();
        },
        (err) => {
          allUsers = [];
          $("statUsers").textContent = "-";
          $("accountsInfo").textContent = "Gagal memuat akun: " + dbErrorMessage(err);
          accountsBody.innerHTML = `<tr><td colspan="5" class="center muted">Tidak bisa membaca akun</td></tr>`;
        }
      )
    );
  } else {
    // Siswa hanya mengambil absensi miliknya sendiri.
    // Tambahkan ".indexOn": "uid" pada node "absensi" di Firebase Rules
    // agar query ini berjalan cepat.
    const ownRef = query(absensiRef, orderByChild("uid"), equalTo(currentUser.uid));
    subscriptions.push(
      onValue(
        ownRef,
        (snap) => {
          const value = snap.val() || {};
          records = Object.entries(value).map(([id, d]) => ({ id, ...d }));
          renderTable();
        },
        (err) => {
          records = [];
          $("dataInfo").textContent = "Gagal memuat data: " + dbErrorMessage(err);
          tbody.innerHTML = `<tr><td colspan="4" class="center muted">Tidak bisa membaca data</td></tr>`;
        }
      )
    );
  }
}

function stopData() {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  subscriptions = [];
  records = [];
  allUsers = [];
  $("statUsers").textContent = "0";
  $("statUsersSub").textContent = "tersimpan di database";
  $("siswaPicker").innerHTML = '<option value="">-- Input manual --</option>';
}

function validateAbsensi({ nama, kelas, tanggal, status }) {
  if (!nama || !kelas) return "Nama dan kelas tidak boleh kosong.";
  if (!tanggal) return "Tanggal wajib diisi.";
  if (!status || !STATUS_LIST.includes(status)) return "Status kehadiran wajib dipilih.";
  return null;
}
function isDuplicate(nama, tanggal, excludeId = null) {
  return records.some(
    (d) =>
      d.id !== excludeId &&
      String(d.nama || "").toLowerCase() === nama.toLowerCase() &&
      d.tanggal === tanggal
  );
}
async function createAbsensi({ nama, kelas, tanggal, status, uid }) {
  const doc = {
    nama, kelas, tanggal, status, uid: uid || "",
    createdBy: currentUser ? currentUser.uid : "",
    createdAt: new Date().toISOString(),
  };
  await set(push(absensiRef), doc);
}
async function updateAbsensi(id, { nama, kelas, tanggal, status }) {
  await update(ref(db, "absensi/" + id), {
    nama, kelas, tanggal, status,
    updatedAt: new Date().toISOString(),
  });
}
async function deleteAbsensi(id) {
  await remove(ref(db, "absensi/" + id));
}

function getFiltered(queryText) {
  const q = (queryText || "").trim().toLowerCase();
  const statusFilter = currentRole === "admin" ? $("filterStatus").value : "";
  const dateFilter = currentRole === "admin" ? $("filterTanggal").value : "";

  const data = [...records].sort((a, b) =>
    ((b.tanggal || "") + (b.createdAt || "")).localeCompare(
      (a.tanggal || "") + (a.createdAt || "")
    )
  );

  return data.filter((d) => {
    if (statusFilter && d.status !== statusFilter) return false;
    if (dateFilter && d.tanggal !== dateFilter) return false;
    if (!q) return true;
    return (
      String(d.nama || "").toLowerCase().includes(q) ||
      String(d.kelas || "").toLowerCase().includes(q)
    );
  });
}

function getStats() {
  return {
    total: records.length,
    hadir: records.filter((d) => d.status === "Hadir").length,
    izin: records.filter((d) => d.status === "Izin").length,
    sakit: records.filter((d) => d.status === "Sakit").length,
  };
}

/* -------------------------------- Views ------------------------------- */

function showApp(user, profile) {
  currentProfile = profile;
  currentRole = roleForEmail(user.email);

  loginSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  navUser.classList.remove("hidden");

  const roleLabel = ROLE_LABEL[currentRole];
  const shownEmail = displayEmail(user.email);
  $("userEmailDisplay").textContent = shownEmail;
  $("userEmailDisplay").title = shownEmail;
  $("roleBadge").textContent = roleLabel;
  $("roleBadge").className = "role-badge " + currentRole;

  $("statUser").textContent = shownEmail;
  $("statUid").textContent = "UID: " + user.uid + " • " + roleLabel;

  applyRoleVisibility(currentRole);

  if (currentRole === "admin") {
    $("formTitle").textContent = "Input Absensi Siswa";
    $("formHint").textContent = "Admin dapat menambahkan, mengubah, dan menghapus absensi seluruh siswa.";
    $("btnSimpan").textContent = "Simpan Absensi";
    $("nama").value = "";
    $("kelas").value = "";
    $("nama").readOnly = false;
    $("kelas").readOnly = false;
    $("statTotalLabel").textContent = "Total absensi tercatat";
    $("statSub").textContent = "seluruh siswa, tersimpan di Firebase";
    $("dataTitle").textContent = "Data Absensi Semua Siswa";
    $("search").value = "";
    $("search").placeholder = "Cari nama / kelas...";
    $("filterStatus").value = "";
    $("filterTanggal").value = "";
  } else {
    $("formTitle").textContent = "Catat Absensi Saya";
    $("formHint").textContent = "Pilih status kehadiran Anda hari ini. Data otomatis tercatat atas nama akun ini.";
    $("btnSimpan").textContent = "Simpan Absensi Saya";
    $("nama").value = profile.nama || "";
    $("kelas").value = profile.kelas || "";
    const identityComplete = Boolean(profile.nama && profile.kelas);
    $("nama").readOnly = identityComplete;
    $("kelas").readOnly = identityComplete;
    if (!identityComplete) {
      $("formHint").textContent = "Lengkapi nama dan kelas Anda terlebih dahulu, lalu catat absensi.";
    }
    $("statTotalLabel").textContent = "Absensi saya";
    $("statSub").textContent = "hanya data milik akun Anda";
    $("dataTitle").textContent = "Riwayat Absensi Saya";
    $("search").value = "";
    $("search").placeholder = "Cari di riwayat saya...";
  }

  startData();
}

function showLogin() {
  loginSection.classList.remove("hidden");
  appSection.classList.add("hidden");
  navUser.classList.add("hidden");
  showLoginForm();
  $("absensiForm").reset();
  $("search").value = "";
  setToday($("tanggal"));
}

function renderStats() {
  const { total, hadir, izin, sakit } = getStats();
  $("statTotal").textContent = total;
  $("statHadir").textContent = hadir;
  $("statIzin").textContent = izin;
  $("statSakit").textContent = sakit;

  if (currentRole === "admin") {
    const adminCount = allUsers.filter((u) => roleForEmail(u.email) === "admin").length;
    const siswaCount = allUsers.length - adminCount;
    $("statUsers").textContent = allUsers.length;
    $("statUsersSub").textContent = `${adminCount} admin • ${siswaCount} siswa`;
  }
}

function renderTable() {
  renderStats();

  const rows = getFiltered($("search").value);
  const colCount = currentRole === "admin" ? 5 : 4;
  const total = records.length;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${colCount}" class="center muted">Belum ada data</td></tr>`;
    $("dataInfo").textContent = total
      ? `Total ${total} data tersimpan, tidak ada yang cocok dengan filter/pencarian.`
      : currentRole === "admin"
        ? "Belum ada data absensi tersimpan di Firebase."
        : "Anda belum pernah mencatat absensi.";
    return;
  }

  tbody.innerHTML = "";
  rows.forEach((d) => {
    const tr = document.createElement("tr");
    const actionCell = currentRole === "admin"
      ? `<td>
           <button type="button" class="btn-edit" data-edit="${escapeHtml(d.id)}">Edit</button>
           <button type="button" class="btn-danger" data-del="${escapeHtml(d.id)}">Hapus</button>
         </td>`
      : "";
    tr.innerHTML = `
      <td>${escapeHtml(d.nama || "-")}</td>
      <td>${escapeHtml(d.kelas || "-")}</td>
      <td>${escapeHtml(formatTanggalID(d.tanggal))}</td>
      <td><span class="badge ${escapeHtml(String(d.status || "").toLowerCase())}">${escapeHtml(d.status || "-")}</span></td>
      ${actionCell}`;
    tbody.appendChild(tr);
  });

  $("dataInfo").textContent = currentRole === "admin"
    ? `Menampilkan ${rows.length} dari ${total} data absensi seluruh siswa (tersinkron dengan Firebase).`
    : `Menampilkan ${rows.length} dari ${total} absensi milik Anda.`;

  if (currentRole !== "admin") return;

  tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Hapus data ini?")) return;
      try {
        await deleteAbsensi(btn.dataset.del);
      } catch (err) {
        showMsg($("formMsg"), "Gagal menghapus: " + dbErrorMessage(err), "error");
      }
    });
  });
  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEdit(btn.dataset.edit));
  });
}

function renderAccounts() {
  if (currentRole !== "admin") return;

  if (!allUsers.length) {
    accountsBody.innerHTML = `<tr><td colspan="5" class="center muted">Belum ada akun terdaftar</td></tr>`;
    $("accountsInfo").textContent = "0 akun";
    return;
  }

  const users = [...allUsers].sort((a, b) => {
    const roleA = roleForEmail(a.email);
    const roleB = roleForEmail(b.email);
    if (roleA !== roleB) return roleA === "admin" ? -1 : 1;
    return String(a.email || "").localeCompare(String(b.email || ""));
  });

  $("accountsInfo").textContent = `${users.length} akun terdaftar • peran otomatis dari email`;
  accountsBody.innerHTML = "";
  users.forEach((u) => {
    const role = roleForEmail(u.email);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(u.email || "-")}</td>
      <td>${escapeHtml(u.nama || "-")}</td>
      <td>${escapeHtml(u.kelas || "-")}</td>
      <td><span class="role-badge ${role}">${ROLE_LABEL[role]}</span></td>
      <td>${escapeHtml(formatDateTimeID(u.lastLoginAt))}</td>`;
    accountsBody.appendChild(tr);
  });
}

function populateStudentPicker() {
  const select = $("siswaPicker");
  if (!select) return;
  const previous = select.value;
  const students = allUsers
    .filter((u) => roleForEmail(u.email) === "siswa")
    .sort((a, b) => String(a.nama || a.email || "").localeCompare(String(b.nama || b.email || "")));

  select.innerHTML =
    '<option value="">-- Input manual --</option>' +
    students.map((u) => {
      const label = u.nama ? `${u.nama}${u.kelas ? " — " + u.kelas : ""}` : (u.email || u.uid);
      return `<option value="${escapeHtml(u.uid)}">${escapeHtml(label)}</option>`;
    }).join("");

  if (students.some((u) => u.uid === previous)) select.value = previous;
}

$("siswaPicker").addEventListener("change", () => {
  const uid = $("siswaPicker").value;
  if (!uid) {
    $("nama").value = "";
    $("kelas").value = "";
    return;
  }
  const student = allUsers.find((u) => u.uid === uid);
  if (!student) return;
  $("nama").value = student.nama || "";
  $("kelas").value = student.kelas || "";
});

/* ------------------------------- Absensi ------------------------------ */

absensiForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formMsg = $("formMsg");
  hideMsg(formMsg);
  if (!currentUser || !currentRole) {
    showMsg(formMsg, "Anda belum login.", "error");
    return;
  }

  const payload = {
    nama: $("nama").value.trim(),
    kelas: $("kelas").value.trim(),
    tanggal: $("tanggal").value,
    status: $("status").value,
  };
  const err = validateAbsensi(payload);
  if (err) {
    showMsg(formMsg, err, "error");
    return;
  }
  if (isDuplicate(payload.nama, payload.tanggal)) {
    showMsg(formMsg, `Gagal: ${payload.nama} sudah absen pada tanggal ${payload.tanggal}.`, "error");
    return;
  }

  const btn = $("btnSimpan");
  btn.disabled = true;
  try {
    if (currentRole === "admin") {
      const pickedUid = $("siswaPicker").value;
      await createAbsensi({ ...payload, uid: pickedUid });
      $("siswaPicker").value = "";
    } else {
      await createAbsensi({ ...payload, uid: currentUser.uid });
      // Simpan identitas siswa agar form berikutnya terisi otomatis.
      try {
        await update(userProfileRef(currentUser.uid), {
          nama: payload.nama,
          kelas: payload.kelas,
        });
        currentProfile = { ...currentProfile, nama: payload.nama, kelas: payload.kelas };
      } catch (profileErr) {
        console.warn("Profil gagal diperbarui:", dbErrorMessage(profileErr));
      }
    }
    absensiForm.reset();
    if (currentRole === "siswa") {
      $("nama").value = payload.nama;
      $("kelas").value = payload.kelas;
    }
    setToday($("tanggal"));
    showMsg(formMsg, "Absensi berhasil disimpan ke Firebase.", "success");
  } catch (err2) {
    showMsg(formMsg, "Gagal menyimpan: " + dbErrorMessage(err2), "error");
  } finally {
    btn.disabled = false;
  }
});

function openEdit(id) {
  if (currentRole !== "admin") return;
  const d = records.find((x) => x.id === id);
  if (!d) return;
  $("editId").value = d.id;
  $("editNama").value = d.nama || "";
  $("editKelas").value = d.kelas || "";
  $("editTanggal").value = d.tanggal || "";
  $("editStatus").value = d.status || "Hadir";
  hideMsg($("editMsg"));
  editModal.classList.remove("hidden");
  $("editNama").focus();
}
function closeEdit() { editModal.classList.add("hidden"); }

$("btnBatal").addEventListener("click", closeEdit);
editModal.addEventListener("click", (e) => {
  if (e.target === editModal) closeEdit();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !editModal.classList.contains("hidden")) closeEdit();
});

editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (currentRole !== "admin") return;
  const msg = $("editMsg");
  hideMsg(msg);
  const id = $("editId").value;
  const payload = {
    nama: $("editNama").value.trim(),
    kelas: $("editKelas").value.trim(),
    tanggal: $("editTanggal").value,
    status: $("editStatus").value,
  };
  const err = validateAbsensi(payload);
  if (err) {
    showMsg(msg, err, "error");
    return;
  }
  if (isDuplicate(payload.nama, payload.tanggal, id)) {
    showMsg(msg, "Gagal: siswa ini sudah absen di tanggal tersebut.", "error");
    return;
  }
  const btn = $("btnUpdate");
  btn.disabled = true;
  try {
    await updateAbsensi(id, payload);
    closeEdit();
    showMsg($("formMsg"), "Data berhasil diperbarui di Firebase.", "success");
  } catch (err2) {
    showMsg(msg, "Gagal memperbarui: " + dbErrorMessage(err2), "error");
  } finally {
    btn.disabled = false;
  }
});

/* -------------------------------- Filters ----------------------------- */

$("search").addEventListener("input", renderTable);
$("filterStatus").addEventListener("change", renderTable);
$("filterTanggal").addEventListener("change", renderTable);
$("btnResetFilter").addEventListener("click", () => {
  $("filterStatus").value = "";
  $("filterTanggal").value = "";
  $("search").value = "";
  renderTable();
});

/* ------------------------------ Auth state ---------------------------- */

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    currentProfile = null;
    currentRole = null;
    pendingRegistration = null;
    stopData();
    showLogin();
    return;
  }

  currentUser = user;
  try {
    const profile = await ensureUserProfile(user);
    pendingRegistration = null;
    showApp(user, { ...profile, role: roleForEmail(user.email) });
  } catch (err) {
    showMsg(
      $("loginMsg"),
      "Gagal memuat profil akun. " + dbErrorMessage(err),
      "error"
    );
    pendingRegistration = null;
    await signOut(auth).catch(() => {});
  }
});

setToday($("tanggal"));
