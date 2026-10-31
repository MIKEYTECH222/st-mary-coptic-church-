
import { supabase } from "./supabase.js";

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let lang = "ar";
let activeQuizPresenceCleanup = null;
let activeExamSession = null;
let sectionSaveTimer = null;

const STATE_TTL_MS = 5 * 60 * 1000;
const ACTIVE_DRAFT_PREFIX = "youth_active_exam_";
const DRAFT_PREFIX = "youth_exam_draft_";
const LAST_SECTION_PREFIX = "youth_last_section_";

document.documentElement.style.colorScheme = "dark";

/* =========================================================
   تنسيق شاشة الامتحان المنفصلة
   ========================================================= */
const examStyles = document.createElement("style");
examStyles.textContent = `
.exam-player-screen {
  position: fixed; inset: 0; z-index: 9999; overflow-y: auto;
  padding: clamp(10px, 3vw, 30px);
  background:
    radial-gradient(circle at 15% 10%, rgba(135,149,255,.16), transparent 35%),
    var(--bg, #101521);
}
.exam-player-shell {
  width: min(860px, 100%); min-height: calc(100vh - 60px);
  margin: 0 auto; padding: clamp(16px, 4vw, 34px);
  display: flex; flex-direction: column; gap: 22px;
  border: 1px solid var(--border, #303b50); border-radius: 24px;
  background: var(--surface, #192131);
  box-shadow: 0 22px 70px rgba(0,0,0,.35);
}
.exam-player-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--border, #303b50);
}
.exam-player-header h2 { margin: 0 0 8px; }
.exam-player-header p { margin: 0; }
.exam-leave-button {
  flex: 0 0 auto; background: var(--surface-2, #222d40);
  color: var(--text, #f2f5fb); border: 1px solid var(--border, #303b50);
}
.exam-progress-wrap { display: grid; gap: 10px; }
.exam-progress-track {
  height: 9px; overflow: hidden; border-radius: 99px;
  background: var(--surface-2, #222d40);
}
.exam-progress-bar {
  height: 100%; width: 0; border-radius: inherit;
  background: var(--primary, #8795ff); transition: width .25s ease;
}
.exam-question-host { flex: 1; display: flex; }
.exam-question-card {
  width: 100%; padding: clamp(18px, 4vw, 32px);
  border: 1px solid var(--border, #303b50); border-radius: 20px;
  background: var(--surface-2, #222d40);
}
.exam-question-number {
  display: inline-flex; padding: 8px 13px; margin-bottom: 14px;
  border-radius: 99px; background: rgba(135,149,255,.15);
  color: var(--primary-hover, #a0abff); font-weight: bold;
}
.exam-question-text {
  margin: 8px 0 24px; font-size: clamp(21px, 3.2vw, 30px);
  line-height: 1.7; overflow-wrap: anywhere;
}
.exam-options { display: grid; gap: 12px; }
.exam-option {
  display: flex; align-items: center; gap: 12px; min-height: 58px;
  padding: 14px 16px; border: 1px solid var(--border, #303b50);
  border-radius: 14px; background: var(--surface, #192131);
  color: var(--text, #f2f5fb); cursor: pointer; line-height: 1.7;
  transition: border-color .2s ease, background .2s ease;
}
.exam-option:has(input:checked) {
  border-color: var(--primary, #8795ff); background: rgba(135,149,255,.13);
}
.exam-option input {
  flex: 0 0 auto; width: 19px; height: 19px; margin: 0;
  accent-color: var(--primary, #8795ff);
}
.exam-option span { overflow-wrap: anywhere; }
.exam-navigation { display: flex; justify-content: space-between; gap: 12px; }
.exam-navigation button { min-width: 145px; }
.exam-submit-button { background: var(--success, #55d6a0); color: #08150f; }
.exam-submit-button[hidden] { display: none !important; }
.exam-player-screen .status { margin: 0; }
@media (max-width: 600px) {
  .exam-player-screen { padding: 7px; }
  .exam-player-shell {
    min-height: calc(100vh - 14px); padding: 15px; border-radius: 18px;
  }
  .exam-player-header { flex-direction: column; }
  .exam-leave-button { width: 100%; }
  .exam-navigation { display: grid; grid-template-columns: 1fr 1fr; }
  .exam-navigation button { min-width: 0; width: 100%; }
  .exam-navigation .exam-submit-button:not([hidden]) { grid-column: 1 / -1; }
}
`;
document.head.appendChild(examStyles);

/* =========================================================
   أدوات عامة ورسائل
   ========================================================= */
function message(id, text) {
  const element = $(id);
  if (element) element.textContent = text || "";
}

function safeText(value) {
  return String(value ?? "");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ar-EG");
}

function addItem(targetId, title, description = "", extra = "") {
  const target = $(targetId);
  if (!target) return;

  const article = document.createElement("article");
  article.className = "item";

  const heading = document.createElement("h3");
  heading.textContent = safeText(title || "بدون عنوان");
  article.appendChild(heading);

  if (description) {
    const p = document.createElement("p");
    p.textContent = safeText(description);
    article.appendChild(p);
  }

  if (extra) {
    const p = document.createElement("p");
    p.textContent = safeText(extra);
    article.appendChild(p);
  }

  target.appendChild(article);
}

