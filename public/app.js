
import { firebaseConfig } from "./app-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);

const matchList = document.getElementById("matchList");
const dateLabel = document.getElementById("selectedDate");
const refreshState = document.getElementById("refreshState");
const adminPanel = document.getElementById("adminPanel");
const loginBox = document.getElementById("loginBox");
const streamEditor = document.getElementById("streamEditor");
const manualMatchEditor = document.getElementById("manualMatchEditor");
const matchSelect = document.getElementById("matchSelect");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginMessage = document.getElementById("loginMessage");
const loginBtn = document.getElementById("loginBtn");

const resetPasswordBtn = document.getElementById("resetPasswordBtn");
const manualMatchDate = document.getElementById("manualMatchDate");
const manualHomeTeam = document.getElementById("manualHomeTeam");
const manualAwayTeam = document.getElementById("manualAwayTeam");
const manualHomeScore = document.getElementById("manualHomeScore");
const manualAwayScore = document.getElementById("manualAwayScore");
const addManualMatchBtn = document.getElementById("addManualMatchBtn");
const manualMatchMessage = document.getElementById("manualMatchMessage");

// Manual-match deletion controls are added dynamically.
const manualDeleteBox = document.createElement("div");
manualDeleteBox.className = "admin-card";
manualDeleteBox.innerHTML = `
  <h3>حذف مباراة يدوية</h3>
  <label>اختر المباراة اليدوية
    <select id="manualDeleteSelect">
      <option value="">اختر مباراة لحذفها</option>
    </select>
  </label>
  <button id="deleteManualMatchBtn" class="btn danger" type="button">
    حذف المباراة المحددة
  </button>
  <p id="deleteManualMatchMessage" class="help"></p>
`;
manualMatchEditor.insertAdjacentElement("afterend", manualDeleteBox);

const manualDeleteSelect = manualDeleteBox.querySelector("#manualDeleteSelect");
const deleteManualMatchBtn = manualDeleteBox.querySelector("#deleteManualMatchBtn");
const deleteManualMatchMessage = manualDeleteBox.querySelector("#deleteManualMatchMessage");

let selectedDate = localDateString(0);
let matches = [];
let automaticMatches = [];
let manualMatchesByDate = {};
let streams = {};
let isAdmin = false;
let unsubscribeStreams = null;

