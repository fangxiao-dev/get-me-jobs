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
  reviewWorkplaceTypes: [],
  reviewPostedMaxDays: null,
  dashboardStatus: "all",
  dashboardSearch: "",
  dashboardCities: [],
  dashboardStates: [],
  dashboardCompanies: [],
  dashboardWorkplaceTypes: [],
  dashboardPostedDates: [],
  dashboardAction: null,
  dashboardImportUrl: "",
  dashboardImportRunning: false,
  dashboardImportStatus: "",
  dashboardManualEntry: manualEntryInitialForm(),
  dashboardManualEntryOpen: false,
  dashboardManualEntryRunning: false,
  dashboardManualEntryParsing: false,
  dashboardManualEntryStatus: "",
  dashboardDescriptionEditJobKey: null,
  mergeRunning: false,
  mergeStatus: "",
  batches: [],
  data: null,
  dashboard: null,
  saveTimers: new Map(),
};

const tabs = [
  ["selected", "Selected"],
  ["rejected", "Rejected"],
  ["deleted", "Deleted"],
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
  delete: "Delete",
  note: "Add Note",
};

const actionStatusMap = {
  applied: "applied_waiting",
  interview_scheduled: "interview_scheduled",
  interview_completed: "interview_completed",
  employer_agreed: "employer_agreed",
  closed: "closed",
};

const closeOutcomeEventTypes = {
  success: "contract_signed",
  fail: "rejected",
};

const stageNoteLabels = {
  applied: "Applied",
  interview_scheduled: "Interview scheduled",
  interview_completed: "Interview completed",
  employer_agreed: "Employer agreed",
  closed: "Closed",
  note: "General note",
};

const stageNoteOrder = ["applied", "interview_scheduled", "interview_completed", "employer_agreed", "closed", "note"];

const statusStageMap = {
  accepted: "note",
  applied_waiting: "applied",
  interview_scheduled: "interview_scheduled",
  interview_completed: "interview_completed",
  employer_agreed: "employer_agreed",
  closed: "closed",
};

const workplaceTypeLabels = {
  remote: "Remote",
  hybrid: "Hybrid",
  on_site: "On-site",
  unknown: "Unknown",
};

const workplaceTypeOrder = ["remote", "hybrid", "on_site", "unknown"];

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
    for (const paragraph of plainDescriptionParagraphs(plain)) {
      body.append(createEl("p", null, paragraph));
    }
  } else {
    body.textContent = "No description";
  }
  return body;
}

function plainDescriptionParagraphs(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((part) => part.replace(/\s+/g, " ").replace(/([.!?])(?=[A-ZÄÖÜ])/g, "$1 ").trim())
    .filter(Boolean);
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
    await loadBatchMetadata();
    const initialBatch = chooseInitialBatch(state.batches, state.date);
    if (initialBatch) setActiveBatch(initialBatch, { resetFilters: false });
    await loadState();
  }
}

