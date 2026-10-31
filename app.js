import { supabase } from "./supabase.js";

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let lang = "ar";

document.documentElement.style.colorScheme = "dark";

function message(id, text) {
  const element = $(id);
  if (element) element.textContent = text || "";
}

function escapeText(value) {
  return String(value ?? "");
}

function showDashboard(show) {
  $("publicPage").classList.toggle("hidden", show);
  $("dashboard").classList.toggle("hidden", !show);
  $("logoutBtn").classList.toggle("hidden", !show);
  $("authForms").classList.toggle("hidden", show);

  if (show) {
    location.hash = "dashboard";
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    location.hash = "account";
  }
}

function addItem(targetId, title, description, extra = "") {
  const target = $(targetId);
  if (!target) return;

  const article = document.createElement("article");
  article.className = "item";

  const heading = document.createElement("h3");
  heading.textContent = escapeText(title || "بدون عنوان");
  article.appendChild(heading);

  if (description) {
    const p = document.createElement("p");
    p.textContent = escapeText(description);
    article.appendChild(p);
  }

  if (extra) {
    const p = document.createElement("p");
    p.textContent = escapeText(extra);
    article.appendChild(p);
  }

  target.appendChild(article);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ar-EG");
}

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
    addItem(targetId, "لا توجد فعاليات حاليًا",
      "ستظهر الفعاليات هنا بعد إضافتها.");
    return;
  }

  data.forEach(event => {
    addItem(
      targetId,
      event.title,
      event.description,
      [event.location, formatDate(event.starts_at)]
        .filter(Boolean).join(" • ")
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
    addItem(targetId, "لا توجد دروس حاليًا",
      "ستظهر الدروس هنا بعد إضافتها.");
    return;
  }

  data.forEach(lesson => {
    const article = document.createElement("article");
    article.className = "item";

    const heading = document.createElement("h3");
    heading.textContent = lesson.title || "درس";
    article.appendChild(heading);

    const p = document.createElement("p");
    p.textContent = lesson.description || "";
    article.appendChild(p);

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

// ======================================
// تحميل أعضاء المجموعات
// ======================================

async function loadAssignedMembers() {
  const select = $("pointsMember");
  if (!select || !currentProfile || !currentUser) return;

  select.replaceChildren(new Option("اختار العضو", ""));

  let groupIds = [];

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

  groupIds = [...new Set((assignments || []).map(x => x.group_id))];

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
    message("pointsMessage",
      "تعذر تحميل أعضاء مجموعاتك. راجع سياسات RLS لجدول profiles: " +
      membersError.message);
    return;
  }

  (members || []).forEach(member => {
    select.add(new Option(member.full_name || member.id, member.id));
  });

  if (!members?.length) {
    message("pointsMessage", "لا يوجد أعضاء ظاهرون في مجموعاتك.");
  }
}

// ======================================
// الاختبارات ومحاولات الأعضاء
// ======================================

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

async function loadQuizzes() {
  const target = $("quizzesList");
  if (!target || !currentUser || !currentProfile) return;

  target.replaceChildren();

  const { data, error } = await supabase.from("quizzes")
    .select("id,title,description,quiz_type,group_id,is_published,created_by,points_reward")
    .order("created_at", { ascending: false });

  if (error) {
    addItem("quizzesList", "تعذر تحميل الاختبارات", error.message);
    return;
  }

  const visible = (data || []).filter(q =>
    q.is_published ||
    q.created_by === currentUser.id ||
    currentProfile.role === "admin"
  );

  if (!visible.length) {
    addItem("quizzesList", "لا توجد أسئلة أو امتحانات منشورة حالياً", "");
    return;
  }

  for (const quiz of visible) {
    const article = document.createElement("article");
    article.className = "item";

    const title = document.createElement("h3");
    title.textContent = quiz.title || "اختبار";
    article.appendChild(title);

    const desc = document.createElement("p");
    desc.textContent =
      (quiz.quiz_type === "lesson" ? "أسئلة بعد الدرس" : "امتحان مستقل") +
      " • " + (quiz.description || "") +
      (
        Number(quiz.points_reward || 0) > 0
          ? " • المكافأة: " + quiz.points_reward + " نقطة"
          : ""
      );

    article.appendChild(desc);

    const canManage =
      quiz.created_by === currentUser.id ||
      currentProfile.role === "admin";

    if (canManage) {
      const publish = document.createElement("button");
      publish.type = "button";
      publish.textContent = quiz.is_published ? "إلغاء النشر" : "نشر الاختبار";

      publish.addEventListener("click", async () => {
        publish.disabled = true;

        const { error } = await supabase.rpc("set_quiz_published", {
          p_quiz_id: quiz.id,
          p_published: !quiz.is_published
        });

        if (error) {
          publish.disabled = false;
          message("questionCreateMessage",
            "تعذر تغيير حالة النشر: " + error.message);
          return;
        }

        await loadQuizzes();
      });

      article.appendChild(publish);
    }

    if (
      quiz.is_published &&
      currentProfile.approval_status === "approved"
    ) {
      const { data: previousAttempt, error: attemptError } =
        await getQuizAttempt(quiz.id, currentUser.id);

      if (attemptError) {
        const warning = document.createElement("p");
        warning.className = "status error";
        warning.textContent =
          "تعذر التحقق من حالة الامتحان. أعد تحميل الصفحة أو تواصل مع المسؤول.";

        article.appendChild(warning);
      } else if (previousAttempt) {
        showCompletedQuiz(article, previousAttempt);
      } else {
        const start = document.createElement("button");
        start.type = "button";
        start.textContent = "حل الاختبار";

        start.addEventListener("click", async () => {
          start.disabled = true;

          const { data: latestAttempt, error: latestAttemptError } =
            await getQuizAttempt(quiz.id, currentUser.id);

          if (latestAttemptError) {
            start.disabled = false;
            message("questionCreateMessage",
              "تعذر التحقق من المحاولة السابقة: " +
              latestAttemptError.message);
            return;
          }

          if (latestAttempt) {
            start.remove();
            showCompletedQuiz(article, latestAttempt);
            return;
          }

          const { data: questions, error: questionsError } = await supabase
            .from("quiz_questions")
            .select("id,question_text,options,position")
            .eq("quiz_id", quiz.id)
            .order("position");

          if (questionsError) {
            start.disabled = false;
            message("questionCreateMessage",
              "تعذر تحميل الأسئلة: " + questionsError.message);
            return;
          }

          if (!questions?.length) {
            start.disabled = false;
            message("questionCreateMessage",
              "الامتحان لا يحتوي على أسئلة.");
            return;
          }

          const form = document.createElement("form");
          form.className = "quiz-form";

          questions.forEach((q, index) => {
            const field = document.createElement("fieldset");
            field.className = "form-card quiz-question-card";

            const legend = document.createElement("legend");
            legend.textContent =
              `السؤال ${index + 1}: ${q.question_text}`;

            field.appendChild(legend);

            (q.options || []).forEach((opt, optIndex) => {
              const label = document.createElement("label");
              label.className = "option";

              const radio = document.createElement("input");
              radio.type = "radio";
              radio.name = "q_" + q.id;
              radio.value = String(optIndex);
              radio.required = true;
              radio.style.width = "auto";

              label.append(
                radio,
                document.createTextNode(" " + opt)
              );

              field.appendChild(label);
            });

            form.appendChild(field);
          });

          const submit = document.createElement("button");
          submit.type = "submit";
          submit.className = "primary";
          submit.textContent = "إرسال الإجابات النهائية";

          form.appendChild(submit);

          const result = document.createElement("p");
          result.className = "status";
          form.appendChild(result);

          form.addEventListener("submit", async ev => {
            ev.preventDefault();

            const answers = {};

            questions.forEach(q => {
              const chosen = form.querySelector(
                'input[name="q_' + q.id + '"]:checked'
              );

              if (chosen) {
                answers[q.id] = Number(chosen.value);
              }
            });

            if (Object.keys(answers).length !== questions.length) {
              result.textContent =
                "جاوب على كل الأسئلة قبل التسليم.";
              return;
            }

            submit.disabled = true;
            submit.textContent = "جاري تسليم الامتحان...";

            const { data: submissionData, error: submissionError } =
              await supabase.rpc("submit_quiz", {
                p_quiz_id: quiz.id,
                p_answers: answers
              });

            if (submissionError) {
              submit.disabled = false;
              submit.textContent = "إرسال الإجابات النهائية";

              result.className = "status error";
              result.textContent = submissionError.message;
              return;
            }

            const score = Array.isArray(submissionData)
              ? submissionData[0]
              : submissionData;

            form.querySelectorAll("input").forEach(input => {
              input.disabled = true;
            });

            submit.disabled = true;
            submit.textContent = "تم تسليم الامتحان";

            // قراءة النقاط المحفوظة فعليًا بواسطة قاعدة البيانات
            const { data: savedAttempt, error: savedAttemptError } =
              await getQuizAttempt(quiz.id, currentUser.id);

            let pointsAwarded = 0;

            if (!savedAttemptError && savedAttempt) {
              pointsAwarded = Number(savedAttempt.points_awarded || 0);
            } else {
              // احتياطي للعرض إذا تعذرت قراءة المحاولة
              pointsAwarded = score.total_questions > 0
                ? Math.floor(
                    Number(quiz.points_reward || 0) *
                    Number(score.final_score || 0) /
                    Number(score.total_questions)
                  )
                : 0;
            }

            result.className = "status success";
            result.textContent =
              `تم التسليم بنجاح! نتيجتك: ${score.final_score} من ${score.total_questions} • حصلت على ${pointsAwarded} نقطة.`;

            await refreshSession();
            await loadQuizzes();
          });

          article.appendChild(form);
          start.remove();

          form.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });
        });

        article.appendChild(start);
      }
    }

    target.appendChild(article);
  }
}

// ======================================
// مجموعات الخدام
// ======================================

async function loadServantGroups() {
  const idsResult = currentProfile.role === "admin"
    ? null
    : await supabase.from("servant_group_assignments")
        .select("group_id")
        .eq("servant_id", currentUser.id);

  if (idsResult?.error) {
    message("lessonCreateMessage",
      "تعذر تحميل المجموعات: " + idsResult.error.message);
    return;
  }

  let query = supabase.from("ministry_groups")
    .select("id,name").order("name");

  if (idsResult) {
    const ids = [...new Set((idsResult.data || []).map(x => x.group_id))];

    if (!ids.length) {
      ["lessonGroup", "quizGroup", "attendanceGroup"].forEach(id => {
        const sel = $(id);
        if (sel) {
          sel.replaceChildren(
            new Option("لا توجد مجموعات معينة لك", "")
          );
        }
      });
      return;
    }

    query = query.in("id", ids);
  }

  const { data, error } = await query;

  if (error) {
    message("lessonCreateMessage",
      "تعذر تحميل المجموعات: " + error.message);
    return;
  }

  for (const id of ["lessonGroup", "quizGroup", "attendanceGroup"]) {
    const sel = $(id);
    if (!sel) continue;

    sel.replaceChildren(new Option("اختار المجموعة", ""));
    (data || []).forEach(g => sel.add(new Option(g.name, g.id)));
  }
}

async function loadQuizDropdowns() {
  const [quizzesResult, lessonsResult] = await Promise.all([
    supabase.from("quizzes")
      .select("id,title,quiz_type")
      .order("created_at", { ascending: false }),

    supabase.from("lessons")
      .select("id,title")
      .order("id", { ascending: false })
  ]);

  if (!quizzesResult.error) {
    const sel = $("questionQuiz");

    if (sel) {
      sel.replaceChildren(new Option("اختار الاختبار", ""));

      (quizzesResult.data || []).forEach(q => {
        sel.add(new Option(
          q.title + " (" +
          (q.quiz_type === "lesson" ? "أسئلة درس" : "امتحان") + ")",
          q.id
        ));
      });
    }
  } else {
    message("questionCreateMessage",
      "تعذر تحميل الاختبارات: " + quizzesResult.error.message);
  }

  if (!lessonsResult.error) {
    const sel = $("quizLesson");

    if (sel) {
      sel.replaceChildren(new Option("اختار الدرس", ""));

      (lessonsResult.data || []).forEach(l => {
        sel.add(new Option(l.title, l.id));
      });
    }
  }
}

// ======================================
// الحضور والغياب
// ======================================

async function loadAttendanceRoster() {
  const groupId = $("attendanceGroup").value;
  const date = $("attendanceDate").value;
  const title = $("attendanceTitle").value.trim() || "لقاء الخدمة";
  const target = $("attendanceRoster");

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
    message("attendanceMessage",
      "تعذر تحميل الأعضاء: " + membersError.message);
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
    message("attendanceMessage",
      "تعذر قراءة اللقاء: " + sessionError.message);
    return;
  }

  let records = [];

  if (session) {
    const { data, error } = await supabase
      .from("attendance_records")
      .select("member_id,status")
      .eq("session_id", session.id);

    if (error) {
      message("attendanceMessage",
        "تعذر تحميل الحضور السابق: " + error.message);
      return;
    }

    records = data || [];
  }

  const saved = new Map(records.map(r => [r.member_id, r.status]));

  (members || []).forEach(m => {
    const row = document.createElement("div");
    row.className = "item";

    const label = document.createElement("label");
    label.textContent = m.full_name || m.id;

    const select = document.createElement("select");
    select.dataset.memberId = m.id;

    select.add(new Option("حاضر (+20 نقطة)", "present"));
    select.add(new Option("غائب", "absent"));
    select.add(new Option("لم يتم التسجيل", "unmarked"));

    select.value = saved.get(m.id) || "unmarked";

    row.append(label, select);
    target.appendChild(row);
  });

  target.dataset.sessionId = session?.id || "";

  message("attendanceMessage",
    `عدد الأعضاء: ${(members || []).length}. اختار حالة كل عضو ثم احفظ.`);
}

