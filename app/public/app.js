const params = new URLSearchParams(window.location.search);
const state = {
  view: params.get("view") ?? "review",
  date: params.get("batch") ?? params.get("date"),
  source: params.get("source") ?? "linkedin",
  rawFile: params.get("rawFile"),
  selectedFile: params.get("selectedFile"),
  activeTab: "selected",
  dashboardStatus: "all",
  dashboardSearch: "",
  dashboardAction: null,
  data: null,
  dashboard: null,
  saveTimers: new Map(),
};

const tabs = [
  ["selected", "Selected"],
  ["rejected", "Rejected"],
];

const tagOptions = [
  "good_topic",
  "not_ai",
  "not_thesis",
  "too_broad",
  "good_company",
  "language_issue",
];

const actionLabels = {
  applied: "Mark Applied",
  interview_scheduled: "Schedule Interview",
  interview_completed: "Mark Interview Completed",
  employer_agreed: "Mark Employer Agreed",
  closed: "Close",
  note: "Add Note",
};

function jobId(job) {
  return String(job.id ?? job.sourceJobId ?? job.link ?? job.url ?? "");
}

function text(value, fallback = "") {
  return value == null || value === "" ? fallback : String(value);
}

function createEl(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content != null) el.textContent = content;
  return el;
}

function setUrlView(view) {
  const next = new URLSearchParams(window.location.search);
  next.set("view", view);
  history.pushState(null, "", `/?${next.toString()}`);
}

async function loadApp() {
  if (state.view === "dashboard") {
    await loadDashboard();
  } else {
    await loadState();
  }
}

async function loadState() {
  const query = new URLSearchParams({ source: state.source });
  if (state.date) query.set("batch", state.date);
  if (state.rawFile) query.set("rawFile", state.rawFile);
  if (state.selectedFile) query.set("selectedFile", state.selectedFile);
  const response = await fetch(`/api/state?${query.toString()}`);
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to load state");
  state.data = await response.json();
  state.date = state.data.date;
  renderReview();
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to load dashboard");
  state.dashboard = await response.json();
  renderDashboard();
}

async function saveAnnotation(id, patch) {
  const existing = state.data.annotations[id] ?? { id, decision: null, note: "", tags: [] };
  const payload = {
    date: state.date,
    source: state.source,
    rawFile: state.data.files.raw,
    selectedFile: state.data.files.selected,
    id,
    decision: patch.decision ?? existing.decision,
    note: patch.note ?? existing.note ?? "",
    tags: patch.tags ?? existing.tags ?? [],
  };

  const response = await fetch("/api/annotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to save annotation");
  const result = await response.json();
  state.data.annotations = result.annotations;
  if (payload.decision === "accept") {
    await loadState();
  } else {
    updateCardStatus(id);
  }
}

async function saveApplicationEvent(jobKey, form) {
  const data = new FormData(form);
  const type = data.get("type");
  const payload = {
    jobKey,
    type,
    date: data.get("date") || new Date().toISOString().slice(0, 10),
    note: data.get("note") ?? "",
    nextActionAt: data.get("nextActionAt") || null,
  };

  const response = await fetch("/api/applications/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to save event");
  state.dashboardAction = null;
  await loadDashboard();
}

function debounceSave(id, patchFactory) {
  clearTimeout(state.saveTimers.get(id));
  state.saveTimers.set(id, setTimeout(() => {
    saveAnnotation(id, patchFactory()).catch(showError);
  }, 500));
}

function showError(error) {
  const banner = document.querySelector(".error-banner");
  if (banner) banner.textContent = error.message ?? String(error);
}

function renderShell(title, subtitle) {
  const app = document.querySelector("#app");
  app.textContent = "";

  const header = createEl("header", "page-header");
  const nav = createEl("nav", "top-nav");
  for (const [view, label] of [["review", "Review"], ["dashboard", "Dashboard"]]) {
    const button = createEl("button", state.view === view ? "nav-button active" : "nav-button", label);
    button.type = "button";
    button.addEventListener("click", async () => {
      state.view = view;
      setUrlView(view);
      await loadApp().catch(showFatalError);
    });
    nav.append(button);
  }
  header.append(nav);
  if (subtitle) header.append(createEl("div", "eyebrow", subtitle));
  header.append(createEl("h1", null, title));
  header.append(createEl("div", "error-banner"));
  app.append(header);
  return app;
}

