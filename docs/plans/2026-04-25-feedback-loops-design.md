# Feedback Loops Design

## Purpose

Keep subjective preference learning separate from real-world market response analysis.

## Input Preference Loop

Question: "Do I want to apply to this job?"

Signals:

- Review `accept`, `reject`, `maybe`
- Dashboard `applied`
- Dashboard `reject`
- Subjective notes about topic, location, language, role type, company, or thesis fit

Use:

- Improve `config/preferences.linkedin.json`
- Propose filter changes through `preference-analyse`
- Apply preference updates only after user confirmation

Do not use employer response stages here.

## Market Fit Loop

Question: "Does the employer or market respond positively to this job/application?"

Signals:

- `interview_scheduled`
- `interview_completed`
- `employer_agreed`
- employer rejection, no response, withdrawn, or contract outcome notes

Use:

- Future `market-fit-analyse`
- Application strategy, prioritization, and conversion insight
- No direct writes to `config/preferences.linkedin.json`

## UI Filtering

Review and Dashboard share the same job filter component:

- City multi-select
- State multi-select
- Company multi-select

Options are derived from the currently visible job set, using `location` in `City, State, Country` format and `companyName`.
