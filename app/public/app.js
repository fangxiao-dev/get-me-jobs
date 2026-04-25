const params = new URLSearchParams(window.location.search);
const state = {
  date: params.get("date"),
  source: params.get("source") ?? "linkedin",
  activeTab: "selected",
  data: null,
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

async function loadState() {
  const query = new URLSearchParams({ source: state.source });
  if (state.date) query.set("date", state.date);
  const response = await fetch(`/api/state?${query.toString()}`);
  if (!response.ok) throw new Error((await response.json()).error ?? "Failed to load state");
  state.data = await response.json();
  state.date = state.data.date;
  render();
}

async function saveAnnotation(id, patch) {
  const existing = state.data.annotations[id] ?? { id, decision: null, note: "", tags: [] };
  const payload = {
    date: state.date,
    source: state.source,
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
  updateCardStatus(id);
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

function render() {
  const app = document.querySelector("#app");
  app.textContent = "";

  const header = createEl("header", "page-header");
  header.append(createEl("div", "eyebrow", `${state.source} / ${state.date}`));
  header.append(createEl("h1", null, "Job Review"));
  header.append(createEl("p", "summary", `${state.data.counts.selected} selected · ${state.data.counts.rejected} rejected · ${state.data.counts.duplicateAccepted} accepted before · ${state.data.counts.annotations} annotated`));
  header.append(createEl("div", "error-banner"));
  app.append(header);

  const tabList = createEl("nav", "tabs");
  for (const [key, label] of tabs) {
    const button = createEl("button", key === state.activeTab ? "tab active" : "tab", `${label} (${state.data.counts[key]})`);
    button.type = "button";
    button.addEventListener("click", () => {
      state.activeTab = key;
      render();
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

function renderJobCard(job) {
  const id = jobId(job);
  const annotation = state.data.annotations[id] ?? {};
  const article = createEl("article", "job-card");
  article.dataset.jobId = id;

  const titleRow = createEl("div", "job-title-row");
  const titleBlock = createEl("div");
  titleBlock.append(createEl("h2", null, text(job.title, "Untitled")));
  titleBlock.append(createEl("p", "meta", [job.companyName, job.location, job.postedAt].filter(Boolean).join(" · ")));
  const badges = renderReviewBadges(job);
  if (badges) titleBlock.append(badges);
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

function renderReviewBadges(job) {
  if (!job._reviewMeta?.duplicateAccepted) return null;
  const wrap = createEl("div", "badges");
  wrap.append(createEl("span", "badge", "Accepted before"));
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

loadState().catch((error) => {
  document.querySelector("#app").textContent = error.message ?? String(error);
});