async function loadBatchMetadata() {
  const response = await fetch("/api/batches");
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to load batches");
  const payload = await response.json();
  state.batches = payload.batches ?? [];
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

function batchOptionLabel(batch) {
  return `${batch.date} (${batch.selectedCount}/${batch.totalCount})`;
}

function chooseInitialBatch(batches, requestedDate) {
  if (!batches.length) return null;
  if (requestedDate) {
    const requested = batches.find((batch) => batch.date === requestedDate);
    if (requested) return requested;
  }
  return [...batches].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
}

function setActiveBatch(batch, options = {}) {
  state.date = batch.date;
  state.canonicalFile = batch.canonicalFile;
  state.selectedFile = batch.selectedFile;
  if (options.resetFilters) {
    state.activeTab = "selected";
    state.reviewCities = [];
    state.reviewStates = [];
    state.reviewCompanies = [];
    state.reviewWorkplaceTypes = [];
  }
}

function syncReviewBatchUrl() {
  const query = new URLSearchParams();
  if (state.view !== "review") query.set("view", state.view);
  if (state.date) query.set("batch", state.date);
  const next = query.toString();
  history.pushState(null, "", next ? `/?${next}` : "/");
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to load dashboard");
  state.dashboard = await response.json();
  reconcileDashboardFilters();
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
  if (shouldReloadReviewAfterDecision(payload.decision)) {
    await loadState();
  } else {
    updateCardStatus(id);
  }
}

function shouldReloadReviewAfterDecision(decision) {
  return decision === "accept" || decision === "reject";
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

async function saveApplicationStage(jobKey, type) {
  const payload = {
    jobKey,
    type,
    date: new Date().toISOString().slice(0, 10),
    note: "",
    nextActionAt: null,
  };

  const response = await fetch("/api/applications/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to save stage");
  state.dashboardAction = null;
  if (typeof document.querySelector === "function") await loadDashboard();
}

async function saveApplicationCloseOutcome(jobKey, outcome) {
  const type = closeOutcomeEventTypes[outcome];
  if (!type) throw new Error(`Unknown close outcome: ${outcome}`);
  const payload = {
    jobKey,
    type,
    date: new Date().toISOString().slice(0, 10),
    note: "",
    nextActionAt: null,
  };

  const response = await fetch("/api/applications/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to save close outcome");
  state.dashboardAction = null;
  if (typeof document.querySelector === "function") await loadDashboard();
}

async function saveApplicationNote(jobKey, note) {
  const payload = {
    jobKey,
    type: "note",
    date: new Date().toISOString().slice(0, 10),
    note: String(note ?? "").trim(),
    nextActionAt: null,
  };
  if (!payload.note) return;

  const response = await fetch("/api/applications/event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to save note");
  state.dashboardAction = null;
  if (typeof document.querySelector === "function") await loadDashboard();
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

async function postDashboardDelete(jobKey) {
  const response = await fetch("/api/applications/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobKey }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to delete application");
  return response.json();
}

async function deleteDashboardJob(jobKey) {
  state.dashboardAction = { jobKey, type: "delete" };
  renderDashboard();
  await postDashboardDelete(jobKey);
  state.dashboardAction = null;
  if (typeof document.querySelector === "function") await loadDashboard();
}

async function postManualLinkedinImport(url) {
  const response = await fetch("/api/applications/import-linkedin-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: String(url ?? "").trim() }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to import LinkedIn job");
  return response.json();
}

async function postManualJobImport(url) {
  const response = await fetch("/api/applications/import-job-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: String(url ?? "").trim() }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to import job");
  return response.json();
}

function manualEntryInitialForm() {
  return {
    title: "",
    descriptionText: "",
    companyName: "",
    location: "",
    workplaceType: "unknown",
  };
}

function manualEntryPayloadFromFormData(data) {
  const workplaceType = String(data.get("workplaceType") ?? "").trim();
  return {
    title: String(data.get("title") ?? "").trim(),
    descriptionText: String(data.get("descriptionText") ?? "").trim(),
    companyName: String(data.get("companyName") ?? "").trim(),
    location: String(data.get("location") ?? "").trim(),
    workplaceType: workplaceType || "unknown",
  };
}

async function postManualEntryImport(payload) {
  const response = await fetch("/api/applications/import-manual-job", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: String(payload.title ?? "").trim(),
      descriptionText: String(payload.descriptionText ?? "").trim(),
      companyName: String(payload.companyName ?? "").trim(),
      location: String(payload.location ?? "").trim(),
      workplaceType: String(payload.workplaceType ?? "unknown").trim() || "unknown",
    }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to import manual job");
  return response.json();
}

async function postManualEntryParse(descriptionText) {
  const response = await fetch("/api/applications/parse-manual-job", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      descriptionText: String(descriptionText ?? "").trim(),
    }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to parse manual job");
  return response.json();
}

function manualLinkedinImportStatusText(result) {
  return String(result?.imported?.message ?? result?.message ?? "").trim() || "Imported";
}

async function saveManualLinkedinImport(form) {
  if (state.dashboardImportRunning) return;
  const data = new FormData(form);
  const url = String(data.get("url") ?? "").trim();
  if (!url) return;
  state.dashboardImportRunning = true;
  state.dashboardImportStatus = "Importing...";
  renderDashboard();
  try {
    const result = await postManualJobImport(url);
    state.dashboardImportUrl = "";
    state.dashboardImportStatus = manualLinkedinImportStatusText(result);
    await loadDashboard();
  } finally {
    state.dashboardImportRunning = false;
    renderDashboard();
  }
}

async function saveManualEntryImport(form) {
  if (state.dashboardManualEntryRunning) return;
  const payload = manualEntryPayloadFromFormData(new FormData(form));
  state.dashboardManualEntry = payload;
  state.dashboardManualEntryRunning = true;
  state.dashboardManualEntryStatus = "Adding...";
  renderDashboard();
  try {
    const result = await postManualEntryImport(payload);
    state.dashboardManualEntry = manualEntryInitialForm();
    state.dashboardManualEntryOpen = false;
    state.dashboardManualEntryStatus = manualLinkedinImportStatusText(result);
    await loadDashboard();
  } finally {
    state.dashboardManualEntryRunning = false;
    renderDashboard();
  }
}

async function parseManualEntry(form) {
  if (state.dashboardManualEntryParsing) return;
  const payload = manualEntryPayloadFromFormData(new FormData(form));
  if (!payload.descriptionText) return;
  state.dashboardManualEntry = payload;
  state.dashboardManualEntryOpen = true;
  state.dashboardManualEntryParsing = true;
  state.dashboardManualEntryStatus = "Parsing...";
  renderDashboard();
  try {
    const result = await postManualEntryParse(payload.descriptionText);
    state.dashboardManualEntry = {
      ...state.dashboardManualEntry,
      ...(result.parsed ?? {}),
      descriptionText: result.parsed?.descriptionText ?? payload.descriptionText,
      workplaceType: result.parsed?.workplaceType ?? state.dashboardManualEntry.workplaceType ?? "unknown",
    };
    state.dashboardManualEntryStatus = "Parsed";
  } finally {
    state.dashboardManualEntryParsing = false;
    renderDashboard();
  }
}

async function saveApplicationDetails(jobKey, form) {
  const data = new FormData(form);
  const payload = {
    jobKey,
    statusUrl: data.get("statusUrl") ?? "",
  };

  const response = await fetch("/api/applications/details", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to save application details");
  await loadDashboard();
}

function dashboardDescriptionText(job) {
  return String(job.description?.text ?? job.descriptionText ?? "");
}

async function postDashboardDescription(jobKey, descriptionText) {
  const response = await fetch("/api/applications/description", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobKey,
      descriptionText: String(descriptionText ?? "").trim(),
    }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to save description");
  return response.json();
}

async function saveDashboardDescription(jobKey, form) {
  const data = new FormData(form);
  await postDashboardDescription(jobKey, data.get("descriptionText") ?? "");
  state.dashboardDescriptionEditJobKey = null;
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
  const app = renderShell("Job Review");
  const selector = renderBatchSelector();
  if (selector) app.querySelector(".page-header").insertBefore(selector, app.querySelector("h1"));
  const summary = createEl("p", "summary", `${state.data.counts.selected} selected · ${state.data.counts.rejected} rejected · ${state.data.counts.deleted} deleted · ${state.data.counts.annotations} annotated`);
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

function renderBatchSelector() {
  if (!state.batches.length) return null;
  const wrap = createEl("label", "batch-selector");
  wrap.append(createEl("span", null, "Batch"));
  const select = document.createElement("select");
  select.value = state.date ?? "";
  for (const batch of state.batches) {
    const option = document.createElement("option");
    option.value = batch.date;
    option.textContent = batchOptionLabel(batch);
    option.selected = batch.date === state.date;
    select.append(option);
  }
  select.addEventListener("change", async () => {
    const batch = state.batches.find((candidate) => candidate.date === select.value);
    if (!batch) return;
    setActiveBatch(batch, { resetFilters: true });
    syncReviewBatchUrl();
    await loadState().catch(showError);
  });
  wrap.append(select);
  return wrap;
}

function renderPostedDaysFilter() {
  const wrap = createEl("div", "posted-days-filter");
  const select = document.createElement("select");
  for (const { value, label } of [
    { value: "", label: "Any time" },
    { value: "1", label: "Last 1 day" },
    { value: "3", label: "Last 3 days" },
    { value: "7", label: "Last 1 week" },
    { value: "14", label: "Last 2 weeks" },
    { value: "30", label: "Last 1 month" },
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = String(state.reviewPostedMaxDays ?? "") === value;
    select.append(opt);
  }
  select.addEventListener("change", () => {
    state.reviewPostedMaxDays = select.value ? Number(select.value) : null;
    renderReview();
  });
  wrap.append(select);
  return wrap;
}

function renderReviewToolbar(baseItems, visibleCount) {
  const toolbar = createEl("section", "review-toolbar");
  const filtersEl = renderJobFilters({
    items: baseItems,
    cityValues: state.reviewCities,
    stateValues: state.reviewStates,
    companyValues: state.reviewCompanies,
    workplaceTypeValues: state.reviewWorkplaceTypes,
    prefix: "review",
    onChange: (kind, values) => {
      if (kind === "city") state.reviewCities = values;
      else if (kind === "state") state.reviewStates = values;
      else if (kind === "company") state.reviewCompanies = values;
      else state.reviewWorkplaceTypes = values;
      reconcileReviewFilters(kind);
      renderReview();
    },
  });
  filtersEl.append(renderPostedDaysFilter());
  toolbar.append(filtersEl);
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

function jobFilterOptions(items, filters = {}, options = {}) {
  const cities = new Map();
  const states = new Map();
  const companies = new Map();
  const workplaceTypes = new Map();
  const postedDates = new Map();
  for (const item of items) {
    const job = item.job ?? item;
    const location = locationParts(job.location?.raw ?? job.location);
    const companyName = job.company?.name ?? job.companyName;
    const workplaceType = normalizeWorkplaceType(job.location?.workplaceType ?? job.workplaceType);
    const postedDate = postedDateOption(job);
    if (location.city && jobFilterMatches(job, location, [], filters.stateValues ?? [], filters.companyValues ?? [], filters.workplaceTypeValues ?? [], filters.postedDateValues ?? [])) {
      cities.set(normalizeOption(location.city), location.city);
    }
    if (location.state && jobFilterMatches(job, location, filters.cityValues ?? [], [], filters.companyValues ?? [], filters.workplaceTypeValues ?? [], filters.postedDateValues ?? [])) {
      states.set(normalizeOption(location.state), location.state);
    }
    if (companyName && jobFilterMatches(job, location, filters.cityValues ?? [], filters.stateValues ?? [], [], filters.workplaceTypeValues ?? [], filters.postedDateValues ?? [])) {
      companies.set(normalizeOption(companyName), companyName);
    }
    if (jobFilterMatches(job, location, filters.cityValues ?? [], filters.stateValues ?? [], filters.companyValues ?? [], [], filters.postedDateValues ?? [])) {
      workplaceTypes.set(workplaceType, workplaceTypeLabels[workplaceType]);
    }
    if (options.includePostedDates && postedDate && jobFilterMatches(job, location, filters.cityValues ?? [], filters.stateValues ?? [], filters.companyValues ?? [], filters.workplaceTypeValues ?? [], [])) {
      postedDates.set(postedDate, postedDate);
    }
  }
  const result = {
    city: [...cities].map(([value, label]) => ({ value, label })).sort(optionSort),
    state: [...states].map(([value, label]) => ({ value, label })).sort(optionSort),
    company: [...companies].map(([value, label]) => ({ value, label })).sort(optionSort),
    workplaceType: [...workplaceTypes].map(([value, label]) => ({ value, label })).sort(workplaceTypeSort),
  };
  if (options.includePostedDates) {
    result.postedDate = [...postedDates]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => b.value.localeCompare(a.value));
  }
  return result;
}

function normalizeOption(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeWorkplaceType(value) {
  const normalized = normalizeOption(value).replaceAll("-", "_").replaceAll(" ", "_");
  return workplaceTypeLabels[normalized] ? normalized : "unknown";
}

function workplaceTypeLabel(job) {
  return workplaceTypeLabels[normalizeWorkplaceType(job.location?.workplaceType ?? job.workplaceType)] ?? workplaceTypeLabels.unknown;
}

function postedDateLabel(job) {
  const date = postedDateOption(job);
  return date ? `Posted: ${date}` : null;
}

function postedDateOption(job) {
  const raw = job.timing?.postedAt ?? job.postedAt?.raw ?? job.postedAt;
  if (!raw) return "";
  const value = String(raw);
  return /^\d{4}-\d{2}-\d{2}/.test(value)
    ? value.slice(0, 10)
    : Number.isNaN(Date.parse(value))
      ? value
      : new Date(value).toISOString().slice(0, 10);
}

function daysSincePosted(job) {
  const date = postedDateOption(job);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const posted = new Date(date);
  posted.setHours(0, 0, 0, 0);
  return Math.floor((today - posted) / 86400000);
}

function jobMetaParts(job) {
  return [
    job.company?.name ?? job.companyName,
    job.location?.raw ?? job.location,
    workplaceTypeLabel(job),
    postedDateLabel(job),
    job.source,
  ].filter(Boolean);
}

function optionSort(a, b) {
  return a.label.localeCompare(b.label);
}

function workplaceTypeSort(a, b) {
  return workplaceTypeOrder.indexOf(a.value) - workplaceTypeOrder.indexOf(b.value);
}

function renderJobFilters({ items, cityValues, stateValues, companyValues, workplaceTypeValues, postedDateValues = [], prefix, onChange, includePostedDates = false }) {
  const wrap = createEl("div", "job-filters");
  const options = jobFilterOptions(items, { cityValues, stateValues, companyValues, workplaceTypeValues, postedDateValues }, { includePostedDates });
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
    renderMultiSelectFilter({
      key: `${prefix}-workplace-type`,
      label: "Work mode",
      options: options.workplaceType,
      selected: workplaceTypeValues,
      onChange: (values) => onChange("workplaceType", values),
    }),
  );
  if (includePostedDates) {
    wrap.append(renderMultiSelectFilter({
      key: `${prefix}-posted-date`,
      label: "Posted",
      options: options.postedDate,
      selected: postedDateValues,
      onChange: (values) => onChange("postedDate", values),
    }));
  }
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
    if (!jobFilterMatches(job, parts, state.reviewCities, state.reviewStates, state.reviewCompanies, state.reviewWorkplaceTypes)) return false;
    if (state.reviewPostedMaxDays != null) {
      const days = daysSincePosted(job);
      if (days == null || days > state.reviewPostedMaxDays) return false;
    }
    return true;
  });
}

function reconcileReviewFilters(changedKind) {
  const next = reconcileFilterValues(baseReviewItems(), {
    cityValues: state.reviewCities,
    stateValues: state.reviewStates,
    companyValues: state.reviewCompanies,
    workplaceTypeValues: state.reviewWorkplaceTypes,
  }, changedKind);
  state.reviewCities = next.cityValues;
  state.reviewStates = next.stateValues;
  state.reviewCompanies = next.companyValues;
  state.reviewWorkplaceTypes = next.workplaceTypeValues;
}

function reconcileDashboardFilters(changedKind) {
  const next = reconcileFilterValues(dashboardBaseItems(), {
    cityValues: state.dashboardCities,
    stateValues: state.dashboardStates,
    companyValues: state.dashboardCompanies,
    workplaceTypeValues: state.dashboardWorkplaceTypes,
    postedDateValues: state.dashboardPostedDates,
  }, changedKind);
  state.dashboardCities = next.cityValues;
  state.dashboardStates = next.stateValues;
  state.dashboardCompanies = next.companyValues;
  state.dashboardWorkplaceTypes = next.workplaceTypeValues;
  state.dashboardPostedDates = next.postedDateValues;
}

function reconcileFilterValues(items, filters, changedKind) {
  const next = {
    cityValues: [...filters.cityValues],
    stateValues: [...filters.stateValues],
    companyValues: [...filters.companyValues],
    workplaceTypeValues: [...filters.workplaceTypeValues],
    postedDateValues: [...(filters.postedDateValues ?? [])],
  };
  const kinds = [
    ["city", "cityValues", "city"],
    ["state", "stateValues", "state"],
    ["company", "companyValues", "company"],
    ["workplaceType", "workplaceTypeValues", "workplaceType"],
  ];
  if (filters.postedDateValues) kinds.push(["postedDate", "postedDateValues", "postedDate"]);

  for (const [kind, valuesKey, optionsKey] of kinds) {
    if (kind === changedKind) continue;
    const options = jobFilterOptions(items, next);
    const allowed = new Set((options[optionsKey] ?? []).map((option) => option.value));
    next[valuesKey] = next[valuesKey].filter((value) => allowed.has(value));
  }

  return next;
}

function jobFilterMatches(job, parts, cities, states, companies, workplaceTypes = [], postedDates = []) {
  const city = normalizeOption(parts.city);
  const region = normalizeOption(parts.state);
  const company = normalizeOption(job.company?.name ?? job.companyName);
  const workplaceType = normalizeWorkplaceType(job.location?.workplaceType ?? job.workplaceType);
  const postedDate = postedDateOption(job);
  return (!cities.length || cities.includes(city))
    && (!states.length || states.includes(region))
    && (!companies.length || companies.includes(company))
    && (!workplaceTypes.length || workplaceTypes.includes(workplaceType))
    && (!postedDates.length || postedDates.includes(postedDate));
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
  const imports = createEl("section", "manual-imports");
  imports.append(renderManualLinkedinImportForm(), renderManualEntryForm());
  app.append(imports);

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
    workplaceTypeValues: state.dashboardWorkplaceTypes,
    postedDateValues: state.dashboardPostedDates,
    prefix: "dashboard",
    includePostedDates: true,
    onChange: (kind, values) => {
      if (kind === "city") state.dashboardCities = values;
      else if (kind === "state") state.dashboardStates = values;
      else if (kind === "company") state.dashboardCompanies = values;
      else if (kind === "workplaceType") state.dashboardWorkplaceTypes = values;
      else state.dashboardPostedDates = values;
      reconcileDashboardFilters(kind);
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

function renderManualLinkedinImportForm() {
  const form = createEl("form", "manual-import-form");
  const label = createEl("label");
  label.append(createEl("span", null, "Add JD"));
  const input = document.createElement("input");
  input.name = "url";
  input.type = "url";
  input.placeholder = "LinkedIn or Stepstone job URL";
  input.value = state.dashboardImportUrl;
  input.disabled = state.dashboardImportRunning;
  input.addEventListener("input", () => {
    state.dashboardImportUrl = input.value;
  });
  label.append(input);
  const button = createEl("button", null, state.dashboardImportRunning ? "Adding..." : "Add");
  button.type = "submit";
  button.disabled = state.dashboardImportRunning;
  form.append(label, button);
  if (state.dashboardImportStatus) {
    form.append(createEl("span", "manual-import-status", state.dashboardImportStatus));
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveManualLinkedinImport(form).catch((error) => {
      state.dashboardImportRunning = false;
      state.dashboardImportStatus = "";
      renderDashboard();
      showError(error);
    });
  });
  return form;
}

function renderManualEntryForm() {
  const panel = createEl("details", "manual-entry-panel");
  panel.open = state.dashboardManualEntryOpen;
  const summary = createEl("summary", null, "Manual JD");
  summary.addEventListener("click", () => {
    state.dashboardManualEntryOpen = !panel.open;
  });
  panel.append(summary);
  const form = createEl("form", "manual-entry-form");
  const title = renderManualTextField("title", "Title", "Master thesis / Working student role", state.dashboardManualEntry.title, true);
  const company = renderManualTextField("companyName", "Company", "Company name", state.dashboardManualEntry.companyName, true);
  const location = renderManualTextField("location", "Location", "Berlin, Germany", state.dashboardManualEntry.location, false);
  const mode = createEl("label");
  mode.append(createEl("span", null, "Work mode"));
  const select = document.createElement("select");
  select.name = "workplaceType";
  select.disabled = state.dashboardManualEntryRunning || state.dashboardManualEntryParsing;
  for (const [value, label] of [
    ["unknown", "Unknown"],
    ["remote", "Remote"],
    ["hybrid", "Hybrid"],
    ["on_site", "On-site"],
  ]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = state.dashboardManualEntry.workplaceType === value;
    select.append(option);
  }
  select.addEventListener("change", () => {
    state.dashboardManualEntry.workplaceType = select.value;
  });
  mode.append(select);

  const description = createEl("label", "wide");
  description.append(createEl("span", null, "Job description"));
  const textarea = document.createElement("textarea");
  textarea.name = "descriptionText";
  textarea.placeholder = "Paste the job description, then use AI Parse or fill the fields manually...";
  textarea.required = true;
  textarea.value = state.dashboardManualEntry.descriptionText;
  textarea.disabled = state.dashboardManualEntryRunning || state.dashboardManualEntryParsing;
  textarea.addEventListener("input", () => {
    state.dashboardManualEntry.descriptionText = textarea.value;
  });
  description.append(textarea);

  const actions = createEl("div", "form-actions wide");
  const parse = createEl("button", null, state.dashboardManualEntryParsing ? "Parsing..." : "AI Parse");
  parse.type = "button";
  parse.disabled = state.dashboardManualEntryParsing || state.dashboardManualEntryRunning;
  parse.addEventListener("click", () => parseManualEntry(form).catch((error) => {
    state.dashboardManualEntryParsing = false;
    state.dashboardManualEntryStatus = "";
    renderDashboard();
    showError(error);
  }));
  const save = createEl("button", null, state.dashboardManualEntryRunning ? "Saving..." : "Save");
  save.type = "submit";
  save.disabled = state.dashboardManualEntryRunning || state.dashboardManualEntryParsing;
  actions.append(parse, save);
  if (state.dashboardManualEntryStatus) {
    actions.append(createEl("span", "manual-import-status", state.dashboardManualEntryStatus));
  }

  form.append(title, company, location, mode, description, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveManualEntryImport(form).catch((error) => {
      state.dashboardManualEntryRunning = false;
      state.dashboardManualEntryStatus = "";
      renderDashboard();
      showError(error);
    });
  });
  panel.append(form);
  return panel;
}

function renderManualTextField(name, labelText, placeholder, value, required) {
  const label = createEl("label");
  label.append(createEl("span", null, labelText));
  const input = document.createElement("input");
  input.name = name;
  input.type = "text";
  input.placeholder = placeholder;
  input.value = value ?? "";
  input.required = required;
  input.disabled = state.dashboardManualEntryRunning || state.dashboardManualEntryParsing;
  input.addEventListener("input", () => {
    state.dashboardManualEntry[name] = input.value;
  });
  label.append(input);
  return label;
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
    return jobFilterMatches(job, parts, state.dashboardCities, state.dashboardStates, state.dashboardCompanies, state.dashboardWorkplaceTypes, state.dashboardPostedDates);
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
  titleBlock.append(createEl("p", "meta", jobMetaParts(job).join(" · ")));
  titleRow.append(titleBlock);
  if (state.activeTab !== "deleted") {
    titleRow.append(renderDecisionControls(id, annotation.decision));
  }
  article.append(titleRow);

  const links = createEl("div", "links");
  const detailUrl = job.links?.detail ?? job.link;
  const applyUrl = job.links?.apply ?? job.applyUrl;
  if (detailUrl) links.append(renderLink("LinkedIn", detailUrl));
  if (applyUrl) links.append(renderLink("Apply", applyUrl));
  article.append(links);

  const selection = renderSelection(job);
  if (selection) article.append(selection);
  const deleted = renderDeletedRules(job);
  if (deleted) article.append(deleted);
  article.append(renderEnrichment(id, state.data?.enrichments));

  const description = createEl("details", "description");
  const summary = createEl("summary", null, "Description");
  description.append(summary, renderDescriptionBody(job));
  article.append(description);

  if (state.activeTab === "deleted") {
    article.append(createEl("p", "save-status", "Hard-rule deleted"));
    return article;
  }

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
  const visualStatus = dashboardVisualStatus(application, state.dashboardAction);
  titleBlock.append(createEl("h2", null, text(job.title, "Untitled")));
  titleBlock.append(createEl("p", "meta", jobMetaParts(job).join(" · ")));
  titleRow.append(titleBlock);
  titleRow.append(createEl("span", `status-pill status-${visualStatus.key}`, visualStatus.label));
  article.append(titleRow);

  const links = createEl("div", "links");
  for (const link of dashboardLinkModels(job, application)) {
    links.append(renderLink(link.label, link.href, { disabled: link.disabled }));
  }
  article.append(links);

  article.append(renderEnrichment(job.jobKey, state.dashboard?.enrichments));

  article.append(renderEditableDashboardDescription(job));

  article.append(renderApplicationDetailsForm(job.jobKey, application));
  article.append(renderApplicationActions(job.jobKey, application.currentStatus));
  if (state.dashboardAction?.jobKey === job.jobKey && state.dashboardAction.type === "reject") {
    article.append(renderActionForm(job.jobKey, state.dashboardAction.type));
  }
  if (state.dashboardAction?.jobKey === job.jobKey && state.dashboardAction.type === "closed") {
    article.append(renderCloseOutcomeActions(job.jobKey));
  }

  article.append(renderStageNotes(application.events ?? [], application.currentStatus, job.jobKey));
  return article;
}

function renderEditableDashboardDescription(job) {
  if (state.dashboardDescriptionEditJobKey === job.jobKey) {
    return renderDashboardDescriptionEditForm(job);
  }

  const description = createEl("details", "description");
  const summary = createEl("summary", "description-summary");
  summary.append(createEl("span", null, "Description"));
  const edit = createEl("button", "description-edit-button", "Edit");
  edit.type = "button";
  edit.addEventListener("click", (event) => {
    event.preventDefault();
    state.dashboardDescriptionEditJobKey = job.jobKey;
    renderDashboard();
  });
  summary.append(edit);
  description.append(summary, renderDescriptionBody(job));
  return description;
}

function renderDashboardDescriptionEditForm(job) {
  const form = createEl("form", "description description-edit-form");
  const label = createEl("label", null);
  label.append(createEl("span", null, "Description"));
  const textarea = document.createElement("textarea");
  textarea.name = "descriptionText";
  textarea.value = dashboardDescriptionText(job);
  textarea.placeholder = "Paste or write the job description...";
  label.append(textarea);

  const actions = createEl("div", "description-edit-actions");
  const save = createEl("button", null, "Save");
  save.type = "submit";
  const cancel = createEl("button", null, "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    state.dashboardDescriptionEditJobKey = null;
    renderDashboard();
  });
  actions.append(save, cancel);
  form.append(label, actions);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveDashboardDescription(job.jobKey, form).catch(showError);
  });
  return form;
}

function dashboardVisualStatus(application, selectedAction = state.dashboardAction) {
  const selectedStatus = selectedAction?.jobKey === application.jobKey ? actionStatusMap[selectedAction.type] : null;
  const key = selectedStatus ?? application.currentStatus ?? "accepted";
  return {
    key,
    label: state.dashboard?.statuses?.[key] ?? statusFallbackLabels[key] ?? key,
  };
}

const statusFallbackLabels = {
  accepted: "Accepted",
  applied_waiting: "Applied, waiting for response",
  interview_scheduled: "Interview scheduled, preparing",
  interview_completed: "Interview completed, waiting for result",
  employer_agreed: "Employer agreed, waiting for contract",
  closed: "Closed / rejected / withdrawn",
};

function dashboardLinkModels(job, application) {
  const detailUrl = job.links?.detail ?? job.link;
  const applyUrl = job.links?.apply ?? job.applyUrl ?? "";
  return [
    { label: "JD", href: detailUrl ?? "", disabled: !detailUrl },
    { label: "Apply", href: applyUrl, disabled: !applyUrl },
    ...(application?.statusUrl ? [{ label: "Status", href: application.statusUrl, disabled: false }] : []),
  ];
}

function renderApplicationDetailsForm(jobKey, application) {
  const form = createEl("form", "application-details-form");
  const label = createEl("label", "status-url-field");
  label.append(createEl("span", null, "Application status URL"));
  const input = document.createElement("input");
  input.name = "statusUrl";
  input.type = "url";
  input.placeholder = "https://.../Bewerbungsübersicht";
  input.value = application.statusUrl ?? "";
  label.append(input);
  const save = createEl("button", null, "Save");
  save.type = "submit";
  form.append(label, save);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveApplicationDetails(jobKey, form).catch(showError);
  });
  return form;
}

