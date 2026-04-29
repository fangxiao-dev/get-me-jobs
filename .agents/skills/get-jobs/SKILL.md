---
name: get-jobs
description: Use in this job-finder project when the user asks to get jobs, collect jobs, 收集工作, 收集岗位, 拉取工作, 抓取工作, 更新今日岗位, or otherwise requests the daily job collection workflow. This skill runs the project-local Apify review command.
---

# Get Jobs

Run the project-local daily collection command:

```powershell
npm run review:today
```

Use this only inside this repository. The command reads `.env`, runs configured `TASKID_*` Apify tasks, saves raw outputs, and merges/selects today's Review batch.

After it finishes, report:

- Which tasks succeeded or failed.
- The generated `data/raw/...`, `data/canonical/YYYY-MM-DD.json`, and `data/selected/YYYY-MM-DD.json` files.
- The Review UI URL if the local server is running or was started separately.

Do not paste `.env` token values into chat or logs.
