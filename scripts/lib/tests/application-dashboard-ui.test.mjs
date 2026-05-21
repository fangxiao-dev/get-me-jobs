import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

async function loadDashboardUiFunctions() {
  const source = readFileSync("app/public/app.js", "utf8");
  const startupIndex = source.indexOf("window.addEventListener");
  const testSource = `${source.slice(0, startupIndex)}
  globalThis.__dashboardUi = {
  tabs,
  state,
  enrichmentDisplayText,
  effectiveAnnotation,
  postManualJobImport,
  postManualEntryImport,
  postManualLinkedinImport,
  postDashboardDelete,
  postDashboardDescription,
  shouldReloadReviewAfterDecision,
  stageNoteGroups,
  visibleStageNoteGroups,
  stageNoteSummaryCount,
  manualLinkedinImportStatusText,
  manualEntryInitialForm,
  manualEntryPayloadFromFormData,
  plainDescriptionParagraphs,
  dashboardLinkModels,
  dashboardVisualStatus,
  applicationActionModels,
  isImmediateDashboardStageAction,
  saveApplicationStage,
  saveApplicationNote,
  saveApplicationCloseOutcome,
  nextDashboardAction,
};`;
  const fetchCalls = [];
  const context = {
    globalThis: {},
    window: { location: { search: "" } },
    URLSearchParams,
    document: {},
    DOMParser: class {},
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    CSS: { escape: (value) => String(value) },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return { ok: true, json: async () => ({ ok: true }) };
    },
};
  const vm = await import("node:vm");
  vm.runInNewContext(testSource, context);
  context.globalThis.__dashboardUi.fetchCalls = fetchCalls;
  return context.globalThis.__dashboardUi;
}

test("stage notes are grouped newest-first under each application stage", async () => {
  const { stageNoteGroups } = await loadDashboardUiFunctions();
  const groups = stageNoteGroups([
    { type: "applied", date: "2026-04-20", note: "submitted through Workday" },
    { type: "interview_scheduled", date: "2026-04-22", note: "phone screen booked" },
    { type: "applied", date: "2026-04-21", note: "confirmation email received" },
    { type: "closed", date: "2026-04-25", note: "" },
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(groups)), [
    {
      type: "applied",
      label: "Applied",
      notes: [
        { date: "2026-04-21", note: "confirmation email received" },
        { date: "2026-04-20", note: "submitted through Workday" },
      ],
    },
    {
      type: "interview_scheduled",
      label: "Interview scheduled",
      notes: [{ date: "2026-04-22", note: "phone screen booked" }],
    },
  ]);
});

test("manual LinkedIn import posts URL to the dashboard import API", async () => {
  const { postManualLinkedinImport, fetchCalls } = await loadDashboardUiFunctions();

  await postManualLinkedinImport(" https://www.linkedin.com/jobs/view/4343336011/?trk=test ");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/api/applications/import-linkedin-url");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.equal(fetchCalls[0].options.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    url: "https://www.linkedin.com/jobs/view/4343336011/?trk=test",
  });
});

test("manual job import posts Stepstone URL to the generic dashboard import API", async () => {
  const { postManualJobImport, fetchCalls } = await loadDashboardUiFunctions();

  await postManualJobImport(" https://www.stepstone.de/stellenangebote--Embedded-Test--13904121-inline.html?rltr=1 ");

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/api/applications/import-job-url");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    url: "https://www.stepstone.de/stellenangebote--Embedded-Test--13904121-inline.html?rltr=1",
  });
});

test("manual entry import posts trimmed payload to the manual dashboard import API", async () => {
  const { postManualEntryImport, fetchCalls } = await loadDashboardUiFunctions();

  await postManualEntryImport({
    title: " AI thesis ",
    descriptionText: " Build retrieval workflow. ",
    companyName: " Acme GmbH ",
    location: " Berlin ",
    workplaceType: "hybrid",
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/api/applications/import-manual-job");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    title: "AI thesis",
    descriptionText: "Build retrieval workflow.",
    companyName: "Acme GmbH",
    location: "Berlin",
    workplaceType: "hybrid",
  });
});

