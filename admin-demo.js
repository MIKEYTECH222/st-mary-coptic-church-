
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // بيانات وهمية للعرض فقط — لا يتم إرسالها إلى Supabase.
  const state = {
    requests: [
      { id: 1, name: "مينا عادل", email: "mina.demo@example.com", date: "2026-10-28" },
      { id: 2, name: "مارينا سامح", email: "marina.demo@example.com", date: "2026-10-28" },
      { id: 3, name: "كيرلس بيشوي", email: "kirillos.demo@example.com", date: "2026-10-29" }
    ],
    accounts: [
      { id: 1, name: "مينا عادل", email: "mina.demo@example.com", role: "member" },
      { id: 2, name: "مارينا سامح", email: "marina.demo@example.com", role: "servant" },
      { id: 3, name: "كيرلس بيشوي", email: "kirillos.demo@example.com", role: "member" },
      { id: 4, name: "بيشوي فادي", email: "bishoy.demo@example.com", role: "admin" }
    ],
    groups: ["إعدادي", "ثانوي", "جامعة", "خريجين"],
    nextId: 5
  };

  let initialized = false;

  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function renderStats() {
    $("demoMembersCount").textContent = state.accounts.length;
    $("demoRequestsCount").textContent = state.requests.length;
    $("demoServantsCount").textContent =
      state.accounts.filter((account) => account.role === "servant").length;
    $("demoGroupsCount").textContent = state.groups.length;
  }

  function renderRequests() {
    const target = $("demoRequestsList");
    target.replaceChildren();

    if (!state.requests.length) {
      target.append(make("p", "muted", "لا توجد طلبات معلقة في العرض التجريبي."));
      return;
    }

    state.requests.forEach((request) => {
      const card = make("article", "item");
      card.append(make("h3", "", request.name));
      card.append(make("p", "", request.email));
      card.append(make("small", "muted", "تاريخ الطلب: " + request.date));

      const actions = make("div", "demo-actions");
      const approve = make("button", "primary", "قبول");
      const reject = make("button", "demo-danger", "رفض");

      approve.type = "button";
      reject.type = "button";

      approve.addEventListener("click", () => {
        state.accounts.push({
          id: state.nextId++,
          name: request.name,
          email: request.email,
          role: "member"
        });

        state.requests = state.requests.filter((item) => item.id !== request.id);
        renderAll();
      });

      reject.addEventListener("click", () => {
        state.requests = state.requests.filter((item) => item.id !== request.id);
        renderAll();
      });

      actions.append(approve, reject);
      card.append(actions);
      target.append(card);
    });
  }

  function renderAccounts() {
    const target = $("demoAccountsList");
    target.replaceChildren();

    state.accounts.forEach((account) => {
      const card = make("article", "item demo-account");
      const info = make("div");
      info.append(make("h3", "", account.name));
      info.append(make("p", "", account.email));

      const controls = make("div", "demo-account-controls");
      const select = make("select");
      select.setAttribute("aria-label", "دور " + account.name);

      [
        ["member", "عضو"],
        ["servant", "خادم"],
        ["admin", "أدمن"]
      ].forEach(([value, label]) => {
        const option = new Option(label, value);
        select.add(option);
      });

      select.value = account.role;
      select.addEventListener("change", () => {
        account.role = select.value;
        renderStats();
      });

      controls.append(select);
      card.append(info, controls);
      target.append(card);
    });
  }

  function renderGroups() {
    const target = $("demoGroupsList");
    target.replaceChildren();

    state.groups.forEach((group, index) => {
      const card = make("article", "item demo-group");
      card.append(make("strong", "", group));

      const remove = make("button", "demo-danger", "حذف");
      remove.type = "button";
      remove.addEventListener("click", () => {
        state.groups.splice(index, 1);
        renderAll();
      });

      card.append(remove);
      target.append(card);
    });

    if (!state.groups.length) {
      target.append(make("p", "muted", "لم تتم إضافة مجموعات بعد."));
    }
  }

  function renderAll() {
    renderStats();
    renderRequests();
    renderAccounts();
    renderGroups();
  }

  function init() {
    if (initialized) return;

    const panel = $("adminPanel");
    if (!panel) return;

    const addGroupForm = $("demoAddGroupForm");
    if (addGroupForm) {
      addGroupForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const input = $("demoNewGroup");
        const name = input.value.trim();

        if (!name) return;

        if (state.groups.some((group) => group.toLowerCase() === name.toLowerCase())) {
          $("demoGroupMessage").textContent = "المجموعة موجودة بالفعل.";
          return;
        }

        state.groups.push(name);
        input.value = "";
        $("demoGroupMessage").textContent = "تمت الإضافة في العرض التجريبي.";
        renderAll();
      });
    }

    initialized = true;
    renderAll();
  }

  // لوحة الأدمن تظهر بعد تحميل بيانات الحساب؛ ننتظر ظهورها.
  const observer = new MutationObserver(() => {
    const panel = $("adminPanel");
    if (panel && !panel.classList.contains("hidden")) init();
  });

  document.addEventListener("DOMContentLoaded", () => {
    const panel = $("adminPanel");
    if (!panel) return;

    observer.observe(panel, {
      attributes: true,
      attributeFilter: ["class"]
    });

    if (!panel.classList.contains("hidden")) init();
  });
})();
