import { firebaseConfig } from "./app-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const params = new URLSearchParams(location.search);
const matchId = params.get("id");
const date = params.get("date");
const heading = document.getElementById("matchHeading");
const player = document.getElementById("player");

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
}
function showMessage(title, detail) {
  player.innerHTML = `<div class="player-message"><b>${safeText(title)}</b>${safeText(detail)}</div>`;
}
function teamHtml(team) {
  const crest = team?.crest ? `<img class="crest" src="${safeText(team.crest)}" alt="">` : `<div class="crest-fallback">⚽</div>`;
  return `<div>${crest}<div class="team-name">${safeText(team?.name || "")}</div></div>`;
}
async function load() {
  if (!matchId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    heading.innerHTML = '<div class="empty">رابط المباراة غير صالح.</div>';
    showMessage("لا توجد مباراة محددة", "ارجع إلى جدول المباريات واختر مباراة.");
    return;
  }
  try {
    const [matchResponse, streamSnapshot] = await Promise.all([
      fetch(`/api/matches?date=${encodeURIComponent(date)}`),
      get(ref(db, `streams/${matchId}`))
    ]);
    const matchData = await matchResponse.json();
    const match = (matchData.matches || []).find(m => String(m.id) === matchId);
    if (!match) {
      heading.innerHTML = '<div class="empty">لم يتم العثور على المباراة في بيانات هذا اليوم.</div>';
      showMessage("تعذر العثور على المباراة", "قد تكون بيانات الجدول غير متاحة حالياً.");
      return;
    }
    const home = match.score?.home, away = match.score?.away;
    const score = home === null || away === null ? "VS" : `${home} - ${away}`;
    heading.innerHTML = `<div class="heading-card">${teamHtml(match.homeTeam)}<div><div class="heading-score">${safeText(score)}</div><div class="match-meta">${safeText(match.competition.name)} • ${new Date(match.utcDate).toLocaleString("ar-EG")}</div></div>${teamHtml(match.awayTeam)}</div>`;

    const stream = streamSnapshot.val();
    const code = stream?.embedCode || "";
    if (!code) {
      showMessage("لا يوجد بث مضاف لهذه المباراة", "يمكن لمسؤول الموقع إضافة كود التضمين من لوحة الإدارة.");
      return;
    }
    const doc = new DOMParser().parseFromString(code, "text/html");
    const original = doc.querySelector("iframe");
    if (!original) {
      showMessage("كود التضمين غير صالح", "يجب أن يحتوي الكود على iframe.");
      return;
    }
    const src = new URL(original.getAttribute("src") || "");
    if (!["https:", "http:"].includes(src.protocol)) {
      showMessage("رابط المشغل غير آمن", "استخدم رابط HTTP أو HTTPS صالحاً.");
      return;
    }
    const iframe = document.createElement("iframe");
    iframe.src = src.href;
    iframe.title = `مشغل ${match.homeTeam.name} ضد ${match.awayTeam.name}`;
    iframe.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.loading = "lazy";
    if (original.getAttribute("sandbox")) iframe.setAttribute("sandbox", original.getAttribute("sandbox"));
    player.replaceChildren(iframe);
  } catch (error) {
    console.error(error);
    showMessage("حدث خطأ أثناء تحميل المباراة", "تحقق من اتصال الإنترنت وإعدادات Firebase.");
  }
}
load();
