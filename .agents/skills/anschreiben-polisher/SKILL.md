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

## Adaptation Workflow

1. Identify the real center of the role: domain, tasks, tools, seniority, and what the employer seems to need.
2. Extract the applicant facts that are directly relevant to that role.
3. Decide what must be avoided because it is unsupported by the CV or user-provided context.
4. Rewrite the letter around the role's tasks instead of reusing a generic AI/software paragraph.
5. Check German grammar, spelling, punctuation, capitalization, degree naming, and idiomatic phrasing.
6. Remove leftover references from other applications, including wrong company names, wrong industries, and mismatched tool claims.
7. Keep the final letter concise, usually 5 to 6 short paragraphs.

## German Style Rules

Prefer natural phrases such as:

- derzeit studiere ich im Masterstudiengang [STUDY PROGRAM]
- Vor meinem aktuellen Studium war ich [RELEVANT PRIOR ROLE] tätig
- An der Position bei Ihnen interessiert mich besonders ...
- In meinem Studium und in aktuellen Projekten beschäftige ich mich mit ...
- Die ausgeschriebene Position spricht mich an, weil ...
- Gerne möchte ich meine Erfahrungen in ... bei Ihnen einbringen
- Über die Gelegenheit, mich persönlich vorzustellen, freue ich mich sehr

Avoid or use carefully:

- "mit großer Leidenschaft"
- "echten Mehrwert schaffen"
- "die Zukunft aktiv mitgestalten"
- "innovative Ideen einbringen" without concrete grounding
- "umfassende Erfahrung" unless clearly true
- repeated constructions with "KI-gestützt", "datengetrieben", or "zukunftsorientiert"
- excessive buzzwords, slash-combinations, stacked hyphens, and repeated sentence structures
- forcing the full legal company name into every paragraph

Use correct forms:

- M.Sc. [PROGRAM NAME]
- Masterstudiengang Digital Business Engineering
- Masterabschluss in [FIELD]
- An der Position bei Ihnen interessiert mich ...
- first full company mention, then natural alternatives such as "bei Ihnen", "in Ihrem Team", "die ausgeschriebene Position", or "diese Aufgabe"

## Honesty Rules

If the job asks for tools or domains the applicant does not have, phrase them as interest, learning direction, or adjacent experience.

Example:

Unsupported:
"Ich habe Erfahrung mit Make und n8n."

Better:
"Erfahrung mit Make oder n8n bringe ich bisher nicht als Schwerpunkt mit, sehe diese Tools aber als naheliegende Erweiterung meiner bisherigen Arbeit mit APIs und Automatisierung."

Unsupported:
"Ich verfüge über Kenntnisse in UDS und Bus-Systemen."

Better:
"Themen wie Fahrzeugelektronik, Diagnose und Austauschformate sehe ich als ein spannendes Anwendungsfeld, in das ich mich gerne systematisch einarbeite."

Unsupported:
"Ich habe Erfahrung mit Markt- und Portfoliodaten."

Better:
"Gerne möchte ich lernen, wie KI-Anwendungen im Finanzberatungsumfeld verantwortungsvoll und praktisch nutzbar gestaltet werden können."

## Recommended Letter Structure

Use this structure unless the user asks for something else:

1. Current academic and professional background
2. Why the position is relevant
3. Relevant experience and skills from the CV
4. Fit with the specific tasks
5. Motivation and contribution
6. Closing sentence

## Output Format

When adapting a letter, provide:

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

Gerne möchte ich meine Erfahrungen in [RELEVANT AREAS] bei Ihnen einbringen. Über die Gelegenheit, mich persönlich vorzustellen, freue ich mich sehr.

Mit freundlichen Grüßen

[NAME]
```

## Final Checklist

Before returning the final version, verify:

- Every claim is supported by the CV, current context, or user-provided details.
- The role focus is clear within the first two paragraphs.
- The company name is used naturally and not repeated unnecessarily.
- There are no leftover references from another application.
- Missing tools or domain knowledge are phrased honestly.
- The letter is concise enough for a real application.
- German cases, prepositions, punctuation, capitalization, and degree names are correct.
- The text sounds like a real applicant rather than a generic AI-generated letter.
