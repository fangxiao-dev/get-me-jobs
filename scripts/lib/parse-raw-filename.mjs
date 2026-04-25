export function parseRawFilename(filename) {
  const match = /^([a-z][a-z0-9]*)-(\d{4}-\d{2}-\d{2})-(\d{6})\.json$/.exec(filename);
  if (!match) return null;
  return { source: match[1], date: match[2], time: match[3] };
}
