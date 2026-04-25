const params = new URLSearchParams(window.location.search);
const state = {
  view: params.get("view") ?? "review",
  date: params.get("batch") ?? params.get("date"),
  canonicalFile: params.get("canonicalFile"),
  selectedFile: params.get("selectedFile"),
  activeTab: "selected",
  reviewCities: [],
  reviewStates: [],
  reviewCompanies: [],
  dashboardStatus: "all",
  dashboardSearch: "",
  dashboardCities: [],
  dashboardStates: [],
  dashboardCompanies: [],
  dashboardAction: null,
  mergeRunning: false,
  mergeStatus: "",
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
  reject: "Reject",
  note: "Add Note",
};

function jobId(job) {
  return String(job.identity?.jobId ?? job.id ?? job.sourceJobId ?? job.link ?? job.url ?? "");
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

function renderDescriptionBody(job) {
  const body = createEl("div", "description-body");
  const html = job.description?.html ?? job.descriptionHtml;
  const plain = job.description?.text ?? job.descriptionText;
  if (html) {
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    for (const child of doc.body.childNodes) {
      const rendered = renderSafeDescriptionNode(child);
      if (rendered) body.append(rendered);
    }
  } else if (plain) {
    body.textContent = String(plain).trim();
  } else {
    body.textContent = "No description";
  }
  return body;
}

function renderSafeDescriptionNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const compact = String(node.nodeValue ?? "").replace(/\s+/g, " ");
    return compact.trim() ? document.createTextNode(compact) : null;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();
  const allowedTags = new Set(["br", "p", "div", "section", "ul", "ol", "li", "strong", "b", "em", "i", "h1", "h2", "h3", "h4"]);
  if (!allowedTags.has(tag)) {
    const fragment = document.createDocumentFragment();
    for (const child of node.childNodes) {
      const rendered = renderSafeDescriptionNode(child);
      if (rendered) fragment.append(rendered);
    }
    return fragment;
  }

  const mappedTag = tag === "b" ? "strong" : tag === "i" ? "em" : ["h1", "h2", "h3", "h4"].includes(tag) ? "h3" : tag;
  const el = document.createElement(mappedTag);
  for (const child of node.childNodes) {
    const rendered = renderSafeDescriptionNode(child);
    if (rendered) el.append(rendered);
  }
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
  const query = new URLSearchParams();
  if (state.date) query.set("batch", state.date);
  if (state.canonicalFile) query.set("canonicalFile", state.canonicalFile);
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
  const existing = effectiveAnnotation(id);
  const payload = {
    date: state.date,
    canonicalFile: state.data.files.canonical,
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
  if (type === "reject") {
    await rejectDashboardJob(jobKey, data.get("note") ?? "");
    return;
  }

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

async function mergeRawForCurrentDate() {
  if (!state.date || state.mergeRunning) return;
  state.mergeRunning = true;
  state.mergeStatus = "Merging raw files...";
  renderReview();

  let errorToShow = null;
  try {
    const response = await fetch("/api/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date: state.date }),
    });
    if (!response.ok) throw new Error((await response.json()).error ?? "Failed to merge raw files");
    const result = await response.json();
    state.mergeStatus = mergeStatusText(result);
    await loadState();
  } catch (error) {
    errorToShow = error;
  } finally {
    state.mergeRunning = false;
    renderReview();
    if (errorToShow) showError(errorToShow);
  }
}

function mergeStatusText(result) {
  const files = result.files ?? [];
  const added = files.reduce((sum, file) => sum + (file.addedCount ?? 0), 0);
  const duplicates = files.reduce((sum, file) => sum + (file.duplicateCount ?? 0), 0);
  const rawCount = files.reduce((sum, file) => sum + (file.rawCount ?? 0), 0);
  if (!rawCount && !files.some((file) => !file.skipped)) {
    return "No new raw files";
  }
  return `Merged ${rawCount} raw jobs, added ${added}, duplicates ${duplicates}, selected ${result.selectedCount}`;
}

async function rejectDashboardJob(jobKey, note) {
  const response = await fetch("/api/applications/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobKey, type: "reject", note }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to reject application");
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

function effectiveAnnotation(id) {
  const existing = state.data.annotations[id] ?? { id, decision: null, note: "", tags: [] };
  if (existing.decision) return existing;
  if (state.view === "review" && state.activeTab === "rejected") {
    return { ...existing, id, decision: "reject" };
  }
  return existing;
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

function renderReview(focusFilter) {
  const app = renderShell("Job Review", state.date);
  const summary = createEl("p", "summary", `${state.data.counts.selected} selected · ${state.data.counts.rejected} rejected · ${state.data.counts.annotations} annotated`);
  app.querySelector(".page-header").insertBefore(summary, app.querySelector(".error-banner"));
  const actions = createEl("div", "review-actions");
  const mergeButton = createEl("button", "action-button", state.mergeRunning ? "Merging..." : "Merge Raw");
  mergeButton.type = "button";
  mergeButton.disabled = state.mergeRunning;
  mergeButton.addEventListener("click", () => mergeRawForCurrentDate().catch(showError));
  actions.append(mergeButton);
  if (state.mergeStatus) actions.append(createEl("span", "merge-status", state.mergeStatus));
  app.querySelector(".page-header").insertBefore(actions, app.querySelector(".error-banner"));

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

  const reviewItems = filteredReviewItems();
  app.append(renderReviewToolbar(baseReviewItems(), reviewItems.length));

  const list = createEl("section", "job-list");
  for (const job of reviewItems) {
    list.append(renderJobCard(job));
  }
  if (!reviewItems.length) {
    list.append(createEl("p", "empty", "No jobs match the current filters."));
  }
  app.append(list);
  restoreReviewFilterFocus(focusFilter);
}

function renderReviewToolbar(baseItems, visibleCount) {
  const toolbar = createEl("section", "review-toolbar");
  toolbar.append(renderJobFilters({
    items: baseItems,
    cityValues: state.reviewCities,
    stateValues: state.reviewStates,
    companyValues: state.reviewCompanies,
    prefix: "review",
    onChange: (kind, values) => {
      if (kind === "city") state.reviewCities = values;
      else if (kind === "state") state.reviewStates = values;
      else state.reviewCompanies = values;
      renderReview();
    },
  }));
  toolbar.append(createEl("p", "filter-count", `${visibleCount} visible`));
  return toolbar;
}

function locationParts(location) {
  const parts = String(location ?? "").split(",").map((part) => part.trim());
  return {
    city: parts[0] ?? "",
    state: parts[1] ?? "",
  };
}

function jobFilterOptions(items) {
  const cities = new Map();
  const states = new Map();
  const companies = new Map();
  for (const item of items) {
    const job = item.job ?? item;
    const location = locationParts(job.location?.raw ?? job.location);
    const companyName = job.company?.name ?? job.companyName;
    if (location.city) cities.set(normalizeOption(location.city), location.city);
    if (location.state) states.set(normalizeOption(location.state), location.state);
    if (companyName) companies.set(normalizeOption(companyName), companyName);
  }
  return {
    city: [...cities].map(([value, label]) => ({ value, label })).sort(optionSort),
    state: [...states].map(([value, label]) => ({ value, label })).sort(optionSort),
    company: [...companies].map(([value, label]) => ({ value, label })).sort(optionSort),
  };
}

function normalizeOption(value) {
  return String(value ?? "").trim().toLowerCase();
}

function optionSort(a, b) {
  return a.label.localeCompare(b.label);
}

function renderJobFilters({ items, cityValues, stateValues, companyValues, prefix, onChange }) {
  const wrap = createEl("div", "job-filters");
  const options = jobFilterOptions(items);
  wrap.append(
    renderMultiSelectFilter({
      key: `${prefix}-city`,
      label: "City",
      options: options.city,
      selected: cityValues,
      onChange: (values) => onChange("city", values),
    }),
    renderMultiSelectFilter({
      key: `${prefix}-state`,
      label: "State",
      options: options.state,
      selected: stateValues,
      onChange: (values) => onChange("state", values),
    }),
    renderMultiSelectFilter({
      key: `${prefix}-company`,
      label: "Company",
      options: options.company,
      selected: companyValues,
      onChange: (values) => onChange("company", values),
    }),
  );
  return wrap;
}

function renderMultiSelectFilter({ key, label, options, selected, onChange }) {
  const details = createEl("details", "multi-filter");
  details.dataset.filter = key;
  const summaryText = selected.length ? `${label} (${selected.length})` : label;
  details.append(createEl("summary", null, summaryText));

  const panel = createEl("div", "filter-options");
  if (!options.length) {
    panel.append(createEl("p", "empty", "No options"));
  }
  if (selected.length) {
    const clear = createEl("button", "filter-clear", "Clear");
    clear.type = "button";
    clear.addEventListener("click", () => onChange([]));
    panel.append(clear);
  }

  for (const option of options) {
    const item = createEl("label", "filter-option");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selected.includes(option.value);
    input.addEventListener("change", () => {
      const next = new Set(selected);
      if (input.checked) next.add(option.value);
      else next.delete(option.value);
      onChange([...next]);
    });
    item.append(input, document.createTextNode(option.label));
    panel.append(item);
  }
  details.append(panel);
  return details;
}

function baseReviewItems() {
  return state.data.items[state.activeTab] ?? [];
}

function filteredReviewItems() {
  return baseReviewItems().filter((job) => {
    const parts = locationParts(job.location?.raw ?? job.location);
    return jobFilterMatches(job, parts, state.reviewCities, state.reviewStates, state.reviewCompanies);
  });
}

function jobFilterMatches(job, parts, cities, states, companies) {
  const city = normalizeOption(parts.city);
  const region = normalizeOption(parts.state);
  const company = normalizeOption(job.company?.name ?? job.companyName);
  return (!cities.length || cities.includes(city))
    && (!states.length || states.includes(region))
    && (!companies.length || companies.includes(company));
}

function restoreReviewFilterFocus(key) {
  restoreFilterFocus(key);
}

function restoreFilterFocus(key) {
  if (!key) return;
  const input = document.querySelector(`[data-filter="${CSS.escape(key)}"]`);
  if (!input) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function renderDashboard(focusFilter) {
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
  search.dataset.filter = "dashboard-search";
  search.placeholder = "Search title, company, location";
  search.value = state.dashboardSearch;
  search.addEventListener("input", () => {
    state.dashboardSearch = search.value;
    renderDashboard("dashboard-search");
  });
  const filters = createEl("div", "dashboard-filters");
  filters.append(renderJobFilters({
    items: dashboardBaseItems(),
    cityValues: state.dashboardCities,
    stateValues: state.dashboardStates,
    companyValues: state.dashboardCompanies,
    prefix: "dashboard",
    onChange: (kind, values) => {
      if (kind === "city") state.dashboardCities = values;
      else if (kind === "state") state.dashboardStates = values;
      else state.dashboardCompanies = values;
      renderDashboard();
    },
  }));
  filters.append(search);
  toolbar.append(statusTabs, filters);
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
  restoreFilterFocus(focusFilter);
}

function dashboardBaseItems() {
  const search = state.dashboardSearch.trim().toLowerCase();
  return (state.dashboard.items ?? []).filter(({ job, application }) => {
    const statusMatches = state.dashboardStatus === "all" || application.currentStatus === state.dashboardStatus;
    const haystack = [job.title, job.companyName, job.location, job.source].filter(Boolean).join(" ").toLowerCase();
    return statusMatches && (!search || haystack.includes(search));
  });
}

function filteredDashboardItems() {
  return dashboardBaseItems().filter(({ job }) => {
    const parts = locationParts(job.location);
    return jobFilterMatches(job, parts, state.dashboardCities, state.dashboardStates, state.dashboardCompanies);
  });
}

function renderJobCard(job) {
  const id = jobId(job);
  const annotation = effectiveAnnotation(id);
  const article = createEl("article", "job-card");
  article.dataset.jobId = id;

  const titleRow = createEl("div", "job-title-row");
  const titleBlock = createEl("div");
  titleBlock.append(createEl("h2", null, text(job.title?.raw ?? job.title, "Untitled")));
  titleBlock.append(createEl("p", "meta", [job.company?.name ?? job.companyName, job.location?.raw ?? job.location, job.postedAt?.raw ?? job.postedAt].filter(Boolean).join(" · ")));
  titleRow.append(titleBlock);
  titleRow.append(renderDecisionControls(id, annotation.decision));
  article.append(titleRow);

  const links = createEl("div", "links");
  const detailUrl = job.links?.detail ?? job.link;
  const applyUrl = job.links?.apply ?? job.applyUrl;
  if (detailUrl) links.append(renderLink("LinkedIn", detailUrl));
  if (applyUrl) links.append(renderLink("Apply", applyUrl));
  article.append(links);

  const selection = renderSelection(job);
  if (selection) article.append(selection);

  const description = createEl("details", "description");
  const summary = createEl("summary", null, "Description");
  description.append(summary, renderDescriptionBody(job));
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
  form.innerHTML = type === "reject" ? `
    <input type="hidden" name="type" value="${type}">
    <label class="wide">Reason <textarea name="note" placeholder="Why should this move back to Rejected?"></textarea></label>
    <div class="form-actions">
      <button type="submit">Save Reject</button>
      <button type="button" data-cancel>Cancel</button>
    </div>
  ` : `
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
  const annotation = effectiveAnnotation(id);
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