function showDashboard(show) {
  $("publicPage")?.classList.toggle("hidden", show);
  $("dashboard")?.classList.toggle("hidden", !show);
  $("logoutBtn")?.classList.toggle("hidden", !show);
  $("authForms")?.classList.toggle("hidden", show);

  const hashId = location.hash.replace(/^#/, "");
  if (show) {
    const target = hashId ? document.getElementById(hashId) : null;
    const targetIsDashboard = target && $("dashboard")?.contains(target);
    if (!targetIsDashboard && hashId !== "dashboard") {
      history.replaceState(null, "", "#dashboard");
    }
  } else {
    const publicSections = ["home", "events", "lessons", "account"];
    if (!publicSections.includes(hashId)) {
      history.replaceState(null, "", "#account");
    }
  }
}

/* =========================================================
   حفظ آخر قسم مفتوح لمدة 5 دقائق
   ========================================================= */
function userStorageKey(prefix) {
  return prefix + (currentUser?.id || "guest");
}

function sectionStorageKey() {
  return userStorageKey(LAST_SECTION_PREFIX);
}

function saveLastSection(sectionId, updateTime = true) {
  if (!sectionId || !document.getElementById(sectionId)) return;
  try {
    const previous = JSON.parse(localStorage.getItem(sectionStorageKey()) || "{}");
    localStorage.setItem(sectionStorageKey(), JSON.stringify({
      sectionId,
      savedAt: updateTime ? Date.now() : (previous.savedAt || Date.now())
    }));
  } catch (error) {
    console.warn("تعذر حفظ آخر قسم:", error);
  }
}

function getCurrentSection() {
  const hashId = location.hash.replace(/^#/, "");
  if (hashId && hashId !== "dashboard" && document.getElementById(hashId)) {
    return hashId;
  }

  const sections = currentUser
    ? ["profilePanel", "myEvents", "myLessons", "myQuizzes", "servantPanel", "adminPanel"]
    : ["home", "events", "lessons", "account"];

  let nearest = null;
  let nearestDistance = Infinity;

  sections.forEach(id => {
    const element = document.getElementById(id);
    if (!element || element.classList.contains("hidden")) return;
    const rect = element.getBoundingClientRect();
    const distance = Math.abs(rect.top - 90);
    if (rect.bottom > 0 && rect.top < window.innerHeight && distance < nearestDistance) {
      nearest = id;
      nearestDistance = distance;
    }
  });

  return nearest || (currentUser ? "dashboard" : "home");
}

function restoreLastSection() {
  try {
    const saved = JSON.parse(localStorage.getItem(sectionStorageKey()) || "null");
    if (!saved || !saved.sectionId || !Number.isFinite(Number(saved.savedAt))) return false;

    if (Date.now() - Number(saved.savedAt) > STATE_TTL_MS) {
      localStorage.removeItem(sectionStorageKey());
      return false;
    }

    const target = document.getElementById(saved.sectionId);
    if (!target) return false;

    history.replaceState(null, "", "#" + saved.sectionId);
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return true;
  } catch (error) {
    console.warn("تعذر استرجاع آخر قسم:", error);
    return false;
  }
}

window.addEventListener("hashchange", () => {
  const id = location.hash.replace(/^#/, "");
  if (id && document.getElementById(id)) saveLastSection(id);
});

document.addEventListener("click", event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const id = link.getAttribute("href").slice(1);
  if (id) saveLastSection(id);
}, true);

window.addEventListener("scroll", () => {
  if (activeExamSession) return;
  clearTimeout(sectionSaveTimer);
  sectionSaveTimer = setTimeout(() => saveLastSection(getCurrentSection()), 250);
}, { passive: true });

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    if (activeExamSession) saveCurrentExamDraft();
    saveLastSection(getCurrentSection());
  } else if (!activeExamSession) {
    restoreLastSection();
  }
});

window.addEventListener("pagehide", () => {
  if (activeExamSession) saveCurrentExamDraft();
  saveLastSection(getCurrentSection());
});

/* =========================================================
   حفظ الامتحان والإجابات ورقم السؤال لمدة 5 دقائق
   ========================================================= */
function draftKey(quizId) {
  return DRAFT_PREFIX + currentUser.id + "_" + quizId;
}

function activeDraftKey() {
  return ACTIVE_DRAFT_PREFIX + currentUser.id;
}

function getActiveDraftId() {
  if (!currentUser) return null;
  try {
    return localStorage.getItem(activeDraftKey());
  } catch {
    return null;
  }
}

function getQuizDraft(quizId) {
  if (!currentUser) return null;

  try {
    const raw = localStorage.getItem(draftKey(quizId));
    if (!raw) return null;

    const draft = JSON.parse(raw);
    const timestamp = Date.parse(draft.updatedAt || draft.savedAt || "");

    if (
      draft.userId !== currentUser.id ||
      draft.quizId !== quizId ||
      !Number.isFinite(timestamp) ||
      Date.now() - timestamp > STATE_TTL_MS
    ) {
      clearQuizDraft(quizId);
      return null;
    }

    return draft;
  } catch (error) {
    console.warn("تعذر قراءة مسودة الامتحان:", error);
    return null;
  }
}

function saveQuizDraft(quizId, answers, currentIndex = 0) {
  if (!currentUser) return;

  try {
    const now = new Date().toISOString();
    localStorage.setItem(draftKey(quizId), JSON.stringify({
      quizId,
      userId: currentUser.id,
      answers: answers || {},
      currentIndex: Math.max(0, Number(currentIndex) || 0),
      savedAt: now,
      updatedAt: now
    }));

    localStorage.setItem(activeDraftKey(), quizId);
  } catch (error) {
    console.error("تعذر حفظ الامتحان:", error);
  }
}

function clearQuizDraft(quizId) {
  if (!currentUser) return;
  try {
    localStorage.removeItem(draftKey(quizId));
    if (getActiveDraftId() === quizId) {
      localStorage.removeItem(activeDraftKey());
    }
  } catch (error) {
    console.warn("تعذر حذف مسودة الامتحان:", error);
  }
}

function saveCurrentExamDraft() {
  if (!activeExamSession) return;
  saveQuizDraft(
    activeExamSession.quizId,
    activeExamSession.answers,
    activeExamSession.currentIndex
  );
}

function collectQuizAnswers(form, questions) {
  const answers = {};
  questions.forEach(question => {
    const selected = form.querySelector(
      'input[name="q_' + question.id + '"]:checked'
    );
    if (selected) answers[question.id] = Number(selected.value);
  });
  return answers;
}

/* =========================================================
   تسجيل خروج وعودة الطالب أثناء الامتحان
   ========================================================= */
async function sendQuizPresence(quizId, eventType) {
  try {
    const { error } = await supabase.rpc("quiz_presence_ping", {
      p_quiz_id: quizId,
      p_event: eventType
    });
    if (error) console.warn("Quiz presence:", error.message);
  } catch (error) {
    console.warn("تعذر تسجيل حالة الوجود:", error);
  }
}