test("manual entry UI no longer exposes separate AI parse flow", () => {
  const source = readFileSync("app/public/app.js", "utf8");

  assert.equal(source.includes("/api/applications/parse-manual-job"), false);
  assert.equal(source.includes("postManualEntryParse"), false);
  assert.equal(source.includes("parseManualEntry"), false);
  assert.equal(source.includes("AI Parse"), false);
});

test("manual entry form data defaults unknown work mode", async () => {
  const { manualEntryInitialForm, manualEntryPayloadFromFormData } = await loadDashboardUiFunctions();
  const form = manualEntryInitialForm();
  const data = new FormData();
  data.set("title", "AI thesis");
  data.set("descriptionText", "Build retrieval workflow.");
  data.set("companyName", "Acme GmbH");
  data.set("location", "");
  data.set("workplaceType", "");

  assert.deepEqual(JSON.parse(JSON.stringify(form)), {
    title: "",
    descriptionText: "",
    companyName: "",
    location: "",
    workplaceType: "unknown",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(manualEntryPayloadFromFormData(data))), {
    title: "AI thesis",
    descriptionText: "Build retrieval workflow.",
    companyName: "Acme GmbH",
    location: "",
    workplaceType: "unknown",
  });
});

test("failed enrichment displays AI failure text", async () => {
  const { enrichmentDisplayText } = await loadDashboardUiFunctions();

  assert.deepEqual(JSON.parse(JSON.stringify(enrichmentDisplayText({ failed: true, reason: "codex_error" }))), {
    aufgaben: "AI 分析失败",
    techReqs: "AI 分析失败",
  });
});

test("manual LinkedIn import status uses API dedupe message", async () => {
  const { manualLinkedinImportStatusText } = await loadDashboardUiFunctions();

  assert.equal(
    manualLinkedinImportStatusText({
      deduped: true,
      message: "Already existed, deduplicated and updated existing application.",
    }),
    "Already existed, deduplicated and updated existing application.",
  );
  assert.equal(manualLinkedinImportStatusText({}), "Imported");
});

test("manual import status reads nested generic import API messages", async () => {
  const { manualLinkedinImportStatusText } = await loadDashboardUiFunctions();

  assert.equal(
    manualLinkedinImportStatusText({
      imported: {
        message: "Added Stepstone job to Accepted.",
      },
    }),
    "Added Stepstone job to Accepted.",
  );
});

test("plain descriptions preserve paragraph breaks for dashboard and review cards", async () => {
  const { plainDescriptionParagraphs } = await loadDashboardUiFunctions();

  assert.deepEqual(JSON.parse(JSON.stringify(plainDescriptionParagraphs(
    "Intro paragraph.\n\nYour Team\n\nFirst item.Second item.\n\nDuration \n\nSix months.",
  ))), [
    "Intro paragraph.",
    "Your Team",
    "First item. Second item.",
    "Duration",
    "Six months.",
  ]);
});

test("dashboard link model keeps JD and Apply actions visible", async () => {
  const { dashboardLinkModels } = await loadDashboardUiFunctions();

  assert.deepEqual(JSON.parse(JSON.stringify(dashboardLinkModels({
    link: "https://www.linkedin.com/jobs/view/1/",
    applyUrl: "",
  }, { statusUrl: "https://portal.example/status" }))), [
    { label: "JD", href: "https://www.linkedin.com/jobs/view/1/", disabled: false },
    { label: "Apply", href: "", disabled: true },
    { label: "Status", href: "https://portal.example/status", disabled: false },
  ]);
});

