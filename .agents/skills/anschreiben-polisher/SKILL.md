---
name: anschreiben-polisher
description: Use when adapting, polishing, shortening, or quality-checking a German Anschreiben, Motivationsschreiben, Bewerbungsschreiben, cover letter, internship application, Werkstudent application, thesis application, or research-position application. Trigger especially when the user provides a job description plus an existing German letter or CV context and asks to make it more natural, less AI-sounding, more role-specific, grammatically correct, or strictly grounded in their CV.
---

# Anschreiben Polisher

## Purpose

Adapt German motivation letters and cover letters for jobs, internships, Werkstudent roles, thesis roles, and research positions. Produce concise, natural, grammatically correct German application text that fits the target role without inventing experience or turning the letter into a generic AI template.

## Operating Principles

Use only facts that are already present in the CV, an explicitly provided applicant profile, the current conversation, or details explicitly provided by the user.

Do not invent project experience, domain expertise, tools, frameworks, industry exposure, certificates, responsibilities, or language levels.

Hard rule: do not introduce any professional term, tool name, platform, framework, method, certificate, domain label, or technical keyword unless it is explicitly present in the CV, the required `profile.md`, or the user's own supplied applicant context. The fact that a term appears in the job description is not enough reason to include it in the letter.

If the job description asks for an unsupported tool or domain, do not mention the unsupported term at all unless the user explicitly asks to address that gap. Instead, connect using supported adjacent experience at a higher level.

Make the role fit concrete. Prefer a few precise links between the applicant's real background and the job tasks over broad claims or technical name-dropping.

Keep the tone professional, direct, and human. Avoid stiff bureaucratic language, exaggerated enthusiasm, and generic phrases that could fit any company.

## Input Handling

The user may provide any combination of:

- a job description
- an existing German letter
- a CV, CV summary, or applicant profile
- constraints such as "strictly use my CV", "make it shorter", "remove AI tone", "check grammar", or "do not overstate my experience"

If the CV or applicant profile is missing, use only the facts already available in the current context. If a relevant fact is uncertain, either omit it or phrase it as an interest or learning direction.

If the user asks only for grammar or style correction, preserve the original factual scope and do not add new positioning unless the user also asks for adaptation.

## Required Applicant Profile

Before adapting, polishing, shortening, or quality-checking an application letter in this project, read `profile.md` in this skill directory and treat it as required applicant context.

Treat profile facts as available facts, not as mandatory content. Include them only when they help the specific application, and prefer the user's latest CV or explicit instructions if they conflict with the profile.

## Pre-Writing Alignment

Before drafting or rewriting an adapted letter, first align with the user on the positioning. Summarize the role focus you identified from the job description, the applicant facts you plan to emphasize, and the facts or claims you plan to avoid because they are unsupported or strategically undesirable.

As a required pre-check, judge the information density of the job description before choosing the writing strategy. If the JD is sparse, generic, or mostly lists broad tasks and qualification requirements without concrete projects, tools, team context, or domain details, do not make the letter sound like a point-by-point response to the JD. In that case, lead from the applicant's own relevant experience, working style, and learning direction, then connect back to the role only where the connection is natural. Sparse JDs make repeated role-language sound especially mechanical.

Ask the user to confirm this positioning before writing the final German letter. Do not proceed to the full letter until the user confirms or corrects the positioning. This matters because the strongest Anschreiben depends on choosing a clear main line, not simply mentioning every plausible detail from the CV.

If the user asks only for grammar or style correction without role adaptation, still briefly state that you will preserve the original factual scope before editing.

## Adaptation Workflow

1. Identify the real center of the role: domain, tasks, tools, seniority, and what the employer seems to need. Also classify the JD as high-information or low-information.
2. Extract the applicant facts that are directly relevant to that role.
3. For roles involving process analysis, workflow digitization, quality assurance, data flows, requirements, or technical evaluation, explicitly consider whether the applicant's fachlicher Schwerpunkt from `profile.md` should appear before project examples or working-style claims. This often makes the fit sound grounded instead of jumping straight from JD task to personal habit.
4. Decide what must be avoided because it is unsupported by the CV or user-provided context.
5. Present the positioning to the user and wait for confirmation or correction.
6. Choose the draft strategy. For high-information JDs, rewrite the letter around the role's concrete tasks. For low-information JDs, write primarily from the applicant's relevant experience and only lightly anchor the text to the role.
7. Check German grammar, spelling, punctuation, capitalization, degree naming, and idiomatic phrasing.
8. Remove leftover references from other applications, including wrong company names, wrong industries, and mismatched tool claims.
9. Keep the final letter concise, usually 5 to 6 short paragraphs.

## Job Description Rephrasing

Do not copy the job description's phrasing too closely. A letter sounds stiff when it mirrors the employer's wording, even if the copied terms are technically relevant. Translate the job description into the applicant's own experience language.