function renderApplicationActions(jobKey, currentStatus) {
  const group = createEl("div", "application-actions");
  for (const { type, label, active } of applicationActionModels(jobKey, currentStatus, state.dashboardAction)) {
    const buttonClasses = ["action-button"];
    if (type === "delete") buttonClasses.push("danger");
    if (active) buttonClasses.push("active");
    const button = createEl("button", buttonClasses.join(" "), label);
    button.type = "button";
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.addEventListener("click", () => {
      if (type === "delete") {
        deleteDashboardJob(jobKey).catch((error) => {
          state.dashboardAction = null;
          renderDashboard();
          showError(error);
        });
      } else if (isImmediateDashboardStageAction(type)) {
        state.dashboardAction = { jobKey, type };
        renderDashboard();
        saveApplicationStage(jobKey, type).catch(showError);
      } else {
        state.dashboardAction = nextDashboardAction(state.dashboardAction, jobKey, type);
        renderDashboard();
      }
    });
    group.append(button);
  }
  return group;
}

function isImmediateDashboardStageAction(type) {
  return Boolean(actionStatusMap[type]) && type !== "closed";
}

function nextDashboardAction(currentAction, jobKey, type) {
  if (currentAction?.jobKey === jobKey && currentAction?.type === type) return null;
  return { jobKey, type };
}

