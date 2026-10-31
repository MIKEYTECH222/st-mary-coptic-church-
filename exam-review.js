import { supabase } from "./supabase.js";

const $ = id => document.getElementById(id);

let currentQuizId = null;
let reviewData = null;
let refreshTimer = null;


// ======================================
// الرسائل
// ======================================

function say(text, type = "") {
  const element = $("pageMessage");

  element.textContent = text || "";
  element.className = "status " + type;
}


// ======================================
// إنشاء عناصر HTML بأمان
// ======================================

function createElement(tag, className = "", value) {
  const element = document.createElement(tag);

  if (className) {
    element.className = className;
  }

  if (value !== undefined) {
    element.textContent = value;
  }

  return element;
}


// ======================================
// تحويل الثواني إلى وقت مفهوم
// ======================================

function formatDuration(seconds) {

  let total = Math.max(
    0,
    Math.floor(Number(seconds) || 0)
  );

  const hours = Math.floor(total / 3600);

  total %= 3600;

  const minutes = Math.floor(total / 60);

  const remainingSeconds = total % 60;

  const parts = [];

  if (hours) {
    parts.push(hours + " ساعة");
  }

  if (minutes) {
    parts.push(minutes + " دقيقة");
  }

  if (remainingSeconds || (!hours && !minutes)) {
    parts.push(remainingSeconds + " ثانية");
  }

  return parts.join(" و ");
}


// ======================================
// عرض حالة خروج الطالب
// ======================================

function getPresenceText(presence, events = []) {

  if (!presence) {
    return "لم يتم تسجيل خروج أو عودة لهذا الطالب أثناء الامتحان.";
  }

  // الطالب خارج الصفحة حاليًا

  if (
    presence.status === "away" &&
    presence.left_at
  ) {

    const seconds =
      (Date.now() - new Date(presence.left_at).getTime()) / 1000;

    return (
      "الطالب خرج حاليًا منذ " +
      formatDuration(seconds) +
      " • مرات الخروج: " +
      (presence.leave_count || 0)
    );
  }

  const lastReturn = [...events]
    .reverse()
    .find(event => event.event_type === "return");

  const lastDuration =
    presence.last_return_seconds ??
    lastReturn?.duration_seconds;

  if (
    lastDuration !== undefined &&
    lastDuration !== null
  ) {

    return (
      "آخر مرة خرج فيها الطالب كانت لمدة " +
      formatDuration(lastDuration) +
      " • مرات الخروج: " +
      (presence.leave_count || 0) +
      " • إجمالي وقت الخروج: " +
      formatDuration(presence.total_away_seconds || 0)
    );
  }

  if (presence.status === "finished") {

    return (
      "الطالب سلّم الامتحان" +
      " • مرات الخروج: " +
      (presence.leave_count || 0) +
      " • إجمالي وقت الخروج: " +
      formatDuration(presence.total_away_seconds || 0)
    );
  }

  // انقطاع الاتصال دون استقبال حدث خروج صريح

  if (
    presence.last_seen_at &&
    Date.now() - new Date(presence.last_seen_at).getTime() > 30000
  ) {

    const seconds =
      (Date.now() - new Date(presence.last_seen_at).getTime()) / 1000;

    return (
      "انقطع آخر اتصال منذ " +
      formatDuration(seconds) +
      " تقريبًا • لم يصل حدث خروج صريح."
    );
  }

  return "الطالب لم يسجل خروجًا حتى الآن.";
}


// ======================================
// الإجابة التي اختارها الطالب
// ======================================

function getStudentAnswer(question, attempt) {

  const answer = attempt.answers?.[question.id];

  const index = Number(answer);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    (question.options || [])[index] === undefined
  ) {
    return "لم يسجل إجابة";
  }

  return String(question.options[index]);
}


// ======================================
// بناء بطاقة محاولة الطالب
// ======================================

