
(function () {
  const manifest = document.createElement("link");
  manifest.rel = "manifest";
  manifest.href = "./manifest.json";
  document.head.appendChild(manifest);

  const appleIcon = document.createElement("link");
  appleIcon.rel = "apple-touch-icon";
  appleIcon.href = "./shababna-icon-180.png";
  document.head.appendChild(appleIcon);

  const theme = document.createElement("meta");
  theme.name = "theme-color";
  theme.content = "#080b16";
  document.head.appendChild(theme);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .catch(error => console.error("PWA error:", error));
    });
  }

  let installPrompt = null;

  const button = document.createElement("button");
  button.id = "installAppButton";
  button.textContent = "📲 تثبيت التطبيق";

  Object.assign(button.style, {
    position: "fixed",
    bottom: "20px",
    left: "20px",
    zIndex: "99999",
    padding: "13px 19px",
    border: "1px solid rgba(255,255,255,.2)",
    borderRadius: "15px",
    background: "linear-gradient(135deg,#596be8,#8795ff)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: "0 8px 25px rgba(60,80,200,.35)",
    fontFamily: "Arial,Tahoma,sans-serif"
  });

  document.body.appendChild(button);

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;

  if (isStandalone) {
    button.style.display = "none";
  }

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
  });

  button.addEventListener("click", async () => {
    if (isStandalone) return;

    if (isIOS) {
      alert(
        "لتثبيت تطبيق شبابنا على iPhone:\n\n" +
        "1- اضغط على زر المشاركة في Safari.\n" +
        "2- اختار إضافة إلى الشاشة الرئيسية.\n" +
        "3- اضغط إضافة."
      );
      return;
    }

    if (installPrompt) {
      installPrompt.prompt();

      const result = await installPrompt.userChoice;

      if (result.outcome === "accepted") {
        button.style.display = "none";
      }

      installPrompt = null;
      return;
    }

    alert(
      "لو بتستخدم Chrome:\n" +
      "افتح قائمة المتصفح واختار تثبيت التطبيق أو إضافة إلى الشاشة الرئيسية."
    );
  });

  window.addEventListener("appinstalled", () => {
    button.style.display = "none";
    installPrompt = null;
  });
})();