function applicationActionModels(jobKey, currentStatus, selectedAction = state.dashboardAction) {
  const selectedType = selectedAction?.jobKey === jobKey ? selectedAction.type : null;
  return Object.entries(actionLabels)
    .filter(([type]) => type !== "note")
    .map(([type, label]) => {
      const mappedStatus = actionStatusMap[type];
      return {
        type,
        label,
        active: selectedType ? selectedType === type : Boolean(mappedStatus && mappedStatus === currentStatus),
      };
    });
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

function renderCloseOutcomeActions(jobKey) {
  const wrap = createEl("div", "close-outcome-actions");
  wrap.append(createEl("span", "close-outcome-label", "Close as"));
  const success = createEl("button", "close-outcome success", "Success");
  success.type = "button";
  success.addEventListener("click", () => {
    saveApplicationCloseOutcome(jobKey, "success").catch(showError);
  });
  const fail = createEl("button", "close-outcome fail", "Fail");
  fail.type = "button";
  fail.addEventListener("click", () => {
    saveApplicationCloseOutcome(jobKey, "fail").catch(showError);
  });
  const cancel = createEl("button", "close-outcome cancel", "Cancel");
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    state.dashboardAction = null;
    renderDashboard();
  });
  wrap.append(success, fail, cancel);
  return wrap;
}