function buildAttempt(attempt, questions) {

  const card = createElement(
    "article",
    "review-attempt"
  );

  card.append(
    createElement(
      "h2",
      "",
      attempt.member_name || "طالب"
    )
  );

  card.append(
    createElement(
      "p",
      "review-meta",

      "الدرجة الحالية: " +
      attempt.score +
      " / " +
      attempt.max_score +

      " • النقاط: " +
      (attempt.points_awarded || 0) +

      " • التسليم: " +
      new Date(attempt.submitted_at).toLocaleString("ar-EG")
    )
  );


  questions.forEach((question, index) => {

    const block = createElement(
      "section",
      "review-q"
    );

    block.append(
      createElement(
        "h3",
        "",
        "السؤال " +
        (index + 1) +
        ": " +
        question.question_text
      )
    );


    // الإجابة المختارة والإجابة الصحيحة

    const chosen = Number(
      attempt.answers?.[question.id]
    );

    const hasAnswer = Object.prototype.hasOwnProperty.call(
      attempt.answers || {},
      question.id
    );

    const correctIndex = Number(
      question.correct_option
    );


    // عرض الاختيارات

    const optionsBox = createElement(
      "div",
      "review-options"
    );

    (question.options || []).forEach((option, optionIndex) => {

      let className = "review-option";

      if (
        hasAnswer &&
        chosen === optionIndex
      ) {
        className += " chosen";
      }

      if (correctIndex === optionIndex) {
        className += " correct";
      }

      let text =
        String.fromCharCode(65 + optionIndex) +
        ") " +
        option;

      if (
        hasAnswer &&
        chosen === optionIndex
      ) {
        text += " — إجابة الطالب";
      }

      if (correctIndex === optionIndex) {
        text += " — الإجابة الأصلية الصحيحة";
      }

      optionsBox.append(
        createElement("div", className, text)
      );

    });


    block.append(optionsBox);


    block.append(
      createElement(
        "p",
        "muted",
        "إجابة الطالب: " +
        getStudentAnswer(question, attempt)
      )
    );


    // ======================================
    // قرار التصحيح اليدوي
    // ======================================

    const select = document.createElement("select");

    select.add(
      new Option(
        "استخدم التصحيح الأصلي",
        "auto"
      )
    );

    select.add(
      new Option(
        "اعتبر الإجابة صحيحة",
        "true"
      )
    );

    select.add(
      new Option(
        "اعتبر الإجابة خاطئة",
        "false"
      )
    );


    const override =
      attempt.reviews?.[question.id];

    select.value =
      override === undefined
        ? "auto"
        : String(override);


    // سبب التعديل

    const reason = document.createElement("input");

    reason.type = "text";

    reason.maxLength = 300;

    reason.placeholder =
      "سبب التعديل (مطلوب عند تغيير التصحيح)";


    const decisionLabel = createElement("label");

    decisionLabel.append(
      createElement("span", "", "قرار التصحيح"),
      select
    );


    const reasonLabel = createElement("label");

    reasonLabel.append(
      createElement("span", "", "سبب التعديل"),
      reason
    );


    const controls = createElement(
      "div",
      "review-save"
    );

    controls.append(
      decisionLabel,
      reasonLabel
    );


    // زر الحفظ

    const saveButton = createElement(
      "button",
      "primary",
      "حفظ التصحيح"
    );

    saveButton.type = "button";


    saveButton.addEventListener(
      "click",
      async () => {

        const decision = select.value;

        const explanation = reason.value.trim();

        if (
          decision !== "auto" &&
          !explanation
        ) {
          say(
            "اكتب سبب تعديل التصحيح أولًا.",
            "error"
          );

          reason.focus();

          return;
        }

        saveButton.disabled = true;

        const { data, error } = await supabase.rpc(
          "review_quiz_answer",
          {
            p_attempt_id: attempt.id,

            p_question_id: question.id,

            p_is_correct:
              decision === "auto"
                ? null
                : decision === "true",

            p_reason:
              explanation || "إلغاء التعديل اليدوي"
          }
        );

        saveButton.disabled = false;


        if (error) {

          say(
            "فشل حفظ التصحيح: " + error.message,
            "error"
          );

          return;
        }


        say(
          "تم حفظ التصحيح. الدرجة الجديدة: " +
          data.score +
          " من " +
          data.max_score +
          " • النقاط: " +
          data.points_awarded +
          (
            data.points_delta
              ? " • فرق النقاط: " + data.points_delta
              : ""
          ),
          "success"
        );


        await loadReviewData(false);

      }
    );


    controls.append(saveButton);

    block.append(controls);


    // ======================================
    // حالة الطالب أسفل السؤال
    // ======================================

    const presence = createElement(
      "div",
      "presence",
      getPresenceText(
        attempt.presence,
        attempt.presence_events
      )
    );

    presence.id =
      "presence-" +
      attempt.id +
      "-" +
      question.id;

    block.append(presence);


    // حالة التصحيح الحالية

    const isCorrect =
      override === undefined
        ? hasAnswer && chosen === correctIndex
        : override === true;


    let correctionStatus;

    if (override === undefined) {

      correctionStatus = isCorrect
        ? "حسب المفتاح الأصلي: صحيح"
        : "حسب المفتاح الأصلي: خطأ";

    } else {

      correctionStatus = isCorrect
        ? "تم اعتماده صحيحًا يدويًا"
        : "تم اعتماده خطأ يدويًا";
    }


    block.append(
      createElement(
        "p",
        "muted",
        "حالة التصحيح: " + correctionStatus
      )
    );


    card.append(block);

  });


  return card;
}