async function startQuizPresenceTracking(quizId, isResume = false) {
  if (activeQuizPresenceCleanup) activeQuizPresenceCleanup();

  await sendQuizPresence(quizId, isResume ? "return" : "start");

  let hidden = document.visibilityState === "hidden";

  const onVisibilityChange = () => {
    const nextHidden = document.visibilityState === "hidden";

    if (nextHidden && !hidden) {
      saveCurrentExamDraft();
      sendQuizPresence(quizId, "leave");
    } else if (!nextHidden && hidden) {
      sendQuizPresence(quizId, "return");
    }
    hidden = nextHidden;
  };

  const onPageHide = () => {
    saveCurrentExamDraft();
    sendQuizPresence(quizId, "leave");
  };

  const onPageShow = event => {
    if (event.persisted) sendQuizPresence(quizId, "return");
  };

  const heartbeat = setInterval(() => {
    if (!hidden) {
      saveCurrentExamDraft();
      sendQuizPresence(quizId, "heartbeat");
    }
  }, 15000);

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  activeQuizPresenceCleanup = () => {
    clearInterval(heartbeat);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    activeQuizPresenceCleanup = null;
  };
}

/* =========================================================
   تحميل الفعاليات والدروس
   ========================================================= */
async function loadEvents(targetId) {
  const target = $(targetId);
  if (!target) return;
  target.replaceChildren();

  const { data, error } = await supabase
    .from("events")
    .select("title,description,location,starts_at")
    .order("starts_at", { ascending: true });

  if (error) {
    addItem(targetId, "تعذر تحميل الفعاليات", error.message);
    return;
  }

  if (!data?.length) {
    addItem(targetId, "لا توجد فعاليات حاليًا", "ستظهر الفعاليات هنا بعد إضافتها.");
    return;
  }

  data.forEach(item => {
    addItem(
      targetId,
      item.title,
      item.description,
      [item.location, formatDate(item.starts_at)].filter(Boolean).join(" • ")
    );
  });
}

async function loadLessons(targetId) {
  const target = $(targetId);
  if (!target) return;
  target.replaceChildren();

  const { data, error } = await supabase
    .from("lessons")
    .select("id,title,description,content_url,body,group_id,lesson_type")
    .order("id", { ascending: false });

  if (error) {
    addItem(targetId, "تعذر تحميل الدروس", error.message);
    return;
  }

  if (!data?.length) {
    addItem(targetId, "لا توجد دروس حاليًا", "ستظهر الدروس هنا بعد إضافتها.");
    return;
  }

  data.forEach(lesson => {
    const article = document.createElement("article");
    article.className = "item";

    const heading = document.createElement("h3");
    heading.textContent = lesson.title || "درس";
    article.appendChild(heading);

    const description = document.createElement("p");
    description.textContent = lesson.description || "";
    article.appendChild(description);

    if (lesson.body) {
      const body = document.createElement("div");
      body.className = "lesson-body";
      body.textContent = lesson.body;
      article.appendChild(body);
    }

    if (lesson.content_url) {
      const link = document.createElement("a");
      link.className = "button primary";
      link.href = lesson.content_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "فتح الدرس ↗";
      article.appendChild(link);
    }

    target.appendChild(article);
  });
}

/* =========================================================
   الأعضاء والمجموعات
   ========================================================= */
async function loadAssignedMembers() {
  const select = $("pointsMember");
  if (!select || !currentProfile || !currentUser) return;

  select.replaceChildren(new Option("اختار العضو", ""));

  if (currentProfile.role === "admin") {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,full_name,group_id")
      .eq("approval_status", "approved")
      .order("full_name");

    if (error) {
      message("pointsMessage", "تعذر تحميل الأعضاء: " + error.message);
      return;
    }

    (data || []).forEach(member => {
      select.add(new Option(member.full_name || member.id, member.id));
    });
    return;
  }

  const { data: assignments, error: assignmentError } = await supabase
    .from("servant_group_assignments")
    .select("group_id")
    .eq("servant_id", currentUser.id);

  if (assignmentError) {
    message("pointsMessage", "تعذر تحميل مجموعاتك: " + assignmentError.message);
    return;
  }

  const groupIds = [...new Set((assignments || []).map(item => item.group_id))];

  if (!groupIds.length) {
    message("pointsMessage", "لم يتم تعيينك على أي مجموعة بعد.");
    return;
  }

  const { data: members, error: membersError } = await supabase
    .from("profiles")
    .select("id,full_name,group_id")
    .eq("approval_status", "approved")
    .in("group_id", groupIds)
    .order("full_name");

  if (membersError) {
    message("pointsMessage", "تعذر تحميل أعضاء مجموعاتك: " + membersError.message);
    return;
  }

  (members || []).forEach(member => {
    select.add(new Option(member.full_name || member.id, member.id));
  });

  if (!members?.length) message("pointsMessage", "لا يوجد أعضاء ظاهرون في مجموعاتك.");
}

async function loadServantGroups() {
  const idsResult = currentProfile?.role === "admin"
    ? null
    : await supabase
        .from("servant_group_assignments")
        .select("group_id")
        .eq("servant_id", currentUser.id);

  if (idsResult?.error) {
    message("lessonCreateMessage", "تعذر تحميل المجموعات: " + idsResult.error.message);
    return;
  }

  let query = supabase.from("ministry_groups").select("id,name").order("name");

  if (idsResult) {
    const ids = [...new Set((idsResult.data || []).map(item => item.group_id))];
    if (!ids.length) {
      ["lessonGroup", "quizGroup", "attendanceGroup"].forEach(id => {
        $(id)?.replaceChildren(new Option("لا توجد مجموعات معينة لك", ""));
      });
      return;
    }
    query = query.in("id", ids);
  }

  const { data, error } = await query;
  if (error) {
    message("lessonCreateMessage", "تعذر تحميل المجموعات: " + error.message);
    return;
  }

  ["lessonGroup", "quizGroup", "attendanceGroup"].forEach(id => {
    const select = $(id);
    if (!select) return;
    select.replaceChildren(new Option("اختار المجموعة", ""));
    (data || []).forEach(group => select.add(new Option(group.name, group.id)));
  });
}

async function loadQuizDropdowns() {
  const [quizzesResult, lessonsResult] = await Promise.all([
    supabase.from("quizzes").select("id,title,quiz_type").order("created_at", { ascending: false }),
    supabase.from("lessons").select("id,title").order("id", { ascending: false })
  ]);

  if (!quizzesResult.error) {
    const select = $("questionQuiz");
    if (select) {
      select.replaceChildren(new Option("اختار الاختبار", ""));
      (quizzesResult.data || []).forEach(quiz => {
        select.add(new Option(
          (quiz.title || "اختبار") + (quiz.quiz_type === "lesson" ? " (أسئلة درس)" : " (امتحان)"),
          quiz.id
        ));
      });
    }
  } else {
    message("questionCreateMessage", "تعذر تحميل الاختبارات: " + quizzesResult.error.message);
  }

  if (!lessonsResult.error) {
    const select = $("quizLesson");
    if (select) {
      select.replaceChildren(new Option("اختار الدرس", ""));
      (lessonsResult.data || []).forEach(lesson => {
        select.add(new Option(lesson.title, lesson.id));
      });
    }
  }
}

