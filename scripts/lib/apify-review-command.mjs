export function parseDotenv(text) {
  const env = {};
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    env[key] = value;
  }
  return env;
}

export function resolveTaskEntries(env, taskList) {
  const entries = Object.keys(env)
    .filter((key) => key.startsWith("TASKID_"))
    .sort()
    .map((key) => ({ key, value: env[key] }));
  const resolved = [];

  for (const entry of entries) {
    const direct = taskList.find((task) => task.id === entry.value);
    const byActor = taskList.find((task) => task.actId === entry.value);
    const tokens = entry.key.slice("TASKID_".length).toLowerCase().split("_").filter(Boolean);
    const byName = taskList.find((task) => {
      const name = String(task.name ?? "").toLowerCase();
      return tokens.every((token) => name.includes(token));
    });
    const chosen = entry.key.includes("_ADVANCED") && byName
      ? byName
      : direct ?? byActor ?? byName;

    if (!chosen) {
      resolved.push({ key: entry.key, unresolved: true, value: entry.value });
      continue;
    }
    if (!resolved.some((task) => task.taskId === chosen.id)) {
      resolved.push({
        key: entry.key,
        taskId: chosen.id,
        taskName: chosen.name,
        actorId: chosen.actId,
      });
    }
  }

  return resolved;
}

export function localDateParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (part) => String(part).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  };
}

export function rawFilenameForRun(dateParts, index = 0) {
  const suffix = index > 0 ? `-${String(index + 1).padStart(2, "0")}` : "";
  return `linkedin-${dateParts.date}-${dateParts.time}${suffix}.json`;
}