function eventStageType(event, currentStatus) {
  if (event.stage) return event.stage;
  if (event.type === "note" && currentStatus) return statusStageMap[currentStatus] ?? "note";
  return event.type ?? "note";
}

function stageNoteGroups(events, currentStatus) {
  const byType = new Map();
  for (const event of events ?? []) {
    const type = eventStageType(event, currentStatus);
    if (!stageNoteOrder.includes(type)) continue;
    if (!event.note) continue;
    if (!byType.has(type)) {
      byType.set(type, {
        type,
        label: stageNoteLabels[type] ?? type.replaceAll("_", " "),
        notes: [],
      });
    }
    byType.get(type).notes.push({ date: event.date, note: event.note });
  }

  return [...byType.values()]
    .sort((a, b) => stageNoteSort(a.type, b.type))
    .map((group) => ({
      ...group,
      notes: group.notes.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))),
    }));
}

function stageNoteSummaryCount(events, currentStatus) {
  return stageNoteGroups(events, currentStatus).reduce((sum, group) => sum + group.notes.length, 0);
}

function visibleStageNoteGroups(events, currentStatus) {
  return stageNoteGroups(events, currentStatus).filter((group) => group.notes.length > 0);
}

function stageNoteSort(a, b) {
  const aIndex = stageNoteOrder.indexOf(a);
  const bIndex = stageNoteOrder.indexOf(b);
  if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
  if (aIndex >= 0) return -1;
  if (bIndex >= 0) return 1;
  return a.localeCompare(b);
}