async function saveAttendanceRoster() {
  const groupId = $("attendanceGroup").value;
  const date = $("attendanceDate").value;
  const title = $("attendanceTitle").value.trim() || "لقاء الخدمة";

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
    }, {
      onConflict: "group_id,session_date,title"
    })
    .select("id")
    .single();

  if (sessionError) {
    message("attendanceMessage",
      "فشل إنشاء اللقاء: " + sessionError.message);
    return;
  }

  const selects = [
    ...$("attendanceRoster").querySelectorAll("select[data-member-id]")
  ];

  for (const sel of selects) {
    if (sel.value === "unmarked") continue;

    const { error } = await supabase.from("attendance_records").upsert({
      session_id: session.id,
      member_id: sel.dataset.memberId,
      status: sel.value,
      marked_by: currentUser.id
    }, {
      onConflict: "session_id,member_id"
    });

    if (error) {
      message("attendanceMessage",
        "فشل حفظ الحضور: " + error.message);
      return;
    }
  }

  message("attendanceMessage",
    "تم حفظ كشف الحضور. راجع إعدادات النقاط التلقائية في قاعدة البيانات.");

  await loadServantNotifications();
}

async function loadServantNotifications() {
  const target = $("servantNotifications");
  if (!target) return;

  target.replaceChildren();

  const { data, error } = await supabase.from("site_notifications")
    .select("id,message,created_at,read_at")
    .order("created_at", { ascending: false });

  if (error) {
    addItem("servantNotifications", "تعذر تحميل التنبيهات", error.message);
    return;
  }

  if (!data?.length) {
    addItem("servantNotifications", "لا توجد تنبيهات غياب حالياً", "");
    return;
  }

  (data || []).forEach(n => {
    const article = document.createElement("article");
    article.className = "item";

    const p = document.createElement("p");
    p.textContent = n.message + " • " + formatDate(n.created_at);
    article.appendChild(p);

    if (!n.read_at) {
      const btn = document.createElement("button");
      btn.textContent = "تمت المتابعة";

      btn.addEventListener("click", async () => {
        const { error } = await supabase.from("site_notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", n.id);

        if (error) {
          message("attendanceMessage",
            "تعذر تحديث التنبيه: " + error.message);
        } else {
          await loadServantNotifications();
        }
      });

      article.appendChild(btn);
    }

    target.appendChild(article);
  });
}

