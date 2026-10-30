
import { supabase } from "./supabase.js";

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let initialized = false;
  let busy = false;
  let groups = [];

  const roleNames = {
    member: "عضو",
    servant: "خادم",
    admin: "أدمن"
  };

  const statusNames = {
    pending: "في انتظار الموافقة",
    approved: "مقبول",
    rejected: "مرفوض"
  };

  function showMessage(text, isError = false) {
    const target = $("adminLiveMessage");
    if (!target) return;

    target.textContent = text;
    target.className = isError ? "status error" : "status success";
  }

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text ?? "");
    return element;
  }

  function addButton(label, className, onClick) {
    const button = make("button", className, label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  function addOption(select, label, value) {
    select.add(new Option(label, value));
  }

  async function adminAction(profile, status, role, groupId) {
    const { error } = await supabase.rpc("admin_update_member", {
      p_member_id: profile.id,
      p_approval_status: status,
      p_role: role,
      p_group_id: groupId || null
    });

    if (error) {
      showMessage("فشلت العملية: " + error.message, true);
      return false;
    }

    return true;
  }

  async function loadGroups() {
    const { data, error } = await supabase
      .from("ministry_groups")
      .select("id,name")
      .order("name");

    if (error) {
      showMessage("تعذر تحميل المجموعات: " + error.message, true);
      return false;
    }

    groups = data || [];
    return true;
  }

  function renderStats(profiles) {
    $("demoMembersCount").textContent = profiles.length;

    $("demoRequestsCount").textContent =
      profiles.filter(p => p.approval_status === "pending").length;

    $("demoServantsCount").textContent =
      profiles.filter(p =>
        p.role === "servant" && p.approval_status === "approved"
      ).length;

    $("demoGroupsCount").textContent = groups.length;
  }

  function renderGroups() {
    const target = $("demoGroupsList");
    target.replaceChildren();

    if (!groups.length) {
      target.append(make("p", "muted", "لا توجد مجموعات حتى الآن."));
      return;
    }

    groups.forEach(group => {
      const card = make("article", "item demo-group");
      card.append(make("strong", "", group.name));
      target.append(card);
    });
  }

  async function loadProfiles() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,full_name,role,approval_status,points,group_id,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      showMessage("تعذر تحميل الحسابات: " + error.message, true);
      return null;
    }

    return data || [];
  }

  function renderRequests(profiles) {
    const target = $("demoRequestsList");
    target.replaceChildren();

    const requests = profiles.filter(
      profile => profile.approval_status === "pending"
    );

    if (!requests.length) {
      target.append(make("p", "muted", "لا توجد طلبات معلقة حاليًا."));
      return;
    }

    requests.forEach(profile => {
      const card = make("article", "item");
      card.append(make("h3", "", profile.full_name || "بدون اسم"));
      card.append(make("p", "muted", "الدور الحالي: " +
        (roleNames[profile.role] || profile.role)));

      const actions = make("div", "demo-actions");

      actions.append(
        addButton("قبول الحساب", "primary", async () => {
          if (busy) return;

          busy = true;
          showMessage("جاري قبول الحساب...");

          const success = await adminAction(
            profile,
            "approved",
            profile.role || "member",
            profile.group_id
          );

          busy = false;

          if (success) {
            showMessage("تم قبول الحساب بنجاح.");
            await refreshAdminDashboard();
          }
        }),

        addButton("رفض الحساب", "demo-danger", async () => {
          if (busy) return;

          if (!confirm("هل أنت متأكد من رفض هذا الحساب؟")) return;

          busy = true;
          showMessage("جاري رفض الحساب...");

          const success = await adminAction(
            profile,
            "rejected",
            profile.role || "member",
            profile.group_id
          );

          busy = false;

          if (success) {
            showMessage("تم رفض الحساب.");
            await refreshAdminDashboard();
          }
        })
      );

      card.append(actions);
      target.append(card);
    });
  }

  function renderAccounts(profiles) {
    const target = $("demoAccountsList");
    target.replaceChildren();

    if (!profiles.length) {
      target.append(make("p", "muted", "لا توجد حسابات."));
      return;
    }

    profiles.forEach(profile => {
      const card = make("article", "item demo-account");

      const info = make("div");
      info.append(make("h3", "", profile.full_name || "بدون اسم"));
      info.append(make("p", "muted",
        "الحالة: " + (statusNames[profile.approval_status] || profile.approval_status)
      ));
      info.append(make("p", "muted",
        "الدور: " + (roleNames[profile.role] || profile.role) +
        " • النقاط: " + (profile.points ?? 0)
      ));

      const controls = make("div", "demo-account-controls");

      const roleSelect = make("select");
      roleSelect.setAttribute("aria-label", "دور " + (profile.full_name || "العضو"));

      Object.entries(roleNames).forEach(([value, label]) => {
        addOption(roleSelect, label, value);
      });

      roleSelect.value = profile.role || "member";

      const statusSelect = make("select");
      statusSelect.setAttribute("aria-label", "حالة الحساب");

      Object.entries(statusNames).forEach(([value, label]) => {
        addOption(statusSelect, label, value);
      });

      statusSelect.value = profile.approval_status || "pending";

      const groupSelect = make("select");
      groupSelect.setAttribute("aria-label", "مجموعة العضو");
      addOption(groupSelect, "بدون مجموعة", "");

      groups.forEach(group => {
        addOption(groupSelect, group.name, group.id);
      });

      groupSelect.value = profile.group_id || "";

      const save = addButton("حفظ التعديلات", "primary", async () => {
        if (busy) return;

        busy = true;
        save.disabled = true;
        showMessage("جاري حفظ التعديلات...");

        const success = await adminAction(
          profile,
          statusSelect.value,
          roleSelect.value,
          groupSelect.value
        );

        busy = false;
        save.disabled = false;

        if (success) {
          showMessage("تم حفظ بيانات الحساب.");
          await refreshAdminDashboard();
        }
      });

      controls.append(roleSelect, statusSelect, groupSelect, save);
      card.append(info, controls);
      target.append(card);
    });
  }

  async function refreshAdminDashboard() {
    const [groupsOk, profiles] = await Promise.all([
      loadGroups(),
      loadProfiles()
    ]);

    if (!groupsOk || !profiles) return;

    renderStats(profiles);
    renderRequests(profiles);
    renderAccounts(profiles);
    renderGroups();
  }

  function setupAddGroup() {
    const form = $("demoAddGroupForm");
    if (!form || form.dataset.connected === "yes") return;

    form.dataset.connected = "yes";

    form.addEventListener("submit", async event => {
      event.preventDefault();

      const input = $("demoNewGroup");
      const name = input.value.trim();

      if (!name) {
        showMessage("اكتب اسم المجموعة أولًا.", true);
        return;
      }

      if (groups.some(group =>
        group.name.toLowerCase() === name.toLowerCase()
      )) {
        showMessage("المجموعة موجودة بالفعل.", true);
        return;
      }

      const button = form.querySelector("button[type='submit']");
      if (button) button.disabled = true;

      const { error } = await supabase
        .from("ministry_groups")
        .insert({ name });

      if (button) button.disabled = false;

      if (error) {
        showMessage("تعذرت إضافة المجموعة: " + error.message, true);
        return;
      }

      input.value = "";
      showMessage("تمت إضافة المجموعة بنجاح.");
      await refreshAdminDashboard();
    });
  }

  async function init() {
    if (initialized) return;

    const panel = $("adminPanel");
    if (!panel || panel.classList.contains("hidden")) return;

    initialized = true;

    const header = panel.querySelector(".admin-heading");
    const oldLabel = header?.querySelector(".demo-label");
    if (oldLabel) oldLabel.remove();

    panel.querySelector(".demo-warning")?.remove();

    const requestDescription =
      $("demoRequestsList")?.previousElementSibling;

    if (requestDescription) {
      requestDescription.textContent =
        "طلبات الحسابات الجديدة من قاعدة البيانات.";
    }

    const accountsDescription =
      $("demoAccountsList")?.previousElementSibling;

    if (accountsDescription) {
      accountsDescription.textContent =
        "تعديل دور الحساب وحالة اعتماده ومجموعته.";
    }

    const groupForm = $("demoAddGroupForm");
    if (groupForm) {
      const oldDescription = groupForm.querySelector("p.muted");
      if (oldDescription) oldDescription.remove();
    }

    if (!$("adminLiveMessage")) {
      const liveMessage = make("p", "status");
      liveMessage.id = "adminLiveMessage";
      liveMessage.setAttribute("role", "status");
      panel.insertBefore(liveMessage, panel.children[1] || null);
    }

    setupAddGroup();
    showMessage("جاري تحميل بيانات الإدارة...");
    await refreshAdminDashboard();
  }

  document.addEventListener("DOMContentLoaded", () => {
    const panel = $("adminPanel");
    if (!panel) return;

    const observer = new MutationObserver(() => {
      if (!panel.classList.contains("hidden")) {
        init();
      }
    });

    observer.observe(panel, {
      attributes: true,
      attributeFilter: ["class"]
    });

    if (!panel.classList.contains("hidden")) {
      init();
    }
  });
})();