/* =========================================================
   الامتحانات - استرجاع المحاولة السابقة
   ========================================================= */
async function getQuizAttempt(quizId, memberId) {
  return await supabase
    .from("quiz_attempts")
    .select("id,score,max_score,submitted_at,points_awarded")
    .eq("quiz_id", quizId)
    .eq("member_id", memberId)
    .maybeSingle();
}

function showCompletedQuiz(article, attempt) {
  const completed = document.createElement("p");
  completed.className = "status success";
  completed.textContent =
    `تم تسليم الامتحان بالفعل. نتيجتك: ${attempt.score} من ${attempt.max_score} • النقاط المكتسبة: ${attempt.points_awarded ?? 0}`;
  article.appendChild(completed);
}

/* =========================================================
   مشغل الامتحان: سؤال واحد في شاشة مستقلة
   ========================================================= */
async function openQuiz(quiz, article, startButton, forceResume = false) {
  startButton.disabled = true;

  const { data: latestAttempt, error: attemptError } =
    await getQuizAttempt(quiz.id, currentUser.id);

  if (attemptError) {
    startButton.disabled = false;
    message("questionCreateMessage", "تعذر التحقق من المحاولة السابقة: " + attemptError.message);
    return;
  }

  if (latestAttempt) {
    startButton.remove();
    showCompletedQuiz(article, latestAttempt);
    clearQuizDraft(quiz.id);
    return;
  }

  const { data: questions, error: questionsError } = await supabase
    .from("quiz_questions")
    .select("id,question_text,options,position")
    .eq("quiz_id", quiz.id)
    .order("position");

  if (questionsError) {
    startButton.disabled = false;
    message("questionCreateMessage", "تعذر تحميل الأسئلة: " + questionsError.message);
    return;
  }

  if (!questions?.length) {
    startButton.disabled = false;
    message("questionCreateMessage", "الامتحان لا يحتوي على أسئلة.");
    return;
  }

  const draft = getQuizDraft(quiz.id);
  const answers = { ...(draft?.answers || {}) };
  let currentIndex = Math.min(
    Math.max(0, Number(draft?.currentIndex || 0)),
    questions.length - 1
  );

  await startQuizPresenceTracking(quiz.id, forceResume || Boolean(draft));
  saveLastSection("myQuizzes");

  const screen = document.createElement("section");
  screen.className = "exam-player-screen";
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-label", "صفحة الامتحان");

  const shell = document.createElement("div");
  shell.className = "exam-player-shell";

  const header = document.createElement("div");
  header.className = "exam-player-header";

  const headingBox = document.createElement("div");
  const heading = document.createElement("h2");
  heading.textContent = quiz.title || "الامتحان";
  const subtitle = document.createElement("p");
  subtitle.className = "muted";
  subtitle.textContent = "اختار إجابتك ثم اضغط على السؤال التالي.";
  headingBox.append(heading, subtitle);

  const leaveButton = document.createElement("button");
  leaveButton.type = "button";
  leaveButton.className = "exam-leave-button";
  leaveButton.textContent = "حفظ والخروج";
  header.append(headingBox, leaveButton);

  const progressWrap = document.createElement("div");
  progressWrap.className = "exam-progress-wrap";
  const progressText = document.createElement("strong");
  const progressTrack = document.createElement("div");
  progressTrack.className = "exam-progress-track";
  const progressBar = document.createElement("div");
  progressBar.className = "exam-progress-bar";
  progressTrack.appendChild(progressBar);
  progressWrap.append(progressText, progressTrack);

  const questionHost = document.createElement("div");
  questionHost.className = "exam-question-host";

  const navigation = document.createElement("div");
  navigation.className = "exam-navigation";

  const previousButton = document.createElement("button");
  previousButton.type = "button";
  previousButton.textContent = "السؤال السابق";

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "primary";
  nextButton.textContent = "السؤال التالي";

  const submitButton = document.createElement("button");
  submitButton.type = "button";
  submitButton.className = "primary exam-submit-button";
  submitButton.textContent = "تسليم الامتحان";
  submitButton.hidden = true;

  navigation.append(previousButton, nextButton, submitButton);

  const status = document.createElement("p");
  status.className = "status";
  status.textContent = "يتم حفظ إجاباتك ورقم السؤال تلقائيًا لمدة 5 دقائق بعد الخروج.";

  shell.append(header, progressWrap, questionHost, navigation, status);
  screen.appendChild(shell);
  document.body.appendChild(screen);

  activeExamSession = {
    quizId: quiz.id,
    answers,
    currentIndex,
    questions
  };

  startButton.remove();

  function persist() {
    if (!activeExamSession) return;
    activeExamSession.answers = answers;
    activeExamSession.currentIndex = currentIndex;
    saveQuizDraft(quiz.id, answers, currentIndex);
  }

  function renderQuestion() {
    const question = questions[currentIndex];
    questionHost.replaceChildren();

    const card = document.createElement("article");
    card.className = "exam-question-card";

    const number = document.createElement("span");
    number.className = "exam-question-number";
    number.textContent = "السؤال " + (currentIndex + 1);

    const questionText = document.createElement("h3");
    questionText.className = "exam-question-text";
    questionText.textContent = question.question_text || "سؤال بدون عنوان";

    const optionsBox = document.createElement("div");
    optionsBox.className = "exam-options";

    (question.options || []).forEach((optionText, optionIndex) => {
      const label = document.createElement("label");
      label.className = "exam-option";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "q_" + question.id;
      radio.value = String(optionIndex);
      radio.checked =
        answers[question.id] !== undefined &&
        Number(answers[question.id]) === optionIndex;

      const optionLabel = document.createElement("span");
      optionLabel.textContent = safeText(optionText);

      label.append(radio, optionLabel);
      optionsBox.appendChild(label);

      radio.addEventListener("change", () => {
        answers[question.id] = optionIndex;
        persist();
        status.className = "status success";
        status.textContent = "تم حفظ إجابتك.";
      });
    });

    card.append(number, questionText, optionsBox);
    questionHost.appendChild(card);

    progressText.textContent =
      "السؤال " + (currentIndex + 1) + " من " + questions.length;
    progressBar.style.width =
      ((currentIndex + 1) / questions.length * 100) + "%";

    previousButton.disabled = currentIndex === 0;
    nextButton.hidden = currentIndex === questions.length - 1;
    submitButton.hidden = currentIndex !== questions.length - 1;

    persist();
  }

  previousButton.addEventListener("click", () => {
    if (currentIndex <= 0) return;
    currentIndex -= 1;
    renderQuestion();
  });

  nextButton.addEventListener("click", () => {
    if (currentIndex >= questions.length - 1) return;
    currentIndex += 1;
    renderQuestion();
  });

  leaveButton.addEventListener("click", async () => {
    persist();
    await sendQuizPresence(quiz.id, "leave");
    if (activeQuizPresenceCleanup) activeQuizPresenceCleanup();
    activeExamSession = null;
    screen.remove();

    const resumeButton = document.createElement("button");
    resumeButton.type = "button";
    resumeButton.className = "primary";
    resumeButton.textContent = "استكمال الامتحان";
    resumeButton.addEventListener("click", () => {
      openQuiz(quiz, article, resumeButton, true);
    });
    article.appendChild(resumeButton);
    resumeButton.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  submitButton.addEventListener("click", async () => {
    if (Object.keys(answers).length !== questions.length) {
      status.className = "status error";
      status.textContent = "فيه سؤال أو أكثر من غير إجابة. ارجع للأسئلة الناقصة قبل التسليم.";
      return;
    }

    persist();
    submitButton.disabled = true;
    previousButton.disabled = true;
    nextButton.disabled = true;
    leaveButton.disabled = true;
    submitButton.textContent = "جاري تسليم الامتحان...";

    const { data: submissionData, error: submissionError } = await supabase.rpc(
      "submit_quiz",
      {
        p_quiz_id: quiz.id,
        p_answers: answers
      }
    );

    if (submissionError) {
      submitButton.disabled = false;
      previousButton.disabled = false;
      leaveButton.disabled = false;
      submitButton.textContent = "تسليم الامتحان";
      status.className = "status error";
      status.textContent = "فشل التسليم: " + submissionError.message;
      return;
    }

    const score = Array.isArray(submissionData)
      ? submissionData[0]
      : submissionData;

    await sendQuizPresence(quiz.id, "finish");
    if (activeQuizPresenceCleanup) activeQuizPresenceCleanup();
    activeExamSession = null;
    clearQuizDraft(quiz.id);
    screen.remove();

    const { data: savedAttempt } = await getQuizAttempt(quiz.id, currentUser.id);
    let pointsAwarded = Number(savedAttempt?.points_awarded || 0);

    if (!savedAttempt && score?.total_questions > 0) {
      pointsAwarded = Math.floor(
        Number(quiz.points_reward || 0) *
        Number(score.final_score || 0) /
        Number(score.total_questions)
      );
    }

    const result = document.createElement("p");
    result.className = "status success";
    result.textContent =
      "تم التسليم بنجاح! نتيجتك: " + score.final_score +
      " من " + score.total_questions +
      " • حصلت على " + pointsAwarded + " نقطة.";
    article.appendChild(result);

    await refreshSession();
    await loadQuizzes();
  });

  renderQuestion();
  screen.scrollIntoView({ behavior: "auto", block: "start" });
}

/* =========================================================
   تحميل وعرض قائمة الامتحانات
   ========================================================= */
async function loadQuizzes() {
  const target = $("quizzesList");
  if (!target || !currentUser || !currentProfile) return;
  target.replaceChildren();

  const { data, error } = await supabase
    .from("quizzes")
    .select("id,title,description,quiz_type,group_id,is_published,created_by,points_reward,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    addItem("quizzesList", "تعذر تحميل الاختبارات", error.message);
    return;
  }

  const visible = (data || []).filter(quiz =>
    quiz.is_published ||
    quiz.created_by === currentUser.id ||
    currentProfile.role === "admin"
  );

  if (!visible.length) {
    addItem("quizzesList", "لا توجد أسئلة أو امتحانات منشورة حاليًا", "");
    return;
  }

  const activeDraftId = getActiveDraftId();
  let resumeTarget = null;

  for (const quiz of visible) {
    const article = document.createElement("article");
    article.className = "item";

    const title = document.createElement("h3");
    title.textContent = quiz.title || "اختبار";
    article.appendChild(title);

    const description = document.createElement("p");
    description.textContent =
      (quiz.quiz_type === "lesson" ? "أسئلة بعد الدرس" : "امتحان مستقل") +
      " • " + (quiz.description || "") +
      (Number(quiz.points_reward || 0) > 0
        ? " • المكافأة: " + quiz.points_reward + " نقطة"
        : "");
    article.appendChild(description);

    const canManage =
      quiz.created_by === currentUser.id ||
      currentProfile.role === "admin";

    if (canManage) {
      const publish = document.createElement("button");
      publish.type = "button";
      publish.textContent = quiz.is_published ? "إلغاء النشر" : "نشر الاختبار";

      publish.addEventListener("click", async () => {
        publish.disabled = true;
        const { error: publishError } = await supabase.rpc("set_quiz_published", {
          p_quiz_id: quiz.id,
          p_published: !quiz.is_published
        });

        if (publishError) {
          publish.disabled = false;
          message("questionCreateMessage", "تعذر تغيير حالة النشر: " + publishError.message);
          return;
        }
        await loadQuizzes();
      });

      article.appendChild(publish);
    }

    if (quiz.is_published && currentProfile.approval_status === "approved") {
      const { data: previousAttempt, error: attemptError } =
        await getQuizAttempt(quiz.id, currentUser.id);

      if (attemptError) {
        addItem("quizzesList", "تعذر التحقق من حالة امتحان", attemptError.message);
      } else if (previousAttempt) {
        showCompletedQuiz(article, previousAttempt);
        clearQuizDraft(quiz.id);
      } else {
        const draft = getQuizDraft(quiz.id);

        const startButton = document.createElement("button");
        startButton.type = "button";
        startButton.className = "primary";
        startButton.textContent = draft ? "استكمال الامتحان" : "حل الاختبار";

        startButton.addEventListener("click", () => {
          openQuiz(quiz, article, startButton, Boolean(draft));
        });

        article.appendChild(startButton);

        if (!resumeTarget && activeDraftId === quiz.id && draft) {
          resumeTarget = { quiz, article, button: startButton };
        }
      }
    }

    target.appendChild(article);
  }

  // استكمال الامتحان تلقائيًا إذا رجع الطالب خلال خمس دقائق
  if (resumeTarget) {
    await openQuiz(
      resumeTarget.quiz,
      resumeTarget.article,
      resumeTarget.button,
      true
    );
  }
}

/* =========================================================
   الحضور والغياب
   ========================================================= */
async function loadAttendanceRoster() {
  const groupId = $("attendanceGroup")?.value;
  const date = $("attendanceDate")?.value;
  const title = $("attendanceTitle")?.value.trim() || "لقاء الخدمة";
  const target = $("attendanceRoster");

  if (!target) return;
  target.replaceChildren();

  if (!groupId || !date) {
    message("attendanceMessage", "اختار المجموعة والتاريخ.");
    return;
  }

  message("attendanceMessage", "جاري تحميل الأسماء...");

  const { data: members, error: membersError } = await supabase
    .from("profiles")
    .select("id,full_name")
    .eq("group_id", groupId)
    .eq("approval_status", "approved")
    .order("full_name");

  if (membersError) {
    message("attendanceMessage", "تعذر تحميل الأعضاء: " + membersError.message);
    return;
  }

  const { data: session, error: sessionError } = await supabase
    .from("attendance_sessions")
    .select("id")
    .eq("group_id", groupId)
    .eq("session_date", date)
    .eq("title", title)
    .maybeSingle();

  if (sessionError) {
    message("attendanceMessage", "تعذر قراءة اللقاء: " + sessionError.message);
    return;
  }

  let records = [];
  if (session) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("member_id,status")
      .eq("session_id", session.id);

    if (error) {
      message("attendanceMessage", "تعذر تحميل الحضور السابق: " + error.message);
      return;
    }
    records = data || [];
  }

  const saved = new Map(records.map(record => [record.member_id, record.status]));

  (members || []).forEach(member => {
    const row = document.createElement("div");
    row.className = "item";

    const label = document.createElement("label");
    label.textContent = member.full_name || member.id;

    const select = document.createElement("select");
    select.dataset.memberId = member.id;
    select.add(new Option("حاضر (+20 نقطة)", "present"));
    select.add(new Option("غائب", "absent"));
    select.add(new Option("لم يتم التسجيل", "unmarked"));
    select.value = saved.get(member.id) || "unmarked";

    row.append(label, select);
    target.appendChild(row);
  });

  target.dataset.sessionId = session?.id || "";
  message("attendanceMessage", `عدد الأعضاء: ${(members || []).length}. اختار حالة كل عضو ثم احفظ.`);
}

async function saveAttendanceRoster() {
  const groupId = $("attendanceGroup")?.value;
  const date = $("attendanceDate")?.value;
  const title = $("attendanceTitle")?.value.trim() || "لقاء الخدمة";

  if (!groupId || !date) {
    message("attendanceMessage", "اختار المجموعة والتاريخ.");
    return;
  }

  const { data: session, error: sessionError } = await supabase
    .from("attendance_sessions")
    .upsert({
      group_id: groupId,
      session_date: date,
      title,
      created_by: currentUser.id
    }, { onConflict: "group_id,session_date,title" })
    .select("id")
    .single();

  if (sessionError) {
    message("attendanceMessage", "فشل إنشاء اللقاء: " + sessionError.message);
    return;
  }

  const selects = [...$("attendanceRoster").querySelectorAll("select[data-member-id]")];

  for (const select of selects) {
    if (select.value === "unmarked") continue;

    const { error } = await supabase
      .from("attendance_records")
      .upsert({
        session_id: session.id,
        member_id: select.dataset.memberId,
        status: select.value,
        marked_by: currentUser.id
      }, { onConflict: "session_id,member_id" });

    if (error) {
      message("attendanceMessage", "فشل حفظ الحضور: " + error.message);
      return;
    }
  }

  message("attendanceMessage", "تم حفظ كشف الحضور. راجع إعدادات النقاط التلقائية في قاعدة البيانات.");
  await loadServantNotifications();
}

async function loadServantNotifications() {
  const target = $("servantNotifications");
  if (!target) return;
  target.replaceChildren();

  const { data, error } = await supabase
    .from("site_notifications")
    .select("id,message,created_at,read_at")
    .order("created_at", { ascending: false });

  if (error) {
    addItem("servantNotifications", "تعذر تحميل التنبيهات", error.message);
    return;
  }

  if (!data?.length) {
    addItem("servantNotifications", "لا توجد تنبيهات غياب حاليًا", "");
    return;
  }

  data.forEach(notification => {
    const article = document.createElement("article");
    article.className = "item";

    const p = document.createElement("p");
    p.textContent = notification.message + " • " + formatDate(notification.created_at);
    article.appendChild(p);

    if (!notification.read_at) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "تمت المتابعة";

      button.addEventListener("click", async () => {
        const { error: updateError } = await supabase
          .from("site_notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", notification.id);

        if (updateError) {
          message("attendanceMessage", "تعذر تحديث التنبيه: " + updateError.message);
        } else {
          await loadServantNotifications();
        }
      });

      article.appendChild(button);
    }

    target.appendChild(article);
  });
}