function renderStageNotes(events, currentStatus, jobKey) {
  const section = createEl("details", "stage-notes");
  const noteFormActive = state.dashboardAction?.jobKey === jobKey && state.dashboardAction.type === "note";
  section.open = noteFormActive;
  const summary = createEl("summary", "stage-notes-summary");
  summary.append(createEl("span", null, `Stage notes (${stageNoteSummaryCount(events, currentStatus)})`));
  const addNote = createEl("button", "stage-note-add", "Add Note");
  addNote.type = "button";
  addNote.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.dashboardAction = nextDashboardAction(state.dashboardAction, jobKey, "note");
    renderDashboard();
  });
  summary.append(addNote);
  section.append(summary);

  if (noteFormActive) {
    section.append(renderStageNoteForm(jobKey));
  }

  const groupsList = createEl("div", "stage-note-groups");
  const groupedNotes = visibleStageNoteGroups(events, currentStatus);
  if (!groupedNotes.length) {
    groupsList.append(createEl("p", "empty", "No notes yet"));
    section.append(groupsList);
    return section;
  }
  for (const group of groupedNotes) {
    const details = createEl("details", "stage-note-group");
    details.append(createEl("summary", null, `${group.label} (${group.notes.length})`));
    const list = createEl("ol", "stage-note-list");
    for (const note of group.notes) {
      const item = createEl("li");
      item.append(createEl("span", "stage-note-date", note.date ?? ""));
      item.append(createEl("p", null, note.note));
      list.append(item);
    }
    details.append(list);
    groupsList.append(details);
  }
  section.append(groupsList);
  return section;
}