When the JD has little content, avoid extracting every visible phrase into the letter. A short JD often contains only broad labels, so repeating them can dominate the text and make it sound generated. Use the JD to set direction, but let the applicant's supported projects, habits, and motivations carry the paragraphs.

Avoid repeating JD phrases mechanically, especially when they are formal task labels such as:

- "strukturierte Analyse"
- "prototypische Umsetzung"
- "KI-Use-Case"
- "Identifikation und Bewertung potenzieller KI-Anwendungsfälle"
- "Machbarkeit, Skalierbarkeit und geschäftlicher Mehrwert"

Prefer applicant-centered phrasing:

- Instead of "Ich kann Datenquellen strukturiert analysieren und einen KI-Use-Case prototypisch umsetzen", write "Ich bin es gewohnt, technische Daten aus unterschiedlichen Quellen einzuordnen, daraus belastbare Auswertungen abzuleiten und neue Ansätze zunächst pragmatisch als Prototyp zu erproben."
- Instead of "Ich priorisiere KI-Anwendungsfälle nach Machbarkeit, Skalierbarkeit und geschäftlichem Mehrwert", write "Ich kann technische Möglichkeiten mit praktischen Anforderungen abgleichen und daraus ableiten, welche Ansätze sich für eine erste Umsetzung eignen."
- Instead of naming the employer's department or field in every paragraph, connect naturally to the task context once, then write from the applicant's perspective.

## German Style Rules

Prefer natural phrases such as:

- derzeit studiere ich im Masterstudiengang [STUDY PROGRAM]
- Vor meinem aktuellen Studium war ich [RELEVANT PRIOR ROLE] tätig
- An der Position bei Ihnen interessiert mich besonders ...
- In meinem Studium und in aktuellen Projekten beschäftige ich mich mit ...
- Die ausgeschriebene Position spricht mich an, weil ...
- Gerne möchte ich meine Erfahrungen in ... bei Ihnen einbringen
- Ich freue mich auf ein persönliches Gespräch

Avoid or use carefully:

- "mit großer Leidenschaft"
- "echten Mehrwert schaffen"
- "die Zukunft aktiv mitgestalten"
- "innovative Ideen einbringen" without concrete grounding
- "umfassende Erfahrung" unless clearly true
- repeated constructions with "KI-gestützt", "datengetrieben", or "zukunftsorientiert"
- excessive buzzwords, slash-combinations, stacked hyphens, and repeated sentence structures
- forcing the full legal company name into every paragraph
- repeating the target company's name throughout the letter; use it at most once in the main body, then switch to natural references such as "bei Ihnen", "in Ihrem Team", "die ausgeschriebene Position", or "diese Aufgabe". Repeated company-name mentions make the letter sound like a template.

### Hyphen and Compound-Noun Control

German technical CVs often contain compact compound nouns and hyphenated terms. In an Anschreiben, do not copy these mechanically. Prefer natural clauses, prepositional phrases, or short explanations when a compound sounds dense, translated, or AI-like.

Keep established technical terms when they are normal in context and explicitly supported by the CV or applicant profile, such as "Software-Testingenieur", "CI/CD", "Smoke Tests", "Regressionstests", "Python", "C++", "Java", or "MySQL".

Avoid dense constructions like:

- "KI-Use-Case"
- "C++-, Java- und Python-Projekte"
- "MLOps- und Edge-AI-Konzepten"
- "Performance-Datenerhebung"
- "Unit-Test-Abdeckung auf PR-Ebene"

Prefer more natural alternatives:

- "KI-Anwendungsfall" or "Anwendungsfall mit KI-Bezug"
- "Projekte in C++, Java und Python"
- "Konzepten für MLOps und Edge AI"
- "Erfassung und Analyse von Leistungsdaten"
- "Abdeckung von Unit Tests auf Ebene einzelner Pull Requests"

When in doubt, rewrite the sentence around an action:

- Instead of "Entwicklung eines Performance-Datenerhebungs-Frameworks", write "Ich entwickelte mit Python ein Framework, das die Erfassung und Analyse von Leistungsdaten standardisierte."
- Instead of "Entwicklung eines CI-integrierten Testabdeckungs-Tools", write "Ich entwickelte ein Tool, das in CI-Prozesse eingebunden war und die Testabdeckung auswertete."

Use correct forms:

- M.Sc. [PROGRAM NAME]
- Masterstudiengang Digital Business Engineering
- Masterabschluss in [FIELD]
- An der Position bei Ihnen interessiert mich ...
- one company-name mention is enough in most letters; after the first mention, use natural alternatives such as "bei Ihnen", "in Ihrem Team", "die ausgeschriebene Position", or "diese Aufgabe"

## Honesty Rules