function renderReview() {
  const app = renderShell("Job Review", `${state.source} / ${state.date}`);
  const summary = createEl("p", "summary", `${state.data.counts.selected} selected · ${state.data.counts.rejected} rejected · ${state.data.counts.annotations} annotated`);
  app.querySelector(".page-header").insertBefore(summary, app.querySelector(".error-banner"));

  const tabList = createEl("nav", "tabs");
  for (const [key, label] of tabs) {
    const button = createEl("button", key === state.activeTab ? "tab active" : "tab", `${label} (${state.data.counts[key]})`);
    button.type = "button";
    button.addEventListener("click", () => {
      state.activeTab = key;
      renderReview();
    });
    tabList.append(button);
  }
  app.append(tabList);

  const list = createEl("section", "job-list");
  for (const job of state.data.items[state.activeTab]) {
    list.append(renderJobCard(job));
  }
  app.append(list);
}

function renderDashboard() {
  const app = renderShell("Application Dashboard", "Accepted jobs across batches");
  const total = state.dashboard.counts.all ?? 0;
  const active = total - (state.dashboard.counts.closed ?? 0);
  const summary = createEl("p", "summary", `${total} accepted · ${active} active · ${state.dashboard.counts.closed ?? 0} closed`);
  app.querySelector(".page-header").insertBefore(summary, app.querySelector(".error-banner"));

  const toolbar = createEl("section", "dashboard-toolbar");
  const statusTabs = createEl("div", "status-tabs");
  for (const [key, label] of [["all", "All"], ...Object.entries(state.dashboard.statuses)]) {
    const count = state.dashboard.counts[key] ?? 0;
    const button = createEl("button", state.dashboardStatus === key ? "status-tab active" : "status-tab", `${label} (${count})`);
    button.type = "button";
    button.addEventListener("click", () => {
      state.dashboardStatus = key;
      renderDashboard();
    });
    statusTabs.append(button);
  }
  const search = createEl("input", "dashboard-search");
  search.type = "search";
  search.placeholder = "Search title, company, location";
  search.value = state.dashboardSearch;
  search.addEventListener("input", () => {
    state.dashboardSearch = search.value;
    renderDashboard();
  });
  toolbar.append(statusTabs, search);
  app.append(toolbar);

  const list = createEl("section", "application-list");
  const items = filteredDashboardItems();
  if (!items.length) {
    list.append(createEl("p", "empty", "No applications match the current filter."));
  }
  for (const item of items) {
    list.append(renderApplicationCard(item));
  }
  app.append(list);
}

function filteredDashboardItems() {
  const search = state.dashboardSearch.trim().toLowerCase();
  return (state.dashboard.items ?? []).filter(({ job, application }) => {
    const statusMatches = state.dashboardStatus === "all" || application.currentStatus === state.dashboardStatus;
    const haystack = [job.title, job.companyName, job.location, job.source].filter(Boolean).join(" ").toLowerCase();
    return statusMatches && (!search || haystack.includes(search));
  });
}

function renderJobCard(job) {
  const id = jobId(job);
  const annotation = state.data.annotations[id] ?? {};
  const article = createEl("article", "job-card");
  article.dataset.jobId = id;

  const titleRow = createEl("div", "job-title-row");
  const titleBlock = createEl("div");
  titleBlock.append(createEl("h2", null, text(job.title, "Untitled")));
  titleBlock.append(createEl("p", "meta", [job.companyName, job.location, job.postedAt].filter(Boolean).join(" · ")));
  titleRow.append(titleBlock);
  titleRow.append(renderDecisionControls(id, annotation.decision));
  article.append(titleRow);

  const links = createEl("div", "links");
  if (job.link) links.append(renderLink("LinkedIn", job.link));
  if (job.applyUrl) links.append(renderLink("Apply", job.applyUrl));
  article.append(links);

  const selection = renderSelection(job);
  if (selection) article.append(selection);

  const description = createEl("details", "description");
  const summary = createEl("summary", null, "Description");
  const body = createEl("p", null, text(job.descriptionText, "No description"));
  description.append(summary, body);
  article.append(description);

  article.append(renderTagControls(id, annotation.tags ?? []));

  const note = createEl("textarea", "note");
  note.placeholder = "Add note...";
  note.value = annotation.note ?? "";
  note.addEventListener("input", () => debounceSave(id, () => ({ note: note.value })));
  article.append(note);

  article.append(createEl("div", "save-status", annotation.reviewedAt ? `Saved ${new Date(annotation.reviewedAt).toLocaleString()}` : "Not reviewed"));
  return article;
}