function localDateString(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("ar-EG", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function statusInfo(status) {
  if (["IN_PLAY", "PAUSED", "SUSPENDED"].includes(status)) {
    return ["مباشر (قد يتأخر)", "live"];
  }

  if (status === "FINISHED") return ["انتهت", "finished"];
  if (status === "POSTPONED") return ["تأجلت", "scheduled"];
  if (status === "CANCELLED") return ["ألغيت", "finished"];

  return ["قادمة", "scheduled"];
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function teamMarkup(team) {
  return team.crest
    ? `<img class="crest" src="${safeText(team.crest)}" alt="" loading="lazy"
        onerror="this.style.display='none';this.nextElementSibling.style.display='grid'">
       <div class="crest-fallback" style="display:none">
        ${safeText((team.shortName || team.name || "?").slice(0, 3))}
       </div>`
    : `<div class="crest-fallback">
        ${safeText((team.shortName || team.name || "?").slice(0, 3))}
       </div>`;
}

function scoreText(m) {
  const a = m.score?.home;
  const b = m.score?.away;

  return a === null || a === undefined || b === null || b === undefined
    ? "VS"
    : `${a} - ${b}`;
}

function refreshDisplayedMatches() {
  const manualForDate = Object.values(manualMatchesByDate[selectedDate] || {});
  matches = [...automaticMatches, ...manualForDate].sort((a, b) =>
    new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
  );

  render();
  updateMatchSelect();
  updateManualDeleteSelect();
}

function updateManualDeleteSelect() {
  const current = manualDeleteSelect.value;
  manualDeleteSelect.innerHTML =
    '<option value="">اختر مباراة لحذفها</option>';

  Object.entries(manualMatchesByDate).forEach(([date, dayMatches]) => {
    Object.values(dayMatches || {}).forEach(match => {
      if (!match?.id || !match?.manual) return;

      const option = document.createElement("option");
      option.value = `${date}|${match.id}`;
      option.textContent =
        `${match.homeTeam?.name || "؟"} × ${match.awayTeam?.name || "؟"} — ${date}`;

      manualDeleteSelect.appendChild(option);
    });
  });

  if ([...manualDeleteSelect.options].some(option => option.value === current)) {
    manualDeleteSelect.value = current;
  }
}

function render() {
  if (dateLabel) dateLabel.textContent = selectedDate;
  matchList.innerHTML = "";

  if (!matches.length) {
    matchList.innerHTML =
      '<div class="empty">لا توجد مباريات متاحة لهذه البطولات في هذا اليوم.</div>';
    return;
  }

  matches.forEach(m => {
    const [label, cls] = statusInfo(m.status);

    const card = document.createElement("article");
    card.className = "match";
    card.setAttribute("role", "link");
    card.tabIndex = 0;

    card.innerHTML = `
      <div class="team">
        ${teamMarkup(m.homeTeam)}
        <div class="team-name">${safeText(m.homeTeam.name)}</div>
      </div>

      <div class="score">
        <div class="score-main ${scoreText(m) === "VS" ? "pending" : ""}">
          ${safeText(scoreText(m))}
        </div>

        <span class="status ${cls}">${label}</span>

        <div class="match-meta">
          ${m.manual
            ? `مباراة يدوية • ${safeText(new Date(`${m.date}T12:00:00`).toLocaleDateString("ar-EG"))}`
            : `${safeText(m.competition.name)} • ${formatTime(m.utcDate)}`}
        </div>

        ${m.manual && scoreText(m) === "VS"
          ? '<div class="match-meta" style="font-size:10px;margin-top:3px">النتيجة قد لا تكون متاحة حالياً</div>'
          : ""}

        <span class="watch-hint">
          ${streams[m.id]?.embedCode ? "مشاهدة المباراة ←" : "تفاصيل المباراة ←"}
        </span>
      </div>

      <div class="team">
        ${teamMarkup(m.awayTeam)}
        <div class="team-name">${safeText(m.awayTeam.name)}</div>
      </div>
    `;

    const go = () => {
      location.href =
        `/watch.html?id=${encodeURIComponent(m.id)}&date=${encodeURIComponent(selectedDate)}`;
    };

    card.addEventListener("click", go);

    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });

    matchList.appendChild(card);
  });
}

async function loadMatches(date) {
  selectedDate = date;
  if (refreshState) refreshState.textContent = "جاري التحديث...";
  matchList.innerHTML = '<div class="empty">جاري تحميل المباريات...</div>';

  try {
    const response = await fetch(
      `/api/matches?date=${encodeURIComponent(date)}`
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "تعذر تحميل المباريات");
    }

    automaticMatches = data.matches || [];

    if (refreshState) {
      refreshState.textContent =
        `${automaticMatches.length} مباراة من الجدول التلقائي`;
    }

    refreshDisplayedMatches();

  } catch (error) {
    automaticMatches = [];
    if (refreshState) refreshState.textContent = "تعذر تحميل الجدول التلقائي";
    refreshDisplayedMatches();

    if (!matches.length) {
      matchList.innerHTML =
        `<div class="empty">${safeText(error.message)}</div>`;
    }
  }
}

function updateMatchSelect() {
  const current = matchSelect.value;

  matchSelect.innerHTML =
    '<option value="">اختر مباراة من القائمة</option>';

  matches.forEach(m => {
    const option = document.createElement("option");

    option.value = String(m.id);
    option.textContent =
      `${m.homeTeam.name} × ${m.awayTeam.name} — ${m.competition?.code || "MANUAL"}`;

    matchSelect.appendChild(option);
  });

  if (current && matches.some(m => String(m.id) === current)) {
    matchSelect.value = current;
  }
}

function watchManualMatches() {
  onValue(ref(db, "manualMatches"), snap => {
    manualMatchesByDate = snap.val() || {};
    refreshDisplayedMatches();
  }, error => {
    console.error("Firebase manual matches read error:", error);
  });
}

function watchStreams() {
  if (unsubscribeStreams) unsubscribeStreams();

  unsubscribeStreams = onValue(
    ref(db, "streams"),
    snap => {
      streams = snap.val() || {};
      render();
    },
    error => {
      console.error("Firebase streams read error:", error);
      if (refreshState) {
        refreshState.textContent =
          "تعذر تحميل بيانات البث من Firebase";
      }
    }
  );
}

function showAdmin() {
  adminPanel.classList.remove("hidden");
  adminPanel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

const adminNav = document.getElementById("adminNav");
adminNav.style.display = "none";
adminNav.removeAttribute("href");

function handleAdminRoute() {
  if (location.hash === "#admin") {
    showAdmin();
  } else {
    adminPanel.classList.add("hidden");
  }
}

window.addEventListener("hashchange", handleAdminRoute);

document.querySelectorAll(".day").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".day").forEach(b => {
      b.classList.remove("active");
    });

    button.classList.add("active");

    loadMatches(localDateString(Number(button.dataset.offset)));
  });
});