test("dashboard action models expose one mutually exclusive active stage", async () => {
  const { dashboardVisualStatus, applicationActionModels } = await loadDashboardUiFunctions();
  const selectedAction = { jobKey: "linkedin:1", type: "applied" };

  assert.deepEqual(JSON.parse(JSON.stringify(dashboardVisualStatus({
    jobKey: "linkedin:1",
    currentStatus: "accepted",
  }, selectedAction))), {
    key: "applied_waiting",
    label: "Applied, waiting for response",
  });

  const models = applicationActionModels("linkedin:1", "accepted", selectedAction);
  assert.equal(models.filter((model) => model.active).length, 1);
  assert.equal(models.find((model) => model.type === "applied").active, true);
  assert.equal(models.find((model) => model.type === "interview_scheduled").active, false);
});

test("dashboard stage buttons persist stage immediately", async () => {
  const { saveApplicationStage, fetchCalls } = await loadDashboardUiFunctions();

  await saveApplicationStage("linkedin:1", "applied");

  assert.equal(fetchCalls[0].url, "/api/applications/event");
  assert.equal(fetchCalls[0].options.method, "POST");
  const payload = JSON.parse(fetchCalls[0].options.body);
  assert.equal(payload.jobKey, "linkedin:1");
  assert.equal(payload.type, "applied");
  assert.match(payload.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(payload.note, "");
  assert.equal(payload.nextActionAt, null);
});

test("dashboard delete posts only the job key to the delete API", async () => {
  const { postDashboardDelete, fetchCalls } = await loadDashboardUiFunctions();

  await postDashboardDelete("linkedin:1");

  assert.equal(fetchCalls[0].url, "/api/applications/delete");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    jobKey: "linkedin:1",
  });
});

test("dashboard description save posts trimmed text to the description API", async () => {
  const { postDashboardDescription, fetchCalls } = await loadDashboardUiFunctions();

  await postDashboardDescription("linkedin:1", "  First paragraph.\n\nSecond paragraph.  ");

  assert.equal(fetchCalls[0].url, "/api/applications/description");
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    jobKey: "linkedin:1",
    descriptionText: "First paragraph.\n\nSecond paragraph.",
  });
});

test("dashboard description save allows empty text", async () => {
  const { postDashboardDescription, fetchCalls } = await loadDashboardUiFunctions();

  await postDashboardDescription("linkedin:1", "   ");

  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    jobKey: "linkedin:1",
    descriptionText: "",
  });
});

test("close is an expandable action, not an immediately persisted stage", async () => {
  const { isImmediateDashboardStageAction } = await loadDashboardUiFunctions();

  assert.equal(isImmediateDashboardStageAction("applied"), true);
  assert.equal(isImmediateDashboardStageAction("interview_scheduled"), true);
  assert.equal(isImmediateDashboardStageAction("closed"), false);
});

