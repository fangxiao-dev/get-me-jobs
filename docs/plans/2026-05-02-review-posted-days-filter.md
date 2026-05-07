# Plan: Add "Posted within last N days" filter to Review UI

## Context

The review tab shows job cards with a "Posted: YYYY-MM-DD" field. Users want to filter by recency (e.g., "Last 7 days") rather than picking exact dates. Dashboard already has an exact-date posted filter; the review tab has no posted-date filter at all.

## Approach

Add a `<select>` dropdown filter (single-select) to the review toolbar with fixed options: Any time / Last 7 / 14 / 30 / 60 days. This is intentionally **not** wired into the existing `reconcileFilterValues()` system — it's a fixed-range filter independent of data contents, so reconciliation doesn't apply.

## Files to modify

- `app/public/app.js` — state, helper, filter rendering, filter application
- `app/public/styles.css` — style the new select element to match existing filters

---

## Changes

### 1. State — add `reviewPostedMaxDays` (line 11)

```js
reviewWorkplaceTypes: [],
reviewPostedMaxDays: null,   // ← add
```

### 2. Helper — `daysSincePosted(job)` (after `postedDateOption()`, after line 623)

```js
function daysSincePosted(job) {
  const date = postedDateOption(job);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const posted = new Date(date);
  posted.setHours(0, 0, 0, 0);
  return Math.floor((today - posted) / 86400000);
}
```

### 3. New UI function — `renderPostedDaysFilter()` (after `renderJobFilters()`, after line 686)

```js
function renderPostedDaysFilter() {
  const wrap = createEl("div", "posted-days-filter");
  const select = document.createElement("select");
  for (const { value, label } of [
    { value: "", label: "Any time" },
    { value: "7", label: "Last 7 days" },
    { value: "14", label: "Last 14 days" },
    { value: "30", label: "Last 30 days" },
    { value: "60", label: "Last 60 days" },
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = String(state.reviewPostedMaxDays ?? "") === value;
    select.append(opt);
  }
  select.addEventListener("change", () => {
    state.reviewPostedMaxDays = select.value ? Number(select.value) : null;
    renderReview();
  });
  wrap.append(select);
  return wrap;
}
```

### 4. Wire into review toolbar — `renderReviewToolbar()` (line 524)

Capture the return value of `renderJobFilters()`, append `renderPostedDaysFilter()` to it, then append to toolbar:

```js
function renderReviewToolbar(baseItems, visibleCount) {
  const toolbar = createEl("section", "review-toolbar");
  const filtersEl = renderJobFilters({
    items: baseItems,
    cityValues: state.reviewCities,
    stateValues: state.reviewStates,
    companyValues: state.reviewCompanies,
    workplaceTypeValues: state.reviewWorkplaceTypes,
    prefix: "review",
    onChange: (kind, values) => {
      if (kind === "city") state.reviewCities = values;
      else if (kind === "state") state.reviewStates = values;
      else if (kind === "company") state.reviewCompanies = values;
      else state.reviewWorkplaceTypes = values;
      reconcileReviewFilters(kind);
      renderReview();
    },
  });
  filtersEl.append(renderPostedDaysFilter());
  toolbar.append(filtersEl);
  toolbar.append(createEl("p", "filter-count", `${visibleCount} visible`));
  return toolbar;
}
```

### 5. Apply filter — `filteredReviewItems()` (lines 727-732)

```js
function filteredReviewItems() {
  return baseReviewItems().filter((job) => {
    const parts = locationParts(job.location?.raw ?? job.location);
    if (!jobFilterMatches(job, parts, state.reviewCities, state.reviewStates, state.reviewCompanies, state.reviewWorkplaceTypes)) return false;
    if (state.reviewPostedMaxDays != null) {
      const days = daysSincePosted(job);
      if (days == null || days > state.reviewPostedMaxDays) return false;
    }
    return true;
  });
}
```

### 6. CSS — `app/public/styles.css`

Update `.job-filters` grid from 4 to 5 columns, and add `.posted-days-filter` style:

```css
.job-filters {
  grid-template-columns: repeat(5, minmax(120px, 1fr));  /* was repeat(4, ...) */
}

.posted-days-filter select {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  padding: 7px 8px;
  cursor: pointer;
  font-size: inherit;
  width: 100%;
  height: 100%;
}
```

---

## Verification

1. Start server: `node scripts/start-review.mjs --no-open`
2. Open review tab, confirm "Any time" select appears aligned with other filters
3. Select "Last 7 days" — cards with older posted dates disappear
4. Select "Last 30 days" — more cards appear
5. Select "Any time" — all cards return
6. Combine with City/Company filter — both apply simultaneously
7. Run tests: `node --test scripts/lib/tests/*.test.mjs` (no test changes needed)
