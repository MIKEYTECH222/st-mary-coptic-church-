
import { supabase } from "./supabase.js";

const $ = id => document.getElementById(id);

let redirecting = false;

function showMessage(id, text) {
  const element = $(id);
  if (element) element.textContent = text || "";
}

function setLoading(button, loading, normalText) {
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? "جاري التنفيذ..." : normalText;
}

/* =====================================
   توجيه المستخدم حسب نوع الحساب
===================================== */

async function routeUser() {
  if (redirecting) return;

  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !sessionData.session) return;

  showMessage("accountMessage", "جاري التحقق من بيانات حسابك...");

  const user = sessionData.session.user;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name,role,approval_status")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    showMessage("accountMessage", "تعذر تحميل بيانات الحساب: " + error.message);
    return;
  }

  if (!profile) {
    showMessage("accountMessage", "لم يتم العثور على ملفك الشخصي. تواصل مع مسؤول الخدمة.");
    return;
  }

  if (profile.approval_status === "pending") {
    showMessage("accountMessage", "حسابك في انتظار موافقة مسؤول الخدمة.");
    return;
  }

  if (profile.approval_status === "rejected") {
    showMessage("accountMessage", "عذرًا، لم تتم الموافقة على حسابك. تواصل مع الإدارة.");
    return;
  }

  if (profile.approval_status !== "approved") {
    showMessage("accountMessage", "حالة الحساب غير معروفة. تواصل مع الإدارة.");
    return;
  }

  const destinations = {
    admin: "./admin.html",
    servant: "./servant.html",
    member: "./dashboard.html"
  };

  const destination = destinations[profile.role] || "./dashboard.html";

  redirecting = true;
  location.replace(destination);
}

/* =====================================
   التبديل بين تسجيل الدخول وإنشاء الحساب
===================================== */

$("loginTab")?.addEventListener("click", () => {
  $("loginForm")?.classList.remove("hidden");
  $("signupForm")?.classList.add("hidden");

  $("loginTab")?.classList.add("active");
  $("signupTab")?.classList.remove("active");

  showMessage("accountMessage", "");
});

$("signupTab")?.addEventListener("click", () => {
  $("signupForm")?.classList.remove("hidden");
  $("loginForm")?.classList.add("hidden");

  $("signupTab")?.classList.add("active");
  $("loginTab")?.classList.remove("active");

  showMessage("accountMessage", "");
});

/* =====================================
   إنشاء حساب جديد
===================================== */

$("signupForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("signupForm").querySelector("button[type='submit']");

  const fullName = $("signupName").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;

  if (!fullName || !email || password.length < 8) {
    showMessage("signupMessage", "راجع البيانات وتأكد أن كلمة المرور 8 أحرف على الأقل.");
    return;
  }

  setLoading(button, true, "إنشاء الحساب");
  showMessage("signupMessage", "");

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: location.origin + location.pathname
    }
  });

  setLoading(button, false, "إنشاء الحساب");

  if (error) {
    showMessage("signupMessage", "فشل إنشاء الحساب: " + error.message);
    return;
  }

  if (data.session) {
    showMessage("signupMessage", "تم إنشاء الحساب بنجاح. حسابك الآن في انتظار موافقة الإدارة.");
    await routeUser();
  } else {
    showMessage(
      "signupMessage",
      "تم إرسال طلب إنشاء الحساب. راجع بريدك الإلكتروني لتأكيد الحساب، ثم انتظر موافقة الإدارة."
    );
  }
});

/* =====================================
   تسجيل الدخول
===================================== */

$("loginForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const button = $("loginForm").querySelector("button[type='submit']");

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  setLoading(button, true, "تسجيل الدخول");
  showMessage("loginMessage", "");

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  setLoading(button, false, "تسجيل الدخول");

  if (error) {
    showMessage("loginMessage", "فشل تسجيل الدخول: " + error.message);
    return;
  }

  showMessage("loginMessage", "تم تسجيل الدخول بنجاح.");
  await routeUser();
});

/* =====================================
   تسجيل الدخول باستخدام Google
===================================== */

$("googleLoginBtn")?.addEventListener("click", async () => {
  const button = $("googleLoginBtn");

  setLoading(button, true, "تسجيل الدخول باستخدام Google");

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: location.origin + location.pathname
    }
  });

  if (error) {
    setLoading(button, false, "تسجيل الدخول باستخدام Google");
    showMessage("accountMessage", "فشل تسجيل الدخول: " + error.message);
  }
});

/* =====================================
   تسجيل الخروج من صفحة تسجيل الدخول
===================================== */

async function logoutIfNeeded() {
  const { data } = await supabase.auth.getSession();

  if (data.session) {
    showMessage("accountMessage", "يوجد حساب مسجل بالفعل. جاري فتح صفحتك...");
    await routeUser();
  }
}

/* =====================================
   متابعة حالة تسجيل الدخول
===================================== */

supabase.auth.onAuthStateChange((event, session) => {
  if (session && ["SIGNED_IN", "TOKEN_REFRESHED"].includes(event)) {
    setTimeout(() => routeUser(), 0);
  }
});

/* =====================================
   تشغيل الصفحة
===================================== */

await logoutIfNeeded();
