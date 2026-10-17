import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported } from "firebase/analytics";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getDatabase,
  ref,
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

const $ = (id) => document.getElementById(id);

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = "msg " + type;
  el.classList.remove("hidden");
}
function hideMsg(el) { el.classList.add("hidden"); }

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
let records = [];
let subscriptions = [];

function startData() {
  stopData();
  $("dataInfo").textContent = "Memuat data dari Firebase...";
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
        $("statUsers").textContent = Object.keys(snap.val() || {}).length;
      },
      () => {
        $("statUsers").textContent = "-";
      }
    )
  );
}
function stopData() {
  subscriptions.forEach((unsubscribe) => unsubscribe());
  subscriptions = [];
  records = [];
  $("statUsers").textContent = "0";
}

function userProfileRef(uid) {
  return ref(db, "users/" + uid);
}

async function saveUserProfile(user) {
  const profileRef = userProfileRef(user.uid);
  const now = new Date().toISOString();
  const snap = await get(profileRef);
  if (snap.exists()) {
    await update(profileRef, { lastLoginAt: now });
    return;
  }
  await set(profileRef, {
    uid: user.uid,
    email: user.email || "",
    createdAt: now,
    lastLoginAt: now,
  });
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
    nama, kelas, tanggal, status, uid,
    createdAt: new Date().toISOString(),
  };
  await set(push(absensiRef), doc);
}
async function updateAbsensi(id, { nama, kelas, tanggal, status }) {
  await update(ref(db, "absensi/" + id), { nama, kelas, tanggal, status });
}
async function deleteAbsensi(id) {
  await remove(ref(db, "absensi/" + id));
}
function getFiltered(query) {
  const q = (query || "").trim().toLowerCase();
  const data = [...records].sort((a, b) =>
    ((b.tanggal || "") + (b.createdAt || "")).localeCompare(
      (a.tanggal || "") + (a.createdAt || "")
    )
  );
  if (!q) return data;
  return data.filter(
    (d) =>
      String(d.nama || "").toLowerCase().includes(q) ||
      String(d.kelas || "").toLowerCase().includes(q)
  );
}
function getStats() {
  return {
    total: records.length,
    hadir: records.filter((d) => d.status === "Hadir").length,
    izin: records.filter((d) => d.status === "Izin").length,
    sakit: records.filter((d) => d.status === "Sakit").length,
  };
}

const loginSection = $("loginSection");
const appSection = $("appSection");
const navUser = $("navUser");
const loginForm = $("loginForm");
const absensiForm = $("absensiForm");
const editForm = $("editForm");
const editModal = $("editModal");
const tbody = $("tbody");

function showApp(user) {
  loginSection.classList.add("hidden");
  appSection.classList.remove("hidden");
  navUser.classList.remove("hidden");
  $("userEmailDisplay").textContent = user.email;
  $("statUser").textContent = user.email;
  $("statUid").textContent = "UID: " + user.uid;
  startData();
}
function showLogin() {
  loginSection.classList.remove("hidden");
  appSection.classList.add("hidden");
  navUser.classList.add("hidden");
}

function renderTable() {
  const { total, hadir, izin, sakit } = getStats();
  $("statTotal").textContent = total;
  $("statHadir").textContent = hadir;
  $("statIzin").textContent = izin;
  $("statSakit").textContent = sakit;

  const rows = getFiltered($("search").value);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="center muted">Belum ada data</td></tr>`;
    $("dataInfo").textContent = total
      ? `Total ${total} data tersimpan (Firebase), tidak ada yang cocok dengan pencarian.`
      : "Belum ada data absensi tersimpan di Firebase.";
    return;
  }

  tbody.innerHTML = "";
  rows.forEach((d) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(d.nama)}</td>
      <td>${escapeHtml(d.kelas)}</td>
      <td>${escapeHtml(formatTanggalID(d.tanggal))}</td>
      <td><span class="badge ${escapeHtml(String(d.status).toLowerCase())}">${escapeHtml(d.status)}</span></td>
      <td>
        <button type="button" class="btn-edit" data-edit="${d.id}">Edit</button>
        <button type="button" class="btn-danger" data-del="${d.id}">Hapus</button>
      </td>`;
    tbody.appendChild(tr);
  });
  $("dataInfo").textContent = `Menampilkan ${rows.length} dari ${total} data (tersinkron dengan Firebase).`;

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
    await signInWithEmailAndPassword(auth, email, password);
    loginForm.reset();
  } catch (err) {
    showMsg(loginMsg, authErrorMessage(err), "error");
  } finally {
    btn.disabled = false;
  }
});

$("btnRegister").addEventListener("click", async () => {
  const loginMsg = $("loginMsg");
  hideMsg(loginMsg);
  const email = loginForm.email.value.trim().toLowerCase();
  const password = loginForm.password.value;
  if (!email || !password) {
    showMsg(loginMsg, "Isi email & password dulu untuk daftar.", "error");
    return;
  }
  const btn = $("btnRegister");
  btn.disabled = true;
  try {
    await createUserWithEmailAndPassword(auth, email, password);
    loginForm.reset();
  } catch (err) {
    showMsg(loginMsg, authErrorMessage(err), "error");
  } finally {
    btn.disabled = false;
  }
});

$("btnLogout").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (err) {
    showMsg($("formMsg"), "Gagal logout: " + err.message, "error");
  }
});

absensiForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const formMsg = $("formMsg");
  hideMsg(formMsg);
  if (!currentUser) {
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
    await createAbsensi({ ...payload, uid: currentUser.uid });
    absensiForm.reset();
    setToday($("tanggal"));
    showMsg(formMsg, "Absensi berhasil disimpan ke Firebase.", "success");
  } catch (err2) {
    showMsg(formMsg, "Gagal menyimpan: " + dbErrorMessage(err2), "error");
  } finally {
    btn.disabled = false;
  }
});

function openEdit(id) {
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

$("search").addEventListener("input", renderTable);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    showApp(user);
    try {
      await saveUserProfile(user);
    } catch (err) {
      showMsg(
        $("formMsg"),
        "Peringatan: data akun belum tersimpan ke database. " + dbErrorMessage(err),
        "error"
      );
    }
  } else {
    stopData();
    showLogin();
  }
});

setToday($("tanggal"));