// ======================================
// إدارة الخدام والمجموعات
// ======================================

async function loadAdminData() {
  const servantsSelect = $("servantSelect");
  const groupsSelect = $("groupSelect");

  if (!servantsSelect || !groupsSelect) return;

  servantsSelect.replaceChildren(new Option("اختار الخادم", ""));
  groupsSelect.replaceChildren(new Option("اختار المجموعة", ""));

  const [servantsResult, groupsResult] = await Promise.all([
    supabase.from("profiles")
      .select("id,full_name")
      .eq("role", "servant")
      .eq("approval_status", "approved")
      .order("full_name"),

    supabase.from("ministry_groups")
      .select("id,name")
      .order("name")
  ]);

  if (servantsResult.error) {
    message("assignMessage",
      "تعذر تحميل الخدام: " + servantsResult.error.message);
  } else {
    (servantsResult.data || []).forEach(servant => {
      servantsSelect.add(new Option(
        servant.full_name || servant.id,
        servant.id
      ));
    });
  }

  if (groupsResult.error) {
    message("assignMessage",
      "تعذر تحميل المجموعات: " + groupsResult.error.message);
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

// ======================================
// تحديث الجلسة والملف الشخصي
// ======================================

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
    message("accountMessage",
      "تعذر تحميل بيانات الحساب: " +
      (profileError?.message || "لم يتم العثور على الملف الشخصي"));
    return;
  }

  currentProfile = profile;

  $("dashName").textContent =
    profile.full_name || currentUser.email || "—";

  $("dashPoints").textContent = String(profile.points ?? 0);

  const statusLabels = {
    approved: "تمت الموافقة",
    pending: "في انتظار موافقة المسؤول",
    rejected: "تم رفض الحساب"
  };

  $("dashStatus").textContent =
    statusLabels[profile.approval_status] ||
    profile.approval_status || "غير معروف";

  $("dashRole").textContent = "الدور: " + profile.role;

  showDashboard(true);

  const approved = profile.approval_status === "approved";
  const isAdmin = profile.role === "admin";
  const isServant = profile.role === "servant";

  $("servantPanel").classList.toggle(
    "hidden", !(approved && (isAdmin || isServant))
  );

  $("adminPanel").classList.toggle(
    "hidden", !(approved && isAdmin)
  );

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

    $("quizLesson").disabled = $("quizType").value !== "lesson";
    $("quizLesson").required = $("quizType").value === "lesson";
  }

  if (approved && isAdmin) {
    await loadAdminData();
  }
}

