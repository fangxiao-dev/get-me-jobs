export function toText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(toText).join("\n");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function getField(obj, dotPath) {
  return dotPath.split(".").reduce((curr, key) => curr?.[key], obj);
}

export function pickFields(item, fields) {
  return fields.map((field) => toText(getField(item, field))).filter(Boolean).join("\n");
}

export function termMatches(text, term) {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedTerm = term.toLocaleLowerCase();

  if (/^[a-z0-9.+#-]+$/i.test(term) && term.length <= 4) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text);
  }

  return normalizedText.includes(normalizedTerm);
}

export function evaluateRule(item, rule) {
  const text = pickFields(item, rule.fields ?? []);
  const matchedTerms = (rule.terms ?? []).filter((term) => termMatches(text, term));

  return {
    id: rule.id,
    description: rule.description,
    passed: matchedTerms.length > 0,
    matchedTerms,
  };
}

export function selectItems(raw, preferences) {
  const mustRules = preferences.rules?.must ?? [];
  const excludeRules = preferences.rules?.exclude ?? [];

  return (raw.items ?? [])
    .map((item) => {
      const must = mustRules.map((rule) => evaluateRule(item, rule));
      const exclude = excludeRules.map((rule) => evaluateRule(item, rule));
      const passed = must.every((result) => result.passed) && !exclude.some((result) => result.passed);

      return { item, match: { passed, must, exclude } };
    })
    .filter((result) => result.match.passed);
}

export function stableId(item) {
  return item.identity?.jobId ?? item.id ?? item.sourceJobId ?? item.link ?? item.url;
}