If the job asks for tools or domains the applicant does not have, do not mention those unsupported names unless the user explicitly asks to address the gap. Use supported adjacent experience at a higher level.

Do not write a dedicated paragraph around weak or missing requirements. Avoid constructions that expose the gap while trying to soften it, such as "Auch wenn mein bisheriger Schwerpunkt nicht auf ..." or "Besonders passend finde ich ...". If a requirement is unsupported, either omit it or connect only through a stronger supported adjacent fact without naming the missing area.

Example:

Unsupported:
"Ich habe Erfahrung mit [UNSUPPORTED TOOL]."

Better:
"Meine bisherige Arbeit mit [SUPPORTED ADJACENT EXPERIENCE] hilft mir, mich schnell in neue Aufgaben einzuarbeiten."

If the user explicitly asks to discuss a missing requirement, mention the gap plainly and briefly. Otherwise omit the unsupported term entirely.

Unsupported:
"Ich verfüge über Kenntnisse in [UNSUPPORTED DOMAIN]."

Better:
"Ich kann mich auf Basis meiner bisherigen Erfahrung in [SUPPORTED ADJACENT AREA] systematisch in neue technische Zusammenhänge einarbeiten."

Unsupported:
"Ich habe Erfahrung mit [UNSUPPORTED DATA DOMAIN]."

Better:
"Gerne möchte ich meine Erfahrung mit [SUPPORTED DATA OR ENGINEERING CONTEXT] in ein neues fachliches Umfeld einbringen."

## Recommended Letter Structure

Use this structure unless the user asks for something else:

1. Current academic and professional background
2. Why the position is relevant
3. Relevant experience and skills from the CV
4. Fit with the specific tasks
5. Motivation and contribution
6. Closing sentence

## Output Format

When first responding to an adaptation request, provide only:

1. The identified role focus and whether the JD is high-information or low-information
2. The draft strategy this implies, especially whether the letter should be JD-led or applicant-experience-led
3. The applicant facts to emphasize
4. The facts, terms, or claims to avoid
5. A direct request for confirmation before drafting

After the user confirms the positioning, provide:

1. A short positioning conclusion
2. An optional subject line if useful
3. The revised German letter
4. A short note on remaining risks or wording choices, only if useful

Do not over-explain unless the user asks.

## Reusable Letter Skeleton

Use this as a skeleton only. Replace bracketed parts with facts grounded in the job description and applicant context.

```text
Sehr geehrte Damen und Herren,

derzeit studiere ich im Masterstudiengang [STUDY PROGRAM]. Zuvor habe ich [RELEVANT PRIOR EXPERIENCE] gesammelt. An der ausgeschriebenen Position interessiert mich besonders die Verbindung aus [ROLE FOCUS 1], [ROLE FOCUS 2] und [ROLE FOCUS 3].

In meinem Studium und in aktuellen Projekten beschäftige ich mich mit [RELEVANT SKILLS FROM CV]. Besonders relevant für die Position finde ich dabei [SPECIFIC CONNECTION TO JOB TASKS].

Meine bisherige Erfahrung in [CV EXPERIENCE] hilft mir, Anforderungen strukturiert zu verstehen und in konkrete Lösungen zu übersetzen. Gerade bei [JOB-SPECIFIC TASK] sehe ich eine gute Verbindung zu [SUPPORTED APPLICANT FACT].

Die ausgeschriebene Position spricht mich an, weil sie [JOB-SPECIFIC COMBINATION] verbindet. Gleichzeitig bietet sie mir die Möglichkeit, meine Kenntnisse in [RELEVANT FIELD] gezielt einzubringen und weiter zu vertiefen.

Gerne möchte ich meine Erfahrungen in [RELEVANT AREAS] bei Ihnen einbringen.

Ich freue mich auf ein persönliches Gespräch.

Mit freundlichen Grüßen

[NAME]
```

## Final Checklist

Before returning the final version, verify:

- Every claim is supported by the CV, current context, or user-provided details.
- The role focus is clear within the first two paragraphs.
- The text does not repackage a long JD task as a long German sentence, especially in constructions like "Die Aufgabe, ..., passt gut zu ...". If a sentence starts by restating a role task in detail, shorten it to a compact thematic bridge such as "Besonders reizvoll finde ich den praktischen Bezug zur Qualitätssicherung", then continue with the applicant's own working style, experience, or motivation.
- The company name appears no more than once in the main body unless there is a specific reason; repeated mentions have been replaced with "bei Ihnen", "in Ihrem Team", "die ausgeschriebene Position", or "diese Aufgabe".
- There are no leftover references from another application.
- Missing tools or domain knowledge are phrased honestly.
- The letter is concise enough for a real application.
- German cases, prepositions, punctuation, capitalization, and degree names are correct.
- The text sounds like a real applicant rather than a generic AI-generated letter.