test("close success persists a contract signed event", async () => {
  const { saveApplicationCloseOutcome, fetchCalls } = await loadDashboardUiFunctions();

  await saveApplicationCloseOutcome("linkedin:1", "success");

  assert.equal(fetchCalls[0].url, "/api/applications/event");
  assert.equal(fetchCalls[0].options.method, "POST");
  const payload = JSON.parse(fetchCalls[0].options.body);
  assert.equal(payload.jobKey, "linkedin:1");
  assert.equal(payload.type, "contract_signed");
  assert.match(payload.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(payload.note, "");
  assert.equal(payload.nextActionAt, null);
});

test("close fail persists a rejected application event without dashboard removal", async () => {
  const { saveApplicationCloseOutcome, fetchCalls } = await loadDashboardUiFunctions();

  await saveApplicationCloseOutcome("linkedin:1", "fail");

  assert.equal(fetchCalls[0].url, "/api/applications/event");
  assert.equal(fetchCalls[0].options.method, "POST");
  const payload = JSON.parse(fetchCalls[0].options.body);
  assert.equal(payload.jobKey, "linkedin:1");
  assert.equal(payload.type, "rejected");
  assert.match(payload.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(payload.note, "");
  assert.equal(payload.nextActionAt, null);
});

test("stage note input persists a dated note event", async () => {
  const { saveApplicationNote, fetchCalls } = await loadDashboardUiFunctions();

  await saveApplicationNote("linkedin:1", "follow up after portal update");

  assert.equal(fetchCalls[0].url, "/api/applications/event");
  assert.equal(fetchCalls[0].options.method, "POST");
  const payload = JSON.parse(fetchCalls[0].options.body);
  assert.equal(payload.jobKey, "linkedin:1");
  assert.equal(payload.type, "note");
  assert.match(payload.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(payload.note, "follow up after portal update");
  assert.equal(payload.nextActionAt, null);
});

test("dashboard action models omit notes because notes are added from stage notes", async () => {
  const { applicationActionModels } = await loadDashboardUiFunctions();

  const models = applicationActionModels("linkedin:1", "accepted");

  assert.equal(models.some((model) => model.type === "note"), false);
});

test("clicking the same non-stage dashboard action again cancels selection", async () => {
  const { nextDashboardAction } = await loadDashboardUiFunctions();

  assert.equal(nextDashboardAction({ jobKey: "linkedin:1", type: "reject" }, "linkedin:1", "reject"), null);
  assert.deepEqual(JSON.parse(JSON.stringify(nextDashboardAction({ jobKey: "linkedin:1", type: "reject" }, "linkedin:1", "closed"))), {
    jobKey: "linkedin:1",
    type: "closed",
  });
});

test("accept and reject decisions reload review state", async () => {
  const { shouldReloadReviewAfterDecision } = await loadDashboardUiFunctions();

  assert.equal(shouldReloadReviewAfterDecision("accept"), true);
  assert.equal(shouldReloadReviewAfterDecision("reject"), true);
  assert.equal(shouldReloadReviewAfterDecision("maybe"), false);
});

test("review tabs include deleted and deleted does not imply a reject annotation", async () => {
  const { tabs, state, effectiveAnnotation } = await loadDashboardUiFunctions();

  assert.deepEqual(JSON.parse(JSON.stringify(tabs)), [
    ["selected", "Selected"],
    ["rejected", "Rejected"],
    ["deleted", "Deleted"],
  ]);
  state.data = { annotations: {} };
  state.view = "review";
  state.activeTab = "deleted";
  assert.equal(effectiveAnnotation("linkedin:1").decision, null);
});

test("stage notes summary counts notes for the outer collapsed list", async () => {
  const { stageNoteSummaryCount } = await loadDashboardUiFunctions();

  assert.equal(stageNoteSummaryCount([
    { type: "accepted", note: "Accepted from review UI" },
    { type: "applied", note: "submitted" },
    { type: "interview_scheduled", note: "booked" },
    { type: "closed", note: "" },
  ]), 2);
});

test("stage note rendering exposes only groups that have notes", async () => {
  const { visibleStageNoteGroups } = await loadDashboardUiFunctions();

  assert.deepEqual(JSON.parse(JSON.stringify(visibleStageNoteGroups([
    { type: "accepted", note: "Accepted from review UI" },
    { type: "applied", note: "" },
    { type: "note", date: "2026-04-26", note: "follow up later" },
  ]))), [
    {
      type: "note",
      label: "General note",
      notes: [{ date: "2026-04-26", note: "follow up later" }],
    },
  ]);
});

test("general note events render under the current application stage when available", async () => {
  const { visibleStageNoteGroups } = await loadDashboardUiFunctions();

  assert.deepEqual(JSON.parse(JSON.stringify(visibleStageNoteGroups([
    { type: "note", date: "2026-04-26", note: "follow up later" },
  ], "applied_waiting"))), [
    {
      type: "applied",
      label: "Applied",
      notes: [{ date: "2026-04-26", note: "follow up later" }],
    },
  ]);
});