/* =========================================================
   إدارة حسابات الخدام والمجموعات
   ========================================================= */
async function loadAdminData() {
  const servantsSelect = $("servantSelect");
  const groupsSelect = $("groupSelect");
  if (!servantsSelect || !groupsSelect) return;

  servantsSelect.replaceChildren(new Option("اختار الخادم", ""));
  groupsSelect.replaceChildren(new Option("اختار المجموعة", ""));

  const [servantsResult, groupsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id,full_name")
      .eq("role", "servant")
      .eq("approval_status", "approved")
      .order("full_name"),
    supabase
      .from("ministry_groups")
      .select("id,name")
      .order("name")
  ]);

  if (servantsResult.error) {
    message("assignMessage", "تعذر تحميل الخدام: " + servantsResult.error.message);
  } else {
    (servantsResult.data || []).forEach(servant => {
      servantsSelect.add(new Option(servant.full_name || servant.id, servant.id));
    });
  }

  if (groupsResult.error) {
    message("assignMessage", "تعذر تحميل المجموعات: " + groupsResult.error.message);
  } else {
    (groupsResult.data || []).forEach(group => {
      groupsSelect.add(new Option(group.name, group.id));
    });
  }

  await loadAssignments();
}

async function loadAssignments() {
  const target = $("assignmentsList");
  if (!target) return;
  target.replaceChildren();

  const { data, error } = await supabase
    .from("servant_group_assignments")
    .select("servant_id,group_id,profiles:servant_id(full_name),ministry_groups:group_id(name)")
    .order("created_at", { ascending: false });

  if (error) {
    addItem("assignmentsList", "تعذر تحميل التعيينات", error.message);
    return;
  }

  if (!data?.length) {
    addItem("assignmentsList", "لا توجد تعيينات بعد", "");
    return;
  }

  data.forEach(item => {
    addItem(
      "assignmentsList",
      item.profiles?.full_name || item.servant_id,
      item.ministry_groups?.name || item.group_id
    );
  });
}

