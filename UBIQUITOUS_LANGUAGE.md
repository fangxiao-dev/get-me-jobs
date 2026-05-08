# Ubiquitous Language

## Job Intake Pipeline

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Job Source** | An external origin that provides job data, such as LinkedIn or StepStone. | Source site, platform |
| **Raw Job** | A job record exactly as collected or adapted from a **Job Source** before canonical merge. | Scraped job, imported job |
| **Raw Source File** | A parseable file under `data/raw/` containing one batch of **Raw Jobs** for the normal merge pipeline. | Local output, manual file |
| **Raw Source Channel** | A configured intake path that produces **Raw Source Files** without directly accepting jobs. | Import mode, source switch |
| **Source Manifest** | The tracked `config/job-sources.manifest.json` file that controls raw-source channel switches and shared review finalize settings. | Pipeline config, source list |
| **Apify LinkedIn Channel** | The `apify_linkedin` channel that runs configured Apify LinkedIn tasks and writes raw source files. | Apify channel, cloud collector |
| **Manual LinkedIn Import** | A single LinkedIn job detail URL imported directly through Dashboard into Accepted/Application tracking. | Add LinkedIn JD, manual raw import |
| **Local Assisted Collector** | A local, user-confirmed workflow that discovers LinkedIn job URLs from one search page and extracts public job details. | Scraper, crawler, LinkedIn bot |
| **Search Page** | The user-provided LinkedIn jobs search URL used only for URL discovery. | Results page, query page |
| **Result List** | The left-side LinkedIn job results container that may be locally scrolled for URL discovery. | Sidebar, feed, job list |
| **Job Detail Page** | A public LinkedIn job page used to extract title, company, location, and description. | JD page, detail URL |

## Review Lifecycle

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Canonical Job** | A normalized job record produced by merging one or more **Raw Jobs**. | Merged job, normalized item |
| **Selected Job** | A **Canonical Job** that passes preference filters and appears in Review for manual decision. | Candidate, recommended job |
| **Rejected Job** | A reviewed job that the user has explicitly rejected. | Excluded job, filtered out job |
| **Accepted Job** | A job the user has explicitly chosen to track as worth pursuing. | Saved job, chosen job |
| **Application** | The tracking record for an **Accepted Job** through application stages and events. | Application state, tracking entry |
| **Review Decision** | The user's manual choice to accept, reject, or otherwise annotate a reviewed job. | Dashboard action, selection result |
| **Preference Filter** | A rule set used to produce **Selected Jobs** from **Canonical Jobs**. | Selection rule, matching rule |

## Collection Modes

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Preview Mode** | A run mode that only discovers and prints job detail URLs. | URL-only run, discovery dry run |
| **Dry Run** | A run mode that may extract details but must not write project data. | Test run, safe run |
| **Raw Source Write Mode** | A non-dry-run mode that writes **Raw Jobs** to `data/raw/linkedin-YYYY-MM-DD-HHMMSS.json`. | Dashboard write mode, manual import mode |
| **Dashboard Manual Write Path** | The existing Dashboard path that imports one LinkedIn URL directly into Accepted/Application tracking. | Raw import path, Review import |
| **Stop Condition** | A condition that immediately ends collection to avoid unsafe or low-quality continuation. | Anomaly, failure |
| **Batch** | A bounded group of job detail URLs processed with delay and cooldown rules. | Chunk, page |

## Relationships

- A **Job Source** produces many **Raw Jobs**.
- A **Raw Source Channel** produces one or more **Raw Source Files**.
- A **Raw Source File** contains one or more **Raw Jobs** from exactly one **Job Source**.
- A **Raw Job** may merge into exactly one **Canonical Job**.
- A **Canonical Job** may have sightings from multiple **Raw Jobs**.
- A **Preference Filter** produces zero or more **Selected Jobs** from **Canonical Jobs**.
- A **Selected Job** becomes an **Accepted Job** only after a user **Review Decision**.
- An **Accepted Job** has zero or one active **Application** tracking record.
- A **Manual LinkedIn Import** bypasses **Selected Job** review and directly creates or updates **Accepted Job** and **Application** records.
- A **Local Assisted Collector** should use the **Search Page** and **Result List** only for URL discovery, then use **Job Detail Pages** for public detail extraction.
- The **Source Manifest** may enable or disable **Raw Source Channels**, but secrets such as LinkedIn Cookie paths stay in ignored local input files.

## Example Dialogue

> **Dev:** "Should the **Local Assisted Collector** call the Dashboard **Manual LinkedIn Import** endpoint after it extracts each job?"
>
> **Domain expert:** "No. **Manual LinkedIn Import** directly creates **Accepted Jobs** and **Applications**. Batch collector output must first become a **Raw Source File**."
>
> **Dev:** "So non-dry-run should write `data/raw/linkedin-YYYY-MM-DD-HHMMSS.json`?"
>
> **Domain expert:** "Exactly. Then canonical merge produces **Canonical Jobs**, selection produces **Selected Jobs**, and the user makes the **Review Decision**."
>
> **Dev:** "The LinkedIn login cookies are only for the **Search Page** and **Result List**, not the **Job Detail Page**?"
>
> **Domain expert:** "Correct. Detail extraction should use public **Job Detail Pages** whenever possible."

## Flagged Ambiguities

- "Import" was used for both **Manual LinkedIn Import** and raw-source batch ingestion; use **Manual LinkedIn Import** only for the Dashboard single-URL accepted path, and use **Raw Source Write Mode** for batch collector persistence.
- "Selected" can mean "chosen by filters" or "accepted by the user"; use **Selected Job** only for filter output before manual review, and **Accepted Job** for user-approved jobs.
- "Dashboard write" is ambiguous; use **Dashboard Manual Write Path** for direct Accepted/Application updates and **Raw Source Write Mode** for Review-first ingestion.
- "Dry run" and "preview" are distinct; **Preview Mode** only discovers URLs, while **Dry Run** may extract details but writes no project data.
- "LinkedIn scraper" is too broad; use **Local Assisted Collector** for the controlled local workflow and **public detail scraper** only for extracting one **Job Detail Page**.
