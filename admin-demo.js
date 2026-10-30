
const $ = (id) => document.getElementById(id);

let demoRequests = [
  { id: 1, name: "مينا عادل", email: "mina@example.com" },
  { id: 2, name: "مارينا سامح", email: "marina@example.com" },
  { id: 3, name: "كيرلس فادي", email: "kirillos@example.com" },
  { id: 4, name: "بيتر مجدي", email: "peter@example.com" }
];

let demoAccounts = [
  { name: "مينا عادل", role: "member", status: "معتمد" },
  { name: "مارينا سامح", role: "servant", status: "معتمد" },
  { name: "كيرلس فادي", role: "member", status: "قيد المراجعة" },
  { name: "بيتر مجدي", role: "servant", status: "معتمد" },
  { name: "نورهان مينا", role: "admin", status: "معتمد" }
];

let demoGroups = [
  "إعدادي بنين",
  "إعدادي بنات",
  "ثانوي",
  "جامعة",
  "خريجين",
  "شباب",
  "اجتماع عام",
  "أنشطة"
];

function renderDemoRequests() {
  const container = $("demoRequests");
  if (!container) return;

  container.replaceChildren();

  demoRequests.forEach(request => {
    const card = document.createElement("article");
    card.className = "item";

    const title = document.createElement("h3");
    title.textContent = request.name;

    const email = document.createElement("p");
    email.textContent = request.email;

    const actions = document.createElement("div");
    actions.className = "demo-actions";

    ["موافقة", "رفض"].forEach((label, index) => {
      const button = document.createElement("button");
      button.textContent = label;
      button.className = index === 0 ? "primary" : "danger-button";

      button.addEventListener("click", () => {
        demoRequests = demoRequests.filter(x => x.id !== request.id);
        renderDemoRequests();
        updateDemoStats();
      });

      actions.appendChild(button);
    });

    card.append(title, email, actions);
    container.appendChild(card);
  });

  if (!demoRequests.length) {
    container.textContent = "لا توجد طلبات معلقة في العرض التجريبي.";
  }
}

function renderDemoGroups() {
  const container = $("demoGroupsList");
  if (!container) return;

  container.replaceChildren();

  demoGroups.forEach((group, index) => {
    const row = document.createElement("div");
    row.className = "demo-row";

    const name = document.createElement("span");
    name.textContent = group;

    const remove = document.createElement("button");
    remove.textContent = "إزالة";
    remove.className = "danger-button";

    remove.addEventListener("click", () => {
      demoGroups.splice(index, 1);
      renderDemoGroups();
      updateDemoStats();
    });

    row.append(name, remove);
    container.appendChild(row);
  });
}

function renderDemoAccounts() {
  const container = $("demoAccounts");
  if (!container) return;

  container.replaceChildren();

  demoAccounts.forEach(account => {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    name.textContent = account.name;

    const roleCell = document.createElement("td");
    const select = document.createElement("select");

    const roles = [
      ["member", "عضو"],
      ["servant", "خادم"],
      ["admin", "مسؤول"]
    ];

    roles.forEach(([value, label]) => {
      select.add(new Option(label, value));
    });

    select.value = account.role;

    select.addEventListener("change", () => {
      account.role = select.value;
    });

    roleCell.appendChild(select);

    const status = document.createElement("td");
    status.textContent = account.status;

    row.append(name, roleCell, status);
    container.appendChild(row);
  });
}

function updateDemoStats() {
  if ($("demoTotal")) {
    $("demoTotal").textContent = demoAccounts.length;
  }

  if ($("demoPending")) {
    $("demoPending").textContent = demoRequests.length;
  }

  if ($("demoServants")) {
    $("demoServants").textContent =
      demoAccounts.filter(x => x.role === "servant").length;
  }

  if ($("demoGroups")) {
    $("demoGroups").textContent = demoGroups.length;
  }
}

function initAdminDemo() {
  const groupForm = $("demoGroupForm");

  if (!groupForm || groupForm.dataset.initialized === "true") {
    return;
  }

  groupForm.dataset.initialized = "true";

  groupForm.addEventListener("submit", event => {
    event.preventDefault();

    const input = $("demoGroupName");
    const name = input.value.trim();

    if (!name) return;

    if (demoGroups.includes(name)) {
      alert("المجموعة موجودة بالفعل.");
      return;
    }

    demoGroups.push(name);
    input.value = "";

    renderDemoGroups();
    updateDemoStats();
  });

  renderDemoRequests();
  renderDemoGroups();
  renderDemoAccounts();
  updateDemoStats();
}

window.initAdminDemo = initAdminDemo;