/* =========================================================
   تحديث الجلسة والملف الشخصي
   ========================================================= */
async function refreshSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    currentUser = null;
    currentProfile = null;
    showDashboard(false);
    return;
  }

  currentUser = data.session.user;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id,full_name,role,approval_status,points,group_id")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (profileError || !profile) {
    showDashboard(false);
    message(
      "accountMessage",
      "تعذر تحميل بيانات الحساب: " +
      (profileError?.message || "لم يتم العثور على الملف الشخصي")
    );
    return;
  }

  currentProfile = profile;

  $("dashName").textContent = profile.full_name || currentUser.email || "—";
  $("dashPoints").textContent = String(profile.points ?? 0);

  const statusLabels = {
    approved: "تمت الموافقة",
    pending: "في انتظار موافقة المسؤول",
    rejected: "تم رفض الحساب"
  };

  $("dashStatus").textContent =
    statusLabels[profile.approval_status] || profile.approval_status || "غير معروف";
  $("dashRole").textContent = "الدور: " + profile.role;

  showDashboard(true);

  const approved = profile.approval_status === "approved";
  const isAdmin = profile.role === "admin";
  const isServant = profile.role === "servant";

  $("servantPanel")?.classList.toggle("hidden", !(approved && (isAdmin || isServant)));
  $("adminPanel")?.classList.toggle("hidden", !(approved && isAdmin));

  await Promise.all([
    loadEvents("dashboardEventsList"),
    loadLessons("dashboardLessonsList"),
    loadQuizzes()
  ]);

  if (approved && (isAdmin || isServant)) {
    await Promise.all([
      loadAssignedMembers(),
      loadServantGroups(),
      loadQuizDropdowns(),
      loadServantNotifications()
    ]);

    if ($("quizLesson") && $("quizType")) {
      $("quizLesson").disabled = $("quizType").value !== "lesson";
      $("quizLesson").required = $("quizType").value === "lesson";
    }
  }

  if (approved && isAdmin) {
    await loadAdminData();
  }
}