// ======================================
// تحميل بيانات المراجعة
// ======================================

async function loadReviewData(showLoading = true) {

  const quizId = $("quizSelect").value;

  if (!quizId) {

    say(
      "اختار امتحانًا أولًا.",
      "error"
    );

    return;
  }

  currentQuizId = quizId;

  if (showLoading) {
    say("جاري تحميل إجابات الطلاب...");
  }


  const { data, error } = await supabase.rpc(
    "get_quiz_review_data",
    {
      p_quiz_id: quizId
    }
  );


  if (error) {

    say(
      "تعذر تحميل المراجعة: " + error.message,
      "error"
    );

    return;
  }


  reviewData = data;

  const target = $("attemptsList");

  target.replaceChildren();


  if (!data.attempts?.length) {

    target.append(
      createElement(
        "p",
        "muted",
        "لا توجد محاولات مسجلة لهذا الامتحان."
      )
    );

  } else {

    data.attempts.forEach(attempt => {

      target.append(
        buildAttempt(
          attempt,
          data.questions || []
        )
      );

    });

  }


  say(
    "تم تحميل " +
    (data.attempts?.length || 0) +
    " محاولة لامتحان: " +
    data.quiz.title,
    "success"
  );

}


// ======================================
// تحديث حالة الخروج فقط
// ======================================

async function refreshPresenceOnly() {

  if (!currentQuizId) return;


  const { data, error } = await supabase.rpc(
    "get_quiz_presence_for_quiz",
    {
      p_quiz_id: currentQuizId
    }
  );


  if (
    error ||
    !Array.isArray(data)
  ) {
    return;
  }


  data.forEach(presence => {

    const attempt = reviewData?.attempts?.find(
      item => item.id === presence.attempt_id
    );

    const summary = getPresenceText(
      presence,
      attempt?.presence_events || []
    );


    document
      .querySelectorAll(
        '[id^="presence-' +
        presence.attempt_id +
        '-"]'
      )
      .forEach(element => {

        element.textContent = summary;

        element.classList.toggle(
          "active",
          presence.status === "active"
        );

      });

  });

}


// ======================================
// تشغيل الصفحة والتحقق من الصلاحيات
// ======================================

async function init() {

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();


  if (
    sessionError ||
    !sessionData.session
  ) {

    say(
      "سجّل الدخول بحساب الخادم أو الأدمن أولًا من الموقع.",
      "error"
    );

    return;
  }


  const { data: profile, error } = await supabase

    .from("profiles")

    .select("id,full_name,role,approval_status")

    .eq("id", sessionData.session.user.id)

    .maybeSingle();


  if (error || !profile) {

    say(
      "تعذر تحميل الملف الشخصي: " +
      (error?.message || "غير موجود"),
      "error"
    );

    return;
  }


  if (
    profile.approval_status !== "approved" ||
    !["admin", "servant"].includes(profile.role)
  ) {

    say(
      "هذه الصفحة مخصصة للخدام المعتمدين والأدمن فقط.",
      "error"
    );

    return;
  }


  $("roleBadge").textContent =
    profile.role === "admin"
      ? "أدمن"
      : "خادم معتمد";


  // تحميل الامتحانات المسموح للخادم بمراجعتها

  const { data: quizzes, error: quizError } =
    await supabase.rpc(
      "get_reviewable_quizzes"
    );


  if (quizError) {

    say(
      "تعذر تحميل الامتحانات: " + quizError.message,
      "error"
    );

    return;
  }


  const select = $("quizSelect");

  select.replaceChildren(
    new Option("اختار الامتحان", "")
  );


  (quizzes || []).forEach(quiz => {

    select.add(
      new Option(
        quiz.title +
        " • مكافأة " +
        quiz.points_reward,
        quiz.id
      )
    );

  });


  if (!quizzes?.length) {

    say(
      "لا توجد امتحانات ضمن المجموعات المسندة إليك."
    );
  }


  $("loadReviewBtn").addEventListener(
    "click",
    () => loadReviewData(true)
  );


  select.addEventListener(
    "change",
    () => loadReviewData(true)
  );


  $("logoutBtn").addEventListener(
    "click",
    async () => {

      await supabase.auth.signOut();

      location.href = "./index.html#account";

    }
  );


  // تحديث الخروج والعودة كل 10 ثوانٍ

  refreshTimer = setInterval(
    refreshPresenceOnly,
    10000
  );

}


await init();


window.addEventListener(
  "beforeunload",
  () => {
    clearInterval(refreshTimer);
  }
);