// ======================================
// إنشاء حساب جديد
// ======================================

$("signupForm").addEventListener("submit", async event => {
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

// ======================================
// تسجيل الدخول
// ======================================

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  message("loginMessage", "جاري تسجيل الدخول...");

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    message("loginMessage", error.message);
    return;
  }

  message("loginMessage", "تم تسجيل الدخول.");
  await refreshSession();
});

// تسجيل الدخول باستخدام Google
$("googleLoginBtn")?.addEventListener("click", async () => {
  message("googleMessage", "جاري فتح تسجيل الدخول باستخدام Google...");

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: location.origin + location.pathname
    }
  });

  if (error) {
    message("googleMessage", "فشل تسجيل الدخول: " + error.message);
  }
});

// ======================================
// تسجيل الخروج
// ======================================

$("logoutBtn").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();

  if (error) {
    message("accountMessage", error.message);
    return;
  }

  currentUser = null;
  currentProfile = null;
  showDashboard(false);
});

// ======================================
// إدارة النقاط يدويًا
// ======================================

$("pointsForm").addEventListener("submit", async event => {
  event.preventDefault();
  message("pointsMessage", "جاري تنفيذ العملية...");

  if (!currentProfile ||
      !["admin", "servant"].includes(currentProfile.role) ||
      currentProfile.approval_status !== "approved") {
    message("pointsMessage", "ليس لديك صلاحية إضافة النقاط.");
    return;
  }

  const memberId = $("pointsMember").value;
  const amount = Number($("pointsAmount").value);
  const reason = $("pointsReason").value.trim();

  if (!memberId || !Number.isInteger(amount) ||
      amount === 0 || amount < -100 || amount > 100 ||
      !reason || reason.length > 200) {
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

// ======================================
// تعيين الخدام للمجموعات
// ======================================

$("assignForm").addEventListener("submit", async event => {
  event.preventDefault();
  message("assignMessage", "جاري تعيين الخادم...");

  if (!currentProfile ||
      currentProfile.role !== "admin" ||
      currentProfile.approval_status !== "approved") {
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
    }, {
      onConflict: "servant_id,group_id"
    });

  if (error) {
    message("assignMessage", "فشل التعيين: " + error.message);
    return;
  }

  message("assignMessage", "تم تعيين الخادم للمجموعة.");
  await loadAssignments();
});

// ======================================
// نشر درس
// ======================================

$("lessonCreateForm").addEventListener("submit", async event => {
  event.preventDefault();
  message("lessonCreateMessage", "جاري نشر الدرس...");

  if (!currentUser || !currentProfile ||
      currentProfile.approval_status !== "approved") {
    message("lessonCreateMessage", "يلزم حساب خادم معتمد.");
    return;
  }

  const groupId = $("lessonGroup").value;
  const title = $("lessonTitle").value.trim();
  const body = $("lessonBody").value.trim();
  const url = $("lessonUrl").value.trim();

  if (!groupId || !title || !body) {
    message("lessonCreateMessage",
      "اختار المجموعة واكتب العنوان ومحتوى الدرس.");
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

// ======================================
// نوع الاختبار
// ======================================

$("quizType").addEventListener("change", () => {
  $("quizLesson").required = $("quizType").value === "lesson";
  $("quizLesson").disabled = $("quizType").value !== "lesson";
});

// ======================================
// إنشاء اختبار مع مكافأة
// ======================================

$("quizCreateForm").addEventListener("submit", async event => {
  event.preventDefault();
  message("quizCreateMessage", "جاري إنشاء الاختبار...");

  if (!currentUser || !currentProfile ||
      !["admin", "servant"].includes(currentProfile.role) ||
      currentProfile.approval_status !== "approved") {
    message("quizCreateMessage", "ليس لديك صلاحية إنشاء امتحان.");
    return;
  }

  const type = $("quizType").value;
  const lessonId = $("quizLesson").value || null;
  const groupId = $("quizGroup").value;

  const rewardPoints = Number.parseInt(
    $("quizPointsReward").value || "0",
    10
  );

  if (
    !Number.isInteger(rewardPoints) ||
    rewardPoints < 0 ||
    rewardPoints > 1000
  ) {
    message(
      "quizCreateMessage",
      "مكافأة الامتحان يجب أن تكون من 0 إلى 1000 نقطة."
    );
    return;
  }

  if (type === "lesson" && !lessonId) {
    message("quizCreateMessage", "اختار الدرس المرتبط بالأسئلة.");
    return;
  }

  const { data, error } = await supabase.from("quizzes").insert({
    title: $("quizTitle").value.trim(),
    description: $("quizDescription").value.trim(),
    group_id: groupId,
    lesson_id: type === "lesson" ? Number(lessonId) : null,
    quiz_type: type,
    points_reward: rewardPoints,
    created_by: currentUser.id,
    is_published: false
  }).select("id").single();

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

// ======================================
// إضافة سؤال
// ======================================

$("questionCreateForm").addEventListener("submit", async event => {
  event.preventDefault();
  message("questionCreateMessage", "جاري إضافة السؤال...");

  const quizId = $("questionQuiz").value;
  const options = [0, 1, 2, 3].map(i =>
    $("option" + i).value.trim()
  );

  if (!quizId || !options.every(Boolean)) {
    message("questionCreateMessage",
      "اختار الاختبار واكتب الاختيارات الأربعة.");
    return;
  }

  const questionText = $("questionText").value.trim();

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
    message("questionCreateMessage",
      "فشل إضافة السؤال: " + error.message);
    return;
  }

  const { error: keyError } = await supabase
    .from("quiz_answer_keys")
    .insert({
      question_id: question.id,
      correct_option: Number($("correctOption").value)
    });

  if (keyError) {
    message("questionCreateMessage",
      "تم إنشاء السؤال لكن فشل حفظ مفتاح الإجابة: " + keyError.message);
    return;
  }

  message("questionCreateMessage",
    "تمت إضافة السؤال والإجابة الصحيحة بشكل آمن.");

  $("questionCreateForm").reset();
  await loadQuizzes();
});

// ======================================
// الحضور والغياب
// ======================================

$("loadAttendanceBtn").addEventListener("click", loadAttendanceRoster);
$("saveAttendanceBtn").addEventListener("click", saveAttendanceRoster);

// ======================================
// تغيير اللغة
// ======================================

$("langBtn").addEventListener("click", () => {
  lang = lang === "ar" ? "en" : "ar";

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

  $("langBtn").textContent = lang === "ar" ? "EN" : "عربي";

  message("accountMessage",
    lang === "en"
      ? "Some dashboard content is still in Arabic."
      : "تم الرجوع للواجهة العربية.");
});

// متابعة حالة تسجيل الدخول
supabase.auth.onAuthStateChange(() => {
  setTimeout(() => refreshSession(), 0);
});

// تشغيل الموقع عند فتح الصفحة
if ($("attendanceDate")) {
  $("attendanceDate").value = new Date().toLocaleDateString("en-CA");
}

await Promise.all([
  loadEvents("eventsList"),
  loadLessons("lessonsList"),
  refreshSession()
]);