// Admin login
document.getElementById("loginBtn").addEventListener("click", async () => {
  try {
    await signInWithEmailAndPassword(
      auth,
      emailInput.value.trim(),
      passwordInput.value
    );

    loginMessage.textContent = "تم تسجيل الدخول.";
  } catch (error) {
    console.error("Login error:", error);
    loginMessage.textContent =
      "تعذر تسجيل الدخول. تحقق من البريد وكلمة المرور.";
  }
});

// Password reset
resetPasswordBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();

  if (!email) {
    loginMessage.textContent = "اكتب البريد الإلكتروني أولاً.";
    emailInput.focus();
    return;
  }

  resetPasswordBtn.disabled = true;
  resetPasswordBtn.textContent = "جاري إرسال الرابط...";

  try {
    await sendPasswordResetEmail(auth, email);

    loginMessage.textContent =
      "تم إرسال رابط إعادة تعيين كلمة المرور. افحص بريدك الإلكتروني وصندوق الرسائل غير المرغوب فيها.";

  } catch (error) {
    console.error("Password reset error:", error);

    if (error.code === "auth/user-not-found") {
      loginMessage.textContent =
        "لا يوجد حساب مسجل بهذا البريد الإلكتروني.";
    } else if (error.code === "auth/invalid-email") {
      loginMessage.textContent = "البريد الإلكتروني غير صحيح.";
    } else if (error.code === "auth/too-many-requests") {
      loginMessage.textContent =
        "محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.";
    } else {
      loginMessage.textContent =
        "تعذر إرسال الرابط. تحقق من إعدادات Firebase وحاول مرة أخرى.";
    }

  } finally {
    resetPasswordBtn.disabled = false;
    resetPasswordBtn.textContent = "نسيت كلمة المرور؟";
  }
});

// Add a manually created match to Firebase.
manualMatchDate.value = localDateString(0);

addManualMatchBtn.addEventListener("click", async () => {
  if (!isAdmin) return;

  const date = manualMatchDate.value;
  const homeName = manualHomeTeam.value.trim();
  const awayName = manualAwayTeam.value.trim();
  const homeScoreText = manualHomeScore.value.trim();
  const awayScoreText = manualAwayScore.value.trim();

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !homeName || !awayName) {
    manualMatchMessage.textContent = "أدخل التاريخ واسمَي الفريقين.";
    return;
  }

  const hasHomeScore = homeScoreText !== "";
  const hasAwayScore = awayScoreText !== "";

  if (hasHomeScore !== hasAwayScore) {
    manualMatchMessage.textContent =
      "أدخل نتيجتي الفريقين معاً أو اتركهما فارغتين.";
    return;
  }

  const homeScore = hasHomeScore ? Number(homeScoreText) : null;
  const awayScore = hasAwayScore ? Number(awayScoreText) : null;

  if (hasHomeScore && (
    !Number.isInteger(homeScore) ||
    homeScore < 0 ||
    !Number.isInteger(awayScore) ||
    awayScore < 0
  )) {
    manualMatchMessage.textContent = "أدخل نتيجة صحيحة بالأرقام فقط.";
    return;
  }

  const id = `manual_${Date.now()}`;

  const manualMatch = {
    id,
    date,
    utcDate: new Date(`${date}T12:00:00`).toISOString(),
    status: hasHomeScore ? "FINISHED" : "SCHEDULED",
    manual: true,
    competition: {
      code: "MANUAL",
      name: "مباراة يدوية",
      emblem: ""
    },
    homeTeam: {
      id: null,
      name: homeName,
      shortName: homeName,
      crest: ""
    },
    awayTeam: {
      id: null,
      name: awayName,
      shortName: awayName,
      crest: ""
    },
    score: {
      home: homeScore,
      away: awayScore
    }
  };

  addManualMatchBtn.disabled = true;

  try {
    await set(ref(db, `manualMatches/${date}/${id}`), manualMatch);

    manualMatchMessage.textContent =
      "تمت إضافة المباراة اليدوية بنجاح.";

    manualHomeTeam.value = "";
    manualAwayTeam.value = "";
    manualHomeScore.value = "";
    manualAwayScore.value = "";

    if (date !== selectedDate) {
      selectedDate = date;
      await loadMatches(date);
    }

  } catch (error) {
    console.error("Add manual match error:", error);
    manualMatchMessage.textContent =
      "تعذرت إضافة المباراة. تحقق من صلاحيات Firebase.";

  } finally {
    addManualMatchBtn.disabled = false;
  }
});

