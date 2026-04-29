import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

async function loadFilterFunctions() {
  const source = readFileSync("app/public/app.js", "utf8");
  const startupIndex = source.indexOf("window.addEventListener");
  const filterSource = `${source.slice(0, startupIndex)}
globalThis.__filters = {
  batchOptionLabel,
  chooseInitialBatch,
  jobFilterOptions,
  jobFilterMatches,
  jobMetaParts,
  postedDateOption,
  postedDateLabel,
  locationParts,
  reconcileFilterValues,
  normalizeOption,
};`;
  const context = {
    globalThis: {},
    window: { location: { search: "" } },
    URLSearchParams,
    document: {},
    DOMParser: class {},
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    CSS: { escape: (value) => String(value) },
    fetch: async () => ({ ok: false, json: async () => ({ error: "not used" }) }),
  };
  const vm = await import("node:vm");
  vm.runInNewContext(filterSource, context);
  return context.globalThis.__filters;
}

test("job filters include compatible workplace type options", async () => {
  const { jobFilterOptions } = await loadFilterFunctions();
  const items = [
    {
      location: { raw: "Frankenthal, Rhineland-Palatinate, Germany", workplaceType: "hybrid" },
      company: { name: "KSB Company" },
    },
    {
      location: { raw: "Berlin, Berlin, Germany", workplaceType: "remote" },
      company: { name: "Remote GmbH" },
    },
    {
      location: { raw: "Berlin, Berlin, Germany" },
      company: { name: "Unknown GmbH" },
    },
  ];

  const options = jobFilterOptions(items, { stateValues: ["berlin"] });

  assert.deepEqual(JSON.parse(JSON.stringify(options.workplaceType)), [
    { value: "remote", label: "Remote" },
    { value: "unknown", label: "Unknown" },
  ]);
});

test("job filters match selected workplace types", async () => {
  const { jobFilterMatches, locationParts } = await loadFilterFunctions();
  const hybridJob = {
    location: { raw: "Frankenthal, Rhineland-Palatinate, Germany", workplaceType: "hybrid" },
    company: { name: "KSB Company" },
    timing: { postedAt: "2026-04-24T10:45:51Z" },
  };
  const remoteJob = {
    location: { raw: "Berlin, Berlin, Germany", workplaceType: "remote" },
    company: { name: "Remote GmbH" },
    timing: { postedAt: "2026-04-22T10:45:51Z" },
  };

  assert.equal(jobFilterMatches(hybridJob, locationParts(hybridJob.location.raw), [], [], [], ["hybrid"]), true);
  assert.equal(jobFilterMatches(remoteJob, locationParts(remoteJob.location.raw), [], [], [], ["hybrid"]), false);
  assert.equal(jobFilterMatches(hybridJob, locationParts(hybridJob.location.raw), [], [], [], [], ["2026-04-24"]), true);
  assert.equal(jobFilterMatches(remoteJob, locationParts(remoteJob.location.raw), [], [], [], [], ["2026-04-24"]), false);
});

test("job meta includes workplace type labels", async () => {
  const { jobMetaParts, postedDateLabel, postedDateOption } = await loadFilterFunctions();

  assert.equal(postedDateLabel({ timing: { postedAt: "2026-04-24T10:45:51Z" } }), "Posted: 2026-04-24");
  assert.equal(postedDateLabel({ postedAt: { raw: "2026-04-22" } }), "Posted: 2026-04-22");
  assert.equal(postedDateLabel({}), null);
  assert.equal(postedDateOption({ timing: { postedAt: "2026-04-24T10:45:51Z" } }), "2026-04-24");
  assert.equal(postedDateOption({}), "");

  assert.deepEqual(JSON.parse(JSON.stringify(jobMetaParts({
    company: { name: "KSB Company" },
    location: { raw: "Frankenthal, Rhineland-Palatinate, Germany", workplaceType: "hybrid" },
    timing: { postedAt: "2026-04-24T10:45:51Z" },
  }))), [
    "KSB Company",
    "Frankenthal, Rhineland-Palatinate, Germany",
    "Hybrid",
    "Posted: 2026-04-24",
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(jobMetaParts({
    companyName: "Remote GmbH",
    location: "Berlin, Berlin, Germany",
    workplaceType: "remote",
    source: "linkedin",
  }))), [
    "Remote GmbH",
    "Berlin, Berlin, Germany",
    "Remote",
    "linkedin",
  ]);
});

test("job filter options include posted dates when requested", async () => {
  const { jobFilterOptions } = await loadFilterFunctions();
  const items = [
    { timing: { postedAt: "2026-04-24T10:45:51Z" }, company: { name: "KSB" }, location: { raw: "A, B" } },
    { postedAt: { raw: "2026-04-22" }, company: { name: "VW" }, location: { raw: "C, D" } },
    { company: { name: "No Date" }, location: { raw: "E, F" } },
  ];

  assert.deepEqual(JSON.parse(JSON.stringify(jobFilterOptions(items, {}, { includePostedDates: true }).postedDate)), [
    { value: "2026-04-24", label: "2026-04-24" },
    { value: "2026-04-22", label: "2026-04-22" },
  ]);
  assert.equal(jobFilterOptions(items).postedDate, undefined);
});

test("filter reconciliation removes stale posted date selections", async () => {
  const { reconcileFilterValues } = await loadFilterFunctions();
  const items = [
    { timing: { postedAt: "2026-04-23T10:45:51Z" }, company: { name: "VW" }, location: { raw: "C, D" } },
  ];

  const next = reconcileFilterValues(items, {
    cityValues: [],
    stateValues: [],
    companyValues: [],
    workplaceTypeValues: [],
    postedDateValues: ["2026-04-24"],
  });

  assert.deepEqual(JSON.parse(JSON.stringify(next.postedDateValues)), []);
});

test("batch selector helpers label counts and prefer URL batch over latest", async () => {
  const { batchOptionLabel, chooseInitialBatch } = await loadFilterFunctions();
  const batches = [
    { date: "2026-04-26", selectedCount: 8, totalCount: 12 },
    { date: "2026-04-27", selectedCount: 36, totalCount: 174 },
  ];

  assert.equal(batchOptionLabel(batches[1]), "2026-04-27 (36/174)");
  assert.equal(chooseInitialBatch(batches, "2026-04-26").date, "2026-04-26");
  assert.equal(chooseInitialBatch(batches, null).date, "2026-04-27");
});