function renderApplicationCard({ job, application }) {
  const article = createEl("article", "application-card");
  const titleRow = createEl("div", "job-title-row");
  const titleBlock = createEl("div");
  titleBlock.append(createEl("h2", null, text(job.title, "Untitled")));
  titleBlock.append(createEl("p", "meta", [job.companyName, job.location, job.source].filter(Boolean).join(" · ")));
  titleRow.append(titleBlock);
  titleRow.append(createEl("span", "status-pill", state.dashboard.statuses[application.currentStatus] ?? application.currentStatus));
  article.append(titleRow);

  const links = createEl("div", "links");
  if (job.link) links.append(renderLink("Source", job.link));
  if (job.applyUrl) links.append(renderLink("Apply", job.applyUrl));
  article.append(links);

  article.append(renderApplicationActions(job.jobKey));
  if (state.dashboardAction?.jobKey === job.jobKey) {
    article.append(renderActionForm(job.jobKey, state.dashboardAction.type));
  }

  const timeline = createEl("ol", "timeline");
  for (const event of [...(application.events ?? [])].reverse()) {
    const item = createEl("li");
    item.append(createEl("strong", null, event.type.replaceAll("_", " ")));
    item.append(document.createTextNode(` · ${event.date}`));
    if (event.note) item.append(createEl("p", null, event.note));
    timeline.append(item);
  }
  article.append(timeline);
  return article;
}

function renderApplicationActions(jobKey) {
  const group = createEl("div", "application-actions");
  for (const [type, label] of Object.entries(actionLabels)) {
    const button = createEl("button", "action-button", label);
    button.type = "button";
    button.addEventListener("click", () => {
      state.dashboardAction = { jobKey, type };
      renderDashboard();
    });
    group.append(button);
  }
  return group;
}

function renderActionForm(jobKey, type) {
  const form = createEl("form", "action-form");
  const today = new Date().toISOString().slice(0, 10);
  form.innerHTML = `
    <input type="hidden" name="type" value="${type}">
    <label>Date <input name="date" type="date" value="${today}"></label>
    <label>Next action <input name="nextActionAt" type="date"></label>
    <label class="wide">Note <textarea name="note" placeholder="Add context..."></textarea></label>
    <div class="form-actions">
      <button type="submit">Save ${actionLabels[type]}</button>
      <button type="button" data-cancel>Cancel</button>
    </div>
  `;
  form.querySelector("[data-cancel]").addEventListener("click", () => {
    state.dashboardAction = null;
    renderDashboard();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveApplicationEvent(jobKey, form).catch(showError);
  });
  return form;
}

function renderLink(label, href) {
  const a = createEl("a", "link-button", label);
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  return a;
}

function renderDecisionControls(id, decision) {
  const group = createEl("div", "decisions");
  for (const value of ["accept", "reject", "maybe"]) {
    const button = createEl("button", decision === value ? `decision ${value} active` : `decision ${value}`, value);
    button.type = "button";
    button.addEventListener("click", () => saveAnnotation(id, { decision: value }).catch(showError));
    group.append(button);
  }
  return group;
}

function renderTagControls(id, tags) {
  const wrap = createEl("div", "tags");
  for (const tag of tagOptions) {
    const label = createEl("label", "tag");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = tags.includes(tag);
    input.addEventListener("change", () => {
      const current = new Set(state.data.annotations[id]?.tags ?? tags);
      if (input.checked) current.add(tag);
      else current.delete(tag);
      saveAnnotation(id, { tags: [...current] }).catch(showError);
    });
    label.append(input, document.createTextNode(tag));
    wrap.append(label);
  }
  return wrap;
}

function renderSelection(job) {
  const must = job._selection?.must ?? [];
  if (!must.length) return null;
  const wrap = createEl("div", "selection");
  wrap.append(createEl("strong", null, "Matched: "));
  wrap.append(document.createTextNode(must.map((rule) => `${rule.id}: ${(rule.matchedTerms ?? []).join(", ")}`).join(" | ")));
  return wrap;
}

function updateCardStatus(id) {
  const card = document.querySelector(`[data-job-id="${CSS.escape(id)}"]`);
  if (!card) return;
  const annotation = state.data.annotations[id] ?? {};
  const status = card.querySelector(".save-status");
  if (status) status.textContent = annotation.reviewedAt ? `Saved ${new Date(annotation.reviewedAt).toLocaleString()}` : "Not reviewed";

  for (const button of card.querySelectorAll(".decision")) {
    button.classList.toggle("active", button.textContent === annotation.decision);
  }
}

function showFatalError(error) {
  document.querySelector("#app").textContent = error.message ?? String(error);
}

window.addEventListener("popstate", () => {
  const next = new URLSearchParams(window.location.search);
  state.view = next.get("view") ?? "review";
  loadApp().catch(showFatalError);
});

loadApp().catch(showFatalError);