function renderStageNoteForm(jobKey) {
  const form = createEl("form", "stage-note-form");
  const label = createEl("label", "wide");
  label.append(createEl("span", null, "Note"));
  const note = document.createElement("textarea");
  note.name = "note";
  note.placeholder = "Add stage note...";
  note.required = true;
  label.append(note);

  const actions = createEl("div", "form-actions");
  const save = createEl("button", null, "Save");
  save.type = "submit";
  save.disabled = true;
  const cancel = createEl("button", null, "Cancel");
  cancel.type = "button";
  actions.append(save, cancel);
  form.append(label, actions);

  note.addEventListener("input", () => {
    save.disabled = !note.value.trim();
  });
  cancel.addEventListener("click", () => {
    state.dashboardAction = null;
    renderDashboard();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    saveApplicationNote(jobKey, note.value).catch(showError);
  });
  return form;
}

function renderLink(label, href, options = {}) {
  if (options.disabled) {
    const span = createEl("span", "link-button disabled", label);
    span.setAttribute("aria-disabled", "true");
    return span;
  }
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

function renderDeletedRules(job) {
  const rules = job._deleted?.rules ?? [];
  if (!rules.length) return null;
  const wrap = createEl("div", "selection deleted-rules");
  wrap.append(createEl("strong", null, "Deleted: "));
  wrap.append(document.createTextNode(rules.map((rule) => {
    if (rule.id === "posted_too_old") {
      return `posted before ${String(rule.cutoff ?? "").slice(0, 10)}`;
    }
    return rule.id;
  }).join(" | ")));
  return wrap;
}

function enrichmentDisplayText(e) {
  if (e?.failed) return { aufgaben: "AI 分析失败", techReqs: "AI 分析失败" };
  return {
    aufgaben: e?.aufgaben ?? "未接入AI",
    techReqs: e?.techReqs ?? "未接入AI",
  };
}

function renderEnrichment(id, enrichmentMap) {
  const e = enrichmentMap?.[id];
  const { aufgaben, techReqs } = enrichmentDisplayText(e);
  const wrap = createEl("div", "enrichment");
  const line1 = createEl("p", "enrichment-line");
  line1.append(createEl("strong", null, "Tasks: "), document.createTextNode(aufgaben));
  const line2 = createEl("p", "enrichment-line");
  line2.append(createEl("strong", null, "Tech: "), document.createTextNode(techReqs));
  wrap.append(line1, line2);
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
  state.date = next.get("batch") ?? next.get("date");
  state.canonicalFile = next.get("canonicalFile");
  state.selectedFile = next.get("selectedFile");
  loadApp().catch(showFatalError);
});

loadApp().catch(showFatalError);