/* =========================================================
   إنشاء الحساب وتسجيل الدخول
   ========================================================= */
$("signupForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  message("signupMessage", "جاري إنشاء الحساب...");

  const fullName = $("signupName").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: location.origin + location.pathname
    }
  });

  if (error) {
    message("signupMessage", error.message);
    return;
  }

  message(
    "signupMessage",
    data.session
      ? "تم إنشاء الحساب. حسابك في انتظار موافقة المسؤول."
      : "راجع بريدك الإلكتروني لتأكيد الحساب، ثم انتظر موافقة المسؤول."
  );
});

$("loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  message("loginMessage", "جاري تسجيل الدخول...");

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    message("loginMessage", error.message);
    return;
  }

  message("loginMessage", "تم تسجيل الدخول.");
  await refreshSession();
});

$("googleLoginBtn")?.addEventListener("click", async () => {
  message("googleMessage", "جاري فتح تسجيل الدخول باستخدام Google...");

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname }
  });

  if (error) message("googleMessage", "فشل تسجيل الدخول: " + error.message);
});

$("logoutBtn")?.addEventListener("click", async () => {
  if (activeExamSession) {
    saveCurrentExamDraft();
    await sendQuizPresence(activeExamSession.quizId, "leave");
    activeExamSession = null;
  }

  if (activeQuizPresenceCleanup) activeQuizPresenceCleanup();

  const { error } = await supabase.auth.signOut();
  if (error) {
    message("accountMessage", error.message);
    return;
  }

  currentUser = null;
  currentProfile = null;
  showDashboard(false);
});

/* =========================================================
   إضافة وخصم النقاط
   ========================================================= */
$("pointsForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  message("pointsMessage", "جاري تنفيذ العملية...");

  if (
    !currentProfile ||
    !["admin", "servant"].includes(currentProfile.role) ||
    currentProfile.approval_status !== "approved"
  ) {
    message("pointsMessage", "ليس لديك صلاحية إضافة النقاط.");
    return;
  }

  const memberId = $("pointsMember").value;
  const amount = Number($("pointsAmount").value);
  const reason = $("pointsReason").value.trim();

  if (
    !memberId ||
    !Number.isInteger(amount) ||
    amount === 0 ||
    amount < -100 ||
    amount > 100 ||
    !reason ||
    reason.length > 200
  ) {
    message("pointsMessage", "راجع العضو وعدد النقاط والسبب.");
    return;
  }

  const { error } = await supabase.rpc("award_points", {
    p_member_id: memberId,
    p_amount: amount,
    p_reason: reason
  });

  if (error) {
    message("pointsMessage", "فشلت العملية: " + error.message);
    return;
  }

  message("pointsMessage", "تم تسجيل النقاط بنجاح.");
  $("pointsForm").reset();
  await refreshSession();
});

/* =========================================================
   تعيين الخدام للمجموعات
   ========================================================= */
$("assignForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  message("assignMessage", "جاري تعيين الخادم...");

  if (!currentProfile || currentProfile.role !== "admin" || currentProfile.approval_status !== "approved") {
    message("assignMessage", "هذه العملية للأدمن المعتمد فقط.");
    return;
  }

  const servantId = $("servantSelect").value;
  const groupId = $("groupSelect").value;

  if (!servantId || !groupId) {
    message("assignMessage", "اختار الخادم والمجموعة.");
    return;
  }

  const { error } = await supabase
    .from("servant_group_assignments")
    .upsert({
      servant_id: servantId,
      group_id: groupId,
      assigned_by: currentUser.id
    }, { onConflict: "servant_id,group_id" });

  if (error) {
    message("assignMessage", "فشل التعيين: " + error.message);
    return;
  }

  message("assignMessage", "تم تعيين الخادم للمجموعة.");
  await loadAssignments();
});

