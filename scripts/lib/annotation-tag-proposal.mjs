export const CANONICAL_REJECT_TAGS = [
  "not_thesis",
  "stale_post",
  "no_programming",
  "industrial_hardware",
  "embedded_hardware",
  "domain_mismatch",
  "traditional_ml_cv",
  "low_interest",
];

export const POSITIVE_TAGS = ["good_topic"];

const REJECT_RULES = [
  { tag: "not_thesis", pattern: /not\s*thesis|pflichtpraktikum|不是.*thesis|非.*thesis/i },
  { tag: "stale_post", pattern: /实际日期.*久|日期.*久|posted?.*久|post.*久|年代久远|too\s*old/i },
  { tag: "no_programming", pattern: /无编程|没有.*软件开发|不是技术|非技术|not.*technical|no.*programming/i },
  { tag: "industrial_hardware", pattern: /工业|hardwarenahe|hardware|visual\s*c\+\+|c#|java development/i },
  { tag: "embedded_hardware", pattern: /embedded|rfid|energy harvesting/i },
  {
    tag: "domain_mismatch",
    pattern: /chemistry|pharmatechnik|bioökonomie|biooekonomie|物理|emg|power engines|wertstromanalyse|process design|robotik|robotics/i,
  },
  { tag: "traditional_ml_cv", pattern: /传统\s*ml|traditional\s*ml|bildverarbeitung|computer vision|纯\s*cv/i },
  { tag: "low_interest", pattern: /不感兴趣|没意思|主题不符|thema不感兴趣|不符/i },
];

const LEGACY_REJECT_TAG_MAP = new Map([
  ["not_thesis", "not_thesis"],
]);

function uniqueSorted(values, order = [...CANONICAL_REJECT_TAGS, ...POSITIVE_TAGS]) {
  const unique = [...new Set(values.filter(Boolean))];
  return unique.sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b);
  });
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function inferAnnotationTags(annotation) {
  const oldTags = uniqueSorted((annotation.tags ?? []).map(String));
  const text = `${oldTags.join(" ")}\n${annotation.note ?? ""}`;
  let suggestedTags = oldTags.filter((tag) => POSITIVE_TAGS.includes(tag));

  if (annotation.decision === "accept" || annotation.decision === "maybe") {
    suggestedTags = oldTags.filter((tag) => POSITIVE_TAGS.includes(tag));
  } else if (annotation.decision === "reject") {
    for (const tag of oldTags) {
      const mapped = LEGACY_REJECT_TAG_MAP.get(tag);
      if (mapped) suggestedTags.push(mapped);
    }
    for (const rule of REJECT_RULES) {
      if (rule.pattern.test(text)) suggestedTags.push(rule.tag);
    }
  }

  suggestedTags = uniqueSorted(suggestedTags);
  return {
    oldTags,
    suggestedTags,
    addedTags: suggestedTags.filter((tag) => !oldTags.includes(tag)),
    removedTags: oldTags.filter((tag) => !suggestedTags.includes(tag)),
    changed: !arraysEqual(oldTags, suggestedTags),
  };
}

export function generateAnnotationTagProposal({
  annotationFiles,
  now = new Date().toISOString(),
}) {
  const entries = [];
  const tagCounts = {};
  let totalAnnotations = 0;

  for (const { file, annotations } of annotationFiles) {
    for (const annotation of annotations.items ?? []) {
      totalAnnotations += 1;
      const result = inferAnnotationTags(annotation);
      for (const tag of result.suggestedTags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
      if (!result.changed) continue;

      entries.push({
        file,
        id: String(annotation.id),
        decision: annotation.decision,
        note: annotation.note ?? "",
        oldTags: result.oldTags,
        suggestedTags: result.suggestedTags,
        addedTags: result.addedTags,
        removedTags: result.removedTags,
      });
    }
  }

  return {
    schemaVersion: 1,
    type: "annotation_tag_normalization_proposal",
    createdAt: now,
    tagPolicy: {
      rejectTags: [...CANONICAL_REJECT_TAGS],
      positiveTags: [...POSITIVE_TAGS],
      removedTags: ["too_far", "good_company", "not_ai"],
    },
    summary: {
      files: annotationFiles.length,
      totalAnnotations,
      changedAnnotations: entries.length,
      tagCounts,
    },
    entries,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function applyAnnotationTagProposal(annotations, proposal, file) {
  if (proposal.schemaVersion !== 1) throw new Error("Unsupported annotation tag proposal schemaVersion.");
  if (proposal.type !== "annotation_tag_normalization_proposal") {
    throw new Error("Unsupported annotation tag proposal type.");
  }

  const entriesById = new Map(
    (proposal.entries ?? [])
      .filter((entry) => entry.file === file)
      .map((entry) => [String(entry.id), entry]),
  );
  const next = cloneJson(annotations);
  next.items = (next.items ?? []).map((annotation) => {
    const entry = entriesById.get(String(annotation.id));
    if (!entry) return annotation;
    return {
      ...annotation,
      tags: [...entry.suggestedTags],
    };
  });
  return next;
}
