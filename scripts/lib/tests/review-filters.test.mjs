import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

async function loadFilterFunctions() {
  const source = readFileSync("app/public/app.js", "utf8");
  const startupIndex = source.indexOf("window.addEventListener");
  const filterSource = `${source.slice(0, startupIndex)}
globalThis.__filters = {
  jobFilterOptions,
  jobFilterMatches,
  jobMetaParts,
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
  };
  const remoteJob = {
    location: { raw: "Berlin, Berlin, Germany", workplaceType: "remote" },
    company: { name: "Remote GmbH" },
  };

  assert.equal(jobFilterMatches(hybridJob, locationParts(hybridJob.location.raw), [], [], [], ["hybrid"]), true);
  assert.equal(jobFilterMatches(remoteJob, locationParts(remoteJob.location.raw), [], [], [], ["hybrid"]), false);
});

test("job meta includes workplace type labels", async () => {
  const { jobMetaParts } = await loadFilterFunctions();

  assert.deepEqual(JSON.parse(JSON.stringify(jobMetaParts({
    company: { name: "KSB Company" },
    location: { raw: "Frankenthal, Rhineland-Palatinate, Germany", workplaceType: "hybrid" },
    postedAt: { raw: "2026-04-22" },
  }))), [
    "KSB Company",
    "Frankenthal, Rhineland-Palatinate, Germany",
    "Hybrid",
    "2026-04-22",
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