// Delete only manually created matches.
// Automatic fixtures are never deleted by this button.
deleteManualMatchBtn.addEventListener("click", async () => {
  if (!isAdmin) return;

  const selected = manualDeleteSelect.value;

  if (!selected) {
    deleteManualMatchMessage.textContent =
      "اختر مباراة يدوية أولاً.";
    return;
  }

  const [date, id] = selected.split("|");
  const match = manualMatchesByDate[date]?.[id];

  if (!match?.manual) {
    deleteManualMatchMessage.textContent =
      "هذه المباراة غير موجودة أو ليست مباراة يدوية.";
    return;
  }

  const confirmed = window.confirm(
    `هل تريد حذف مباراة ${match.homeTeam?.name || ""} ضد ${match.awayTeam?.name || ""}؟`
  );

  if (!confirmed) return;

  deleteManualMatchBtn.disabled = true;

  try {
    await remove(ref(db, `manualMatches/${date}/${id}`));

    // Remove any stream attached to this manual match too.
    await remove(ref(db, `streams/${id}`));

    deleteManualMatchMessage.textContent =
      "تم حذف المباراة اليدوية بنجاح.";

    manualDeleteSelect.value = "";

  } catch (error) {
    console.error("Delete manual match error:", error);
    deleteManualMatchMessage.textContent =
      "تعذر حذف المباراة. تحقق من صلاحيات Firebase.";

  } finally {
    deleteManualMatchBtn.disabled = false;
  }
});

// Admin logout
document.getElementById("logoutBtn").addEventListener("click", () => {
  signOut(auth).catch(error => {
    console.error("Logout error:", error);
  });
});

// Authentication state
onAuthStateChanged(auth, user => {
  isAdmin = Boolean(user);

  loginBox.classList.toggle("hidden", isAdmin);
  streamEditor.classList.toggle("hidden", !isAdmin);
  manualMatchEditor.classList.toggle("hidden", !isAdmin);
  manualDeleteBox.classList.toggle("hidden", !isAdmin);

  document.getElementById("logoutBtn").classList.toggle("hidden", !isAdmin);
});

// Match selection
matchSelect.addEventListener("change", () => {
  const stream = streams[matchSelect.value];

  document.getElementById("embedCode").value =
    stream?.embedCode || "";

  document.getElementById("streamMessage").textContent =
    stream
      ? "يوجد كود بث محفوظ لهذه المباراة."
      : "لا يوجد كود بث محفوظ لهذه المباراة.";
});

// Save stream
document.getElementById("saveStreamBtn").addEventListener("click", async () => {
  if (!isAdmin) return;

  const id = matchSelect.value;
  const embedCode = document.getElementById("embedCode").value.trim();
  const message = document.getElementById("streamMessage");

  if (!id) {
    message.textContent = "اختر مباراة أولاً.";
    return;
  }

  if (!extractIframeSrc(embedCode)) {
    message.textContent =
      "أدخل كود iframe صالحاً يحتوي على رابط src آمن يبدأ بـ https:// أو http://.";
    return;
  }

  try {
    await set(ref(db, `streams/${id}`), {
      embedCode,
      updatedAt: Date.now()
    });

    message.textContent = "تم حفظ كود البث وربطه بالمباراة.";

  } catch (error) {
    message.textContent =
      "فشل الحفظ. تحقق من Firebase Security Rules وصلاحية حساب الإدارة.";

    console.error(error);
  }
});

// Delete stream
document.getElementById("deleteStreamBtn").addEventListener("click", async () => {
  if (!isAdmin) return;

  const id = matchSelect.value;

  if (!id) return;

  try {
    await remove(ref(db, `streams/${id}`));

    document.getElementById("embedCode").value = "";
    document.getElementById("streamMessage").textContent =
      "تم حذف كود البث.";

  } catch (error) {
    document.getElementById("streamMessage").textContent =
      "فشل الحذف. تحقق من صلاحيات Firebase.";

    console.error(error);
  }
});

// Validate iframe embed code
function extractIframeSrc(code) {
  try {
    const doc = new DOMParser().parseFromString(code, "text/html");
    const iframe = doc.querySelector("iframe");

    if (!iframe) return null;

    const url = new URL(iframe.getAttribute("src") || "");

    return ["https:", "http:"].includes(url.protocol)
      ? url.href
      : null;

  } catch {
    return null;
  }
}

// Start application
handleAdminRoute();
watchStreams();
watchManualMatches();
loadMatches(selectedDate);
