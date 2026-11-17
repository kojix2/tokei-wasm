// Keep only the latest completed result, shared by the popup and detail tab.
// Storage failures must not prevent analysis or rendering.
const key = 'tokei:last-result:v1';

export function readResult(storage) {
  try {
    storage ||= globalThis.localStorage;
    const record = JSON.parse(storage.getItem(key));
    if (typeof record?.id !== 'string' || !record.data?.results?.Total ||
        !Array.isArray(record.data.warnings) || !Number.isFinite(Date.parse(record.data.analyzedAt))) return null;
    return record;
  } catch {return null;}
}

export function saveResult(data, storage) {
  try {
    storage ||= globalThis.localStorage;
    const record = {id: crypto.randomUUID(), data};
    storage.setItem(key, JSON.stringify(record));
    return record;
  } catch {return null;}
}

export function resultRepository(record) {
  const detail = record?.data.detail;
  return detail ? detail.input || `${detail.owner}/${detail.repo}` : null;
}

export function recentResult(record, repo, now = Date.now()) {
  const age = now - Date.parse(record?.data.analyzedAt);
  const saved = resultRepository(record);
  // GitHub names are case-insensitive; other hosts can have case-sensitive paths.
  const matches = saved?.includes('://') || repo?.includes('://') ? saved === repo : saved?.toLowerCase() === repo?.toLowerCase();
  return !!record && !!record.data.detail && matches && age >= 0 && age < 5 * 60_000;
}