/* =========================================================
   نشر الدروس
   ========================================================= */
$("lessonCreateForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  message("lessonCreateMessage", "جاري نشر الدرس...");

  if (!currentUser || !currentProfile || currentProfile.approval_status !== "approved") {
    message("lessonCreateMessage", "يلزم حساب خادم معتمد.");
    return;
  }

  const groupId = $("lessonGroup").value;
  const title = $("lessonTitle").value.trim();
  const body = $("lessonBody").value.trim();
  const url = $("lessonUrl").value.trim();

  if (!groupId || !title || !body) {
    message("lessonCreateMessage", "اختار المجموعة واكتب العنوان ومحتوى الدرس.");
    return;
  }

  const { error } = await supabase.from("lessons").insert({
    title,
    description: $("lessonDescription").value.trim(),
    body,
    content_url: url || null,
    group_id: groupId,
    created_by: currentUser.id
  });

  if (error) {
    message("lessonCreateMessage", "فشل نشر الدرس: " + error.message);
    return;
  }

  message("lessonCreateMessage", "تم نشر الدرس.");
  $("lessonCreateForm").reset();

  await Promise.all([
    loadLessons("dashboardLessonsList"),
    loadLessons("lessonsList"),
    loadQuizDropdowns()
  ]);
});

/* =========================================================
   نوع الاختبار
   ========================================================= */
$("quizType")?.addEventListener("change", () => {
  $("quizLesson").required = $("quizType").value === "lesson";
  $("quizLesson").disabled = $("quizType").value !== "lesson";
});

/* =========================================================
   إنشاء اختبار
   ========================================================= */
$("quizCreateForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  message("quizCreateMessage", "جاري إنشاء الاختبار...");

  if (
    !currentUser ||
    !currentProfile ||
    !["admin", "servant"].includes(currentProfile.role) ||
    currentProfile.approval_status !== "approved"
  ) {
    message("quizCreateMessage", "ليس لديك صلاحية إنشاء امتحان.");
    return;
  }

  const type = $("quizType").value;
  const lessonId = $("quizLesson").value || null;
  const groupId = $("quizGroup").value;
  const rewardPoints = Number.parseInt($("quizPointsReward").value || "0", 10);

  if (!Number.isInteger(rewardPoints) || rewardPoints < 0 || rewardPoints > 1000) {
    message("quizCreateMessage", "مكافأة الامتحان يجب أن تكون من 0 إلى 1000 نقطة.");
    return;
  }

  if (type === "lesson" && !lessonId) {
    message("quizCreateMessage", "اختار الدرس المرتبط بالأسئلة.");
    return;
  }

  const { data, error } = await supabase
    .from("quizzes")
    .insert({
      title: $("quizTitle").value.trim(),
      description: $("quizDescription").value.trim(),
      group_id: groupId,
      lesson_id: type === "lesson" ? Number(lessonId) : null,
      quiz_type: type,
      points_reward: rewardPoints,
      created_by: currentUser.id,
      is_published: false
    })
    .select("id")
    .single();

  if (error) {
    message("quizCreateMessage", "فشل إنشاء الاختبار: " + error.message);
    return;
  }

  message(
    "quizCreateMessage",
    "تم إنشاء الاختبار. أضف أسئلته من النموذج التالي. الاختبار غير منشور للشباب بعد."
  );

  $("quizCreateForm").reset();
  await loadQuizDropdowns();
  $("questionQuiz").value = String(data.id);
  await loadQuizzes();
});

/* =========================================================
   إضافة سؤال وإجابته الصحيحة
   ========================================================= */
$("questionCreateForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  message("questionCreateMessage", "جاري إضافة السؤال...");

  const quizId = $("questionQuiz").value;
  const options = [0, 1, 2, 3].map(index => $("option" + index).value.trim());
  const questionText = $("questionText").value.trim();

  if (!quizId || !options.every(Boolean)) {
    message("questionCreateMessage", "اختار الاختبار واكتب الاختيارات الأربعة.");
    return;
  }

  if (!questionText) {
    message("questionCreateMessage", "اكتب نص السؤال.");
    return;
  }

  const { data: question, error } = await supabase
    .from("quiz_questions")
    .insert({
      quiz_id: quizId,
      question_text: questionText,
      options,
      position: Date.now() % 100000
    })
    .select("id")
    .single();

  if (error) {
    message("questionCreateMessage", "فشل إضافة السؤال: " + error.message);
    return;
  }

  const { error: keyError } = await supabase
    .from("quiz_answer_keys")
    .insert({
      question_id: question.id,
      correct_option: Number($("correctOption").value)
    });

  if (keyError) {
    message(
      "questionCreateMessage",
      "تم إنشاء السؤال لكن فشل حفظ مفتاح الإجابة: " + keyError.message
    );
    return;
  }

  message("questionCreateMessage", "تمت إضافة السؤال والإجابة الصحيحة بشكل آمن.");
  $("questionCreateForm").reset();
  await loadQuizzes();
});

/* =========================================================
   أزرار كشف الحضور
   ========================================================= */
$("loadAttendanceBtn")?.addEventListener("click", loadAttendanceRoster);
$("saveAttendanceBtn")?.addEventListener("click", saveAttendanceRoster);

/* =========================================================
   تغيير اللغة
   ========================================================= */
$("langBtn")?.addEventListener("click", () => {
  lang = lang === "ar" ? "en" : "ar";
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  $("langBtn").textContent = lang === "ar" ? "EN" : "عربي";

  message(
    "accountMessage",
    lang === "en"
      ? "Some dashboard content is still in Arabic."
      : "تم الرجوع للواجهة العربية."
  );
});

/* =========================================================
   متابعة تسجيل الدخول
   ========================================================= */
supabase.auth.onAuthStateChange(() => {
  setTimeout(() => refreshSession(), 0);
});

/* =========================================================
   تشغيل الموقع
   ========================================================= */
if ($("attendanceDate")) {
  $("attendanceDate").value = new Date().toLocaleDateString("en-CA");
}

await Promise.all([
  loadEvents("eventsList"),
  loadLessons("lessonsList"),
  refreshSession()
]);

// رجّع المستخدم للقسم الذي كان مفتوحًا إذا لم تمر 5 دقائق
restoreLastSection();
