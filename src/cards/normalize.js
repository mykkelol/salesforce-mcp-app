// Builds card models from generic input. A value can be a literal or a
// { path, from } reference into the JSON a Salesforce tool returned, so numbers
// are read from the tool's output instead of being retyped. Pure functions;
// this file is also inlined into the card.

import { formatValue, isEmpty, isNumericType, isPlainObject, lightningRecordUrl, safeHttpsUrl } from './format.js';

const MAX_FIELDS = 30;
const MAX_ROWS = 50;
const MAX_NEW_ROWS = 10;
const MAX_COLUMNS = 8;

export function parseMaybeJson(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (!(s.startsWith('{') || s.startsWith('['))) return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

export function unwrap(value) {
  let v = parseMaybeJson(value);
  for (let i = 0; i < 4; i += 1) {
    if (isPlainObject(v) && isPlainObject(v.structuredContent)) {
      v = v.structuredContent;
    } else if (isPlainObject(v) && Array.isArray(v.content) && v.content.length && v.content.every((c) => c && c.type === 'text')) {
      const joined = v.content.map((c) => c.text).join('\n');
      const parsed = parseMaybeJson(joined);
      if (parsed === joined) break;
      v = parsed;
    } else if (isPlainObject(v) && 'body' in v && ('status_code' in v || 'statusCode' in v)) {
      v = parseMaybeJson(v.body);
    } else if (isPlainObject(v) && 'result' in v && 'status' in v && Object.keys(v).length <= 4) {
      v = parseMaybeJson(v.result);
    } else {
      break;
    }
  }
  return v;
}

// 15- and 18-character Salesforce ids share their first 15 (case-sensitive) characters.
const id15 = (id) => (typeof id === 'string' ? id.slice(0, 15) : undefined);

// A read result: one record, a query result ({ records }), search results, or an array.
export function pickRecord(value, recordId) {
  const v = unwrap(value);
  let records = [];
  if (Array.isArray(v)) {
    records = v.map(parseMaybeJson).filter(isPlainObject).flatMap((x) => (Array.isArray(x.records) ? x.records : [x]));
  } else if (isPlainObject(v)) {
    if (Array.isArray(v.records)) records = v.records;
    else if (Array.isArray(v.searchRecords)) records = v.searchRecords;
    else if (isPlainObject(v.record)) records = [v.record];
    else records = [v];
  }
  records = records.filter(isPlainObject);
  if (typeof recordId === 'string' && recordId) return records.find((r) => r.Id && id15(r.Id) === id15(recordId));
  return records[0];
}

// A write or preview result: an invocable action response ([{ outputValues }]) or a plain object.
export function pickResult(value) {
  const v = unwrap(value);
  const first = parseMaybeJson(Array.isArray(v) ? v[0] : v);
  if (isPlainObject(first) && 'outputValues' in first) {
    const outputs = parseMaybeJson(first.outputValues);
    const base = isPlainObject(outputs) ? outputs : {};
    return Array.isArray(first.errors) && first.errors.length && !('errors' in base) ? { ...base, errors: first.errors } : base;
  }
  return isPlainObject(first) ? first : {};
}

export function getPath(source, path) {
  if (source === undefined || source === null || typeof path !== 'string' || !path) return undefined;
  let cur = source;
  for (const part of path.split('.')) {
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else if (isPlainObject(cur)) cur = cur[part];
    else return undefined;
    if (cur === undefined || cur === null) return cur;
  }
  return cur;
}

const isRef = (v) => isPlainObject(v) && typeof v.path === 'string';

export function resolve(val, sources) {
  if (isRef(val)) return getPath(val.from === 'result' ? sources.result : sources.record, val.path);
  return isPlainObject(val) ? undefined : val;
}

function textOf(val, sources) {
  const parts = (Array.isArray(val) ? val : [val]).map((v) => resolve(v, sources)).filter((v) => !isEmpty(v) && !isPlainObject(v));
  return parts.length ? parts.map(String).join(' · ') : undefined;
}

function fieldList(list, sources, currency, max = MAX_FIELDS) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((f) => isPlainObject(f) && typeof f.label === 'string' && f.label)
    .map((f) => ({ f, raw: resolve(f.value, sources) }))
    .filter(({ raw }) => !isEmpty(raw))
    .slice(0, max)
    .map(({ f, raw }) => ({ label: f.label, value: formatValue(raw, f.type, f.currency || currency) }));
}

function noteList(val, sources) {
  const raw = isRef(val) ? resolve(val, sources) : val;
  const items = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return items
    .flatMap((n) => {
      const v = resolve(n, sources);
      if (isPlainObject(v)) return typeof v.message === 'string' ? [v.message] : [];
      return isEmpty(v) ? [] : String(v).split(/\n+/);
    })
    .map((s) => s.replace(/^[-•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function rowsOf(val, sources) {
  const raw = resolve(val, sources);
  if (Array.isArray(raw)) return raw;
  if (isPlainObject(raw) && Array.isArray(raw.records)) return raw.records;
  return [];
}

function lineTable(lines, sources, currency) {
  if (!isPlainObject(lines) || !Array.isArray(lines.columns)) return undefined;
  const columns = lines.columns
    .filter((c) => isPlainObject(c) && typeof c.label === 'string')
    .slice(0, MAX_COLUMNS)
    .map((c) => ({ label: c.label, path: typeof c.path === 'string' ? c.path : '', type: c.type }));
  if (!columns.length) return undefined;
  const rows = rowsOf(lines.rows, sources)
    .map(parseMaybeJson)
    .filter(isPlainObject)
    .slice(0, MAX_ROWS)
    .map((r) => ({ cells: columns.map((c) => formatValue(getPath(r, c.path), c.type, currency)), added: false }));
  const newRows = (Array.isArray(lines.newRows) ? lines.newRows : [])
    .filter(Array.isArray)
    .slice(0, MAX_NEW_ROWS)
    .map((cells) => ({ cells: columns.map((c, i) => formatValue(resolve(cells[i], sources), c.type, currency)), added: true }));
  return {
    title: textOf(lines.title, sources) || 'Line items',
    note: textOf(lines.note, sources),
    columns: columns.map((c) => ({ label: c.label, numeric: isNumericType(c.type) })),
    rows: [...rows, ...newRows],
    count: rows.length,
    newCount: newRows.length,
  };
}

export function stagePath(stages, sources) {
  if (!isPlainObject(stages) || !Array.isArray(stages.steps)) return undefined;
  const steps = stages.steps.filter((s) => typeof s === 'string' && s).slice(0, 12);
  const current = textOf(stages.current, sources);
  if (!steps.length || !current) return undefined;
  const idx = steps.indexOf(current);
  if (idx >= 0) {
    return { current, offPath: false, steps: steps.map((name, i) => ({ name, state: i < idx ? 'complete' : i === idx ? 'current' : 'incomplete' })) };
  }
  if (/\blost\b/i.test(current)) {
    return { current, offPath: false, steps: [...steps.slice(0, -1).map((name) => ({ name, state: 'complete' })), { name: current, state: 'lost' }] };
  }
  return { current, offPath: true, steps: steps.map((name) => ({ name, state: 'incomplete' })) };
}

const notIn = (text) => (item) => !text || !text.includes(item);

function common(args) {
  const sources = { record: pickRecord(args.record, args.recordId), result: pickResult(args.result) };
  const rec = sources.record || {};
  const currency = typeof args.currency === 'string' ? args.currency : typeof rec.CurrencyIsoCode === 'string' ? rec.CurrencyIsoCode : undefined;
  const recordType = textOf(args.recordType, sources) || (isPlainObject(rec.attributes) && rec.attributes.type) || 'Record';
  const links = (Array.isArray(args.links) ? args.links : [])
    .filter(isPlainObject)
    .slice(0, 4)
    .map((l) => ({ label: textOf(l.label, sources) || 'Open in Salesforce', url: safeHttpsUrl(textOf(l.url, sources)) }))
    .filter((l) => l.url);
  return {
    sources,
    currency,
    recordType: String(recordType),
    title: textOf(args.title, sources) || (typeof rec.Name === 'string' ? rec.Name : undefined),
    subtitle: textOf(args.subtitle, sources),
    url: safeHttpsUrl(textOf(args.url, sources)) || lightningRecordUrl(textOf(args.instanceUrl, sources), String(recordType), rec.Id),
    links,
    footerNote: textOf(args.footerNote, sources),
  };
}

export function buildRecordCard(args = {}) {
  const c = common(args);
  const highlights = fieldList(args.highlights, c.sources, c.currency, 8);
  const details = fieldList(args.fields, c.sources, c.currency);
  if (!c.title && !highlights.length && !details.length) {
    return { kind: 'record', error: 'There was no record or field data to show.' };
  }
  return {
    kind: 'record',
    recordType: c.recordType,
    title: c.title || c.recordType,
    subtitle: c.subtitle,
    highlights,
    details,
    stage: stagePath(args.stages, c.sources),
    lines: lineTable(args.lines, c.sources, c.currency),
    totals: fieldList(args.totals, c.sources, c.currency, 6),
    notes: noteList(args.notes, c.sources),
    url: c.url,
    links: c.links,
    footerNote: c.footerNote,
  };
}

const CHANGE_STATUSES = ['preview', 'needs-input', 'rejected'];

export function buildQuoteChangeCard(args = {}) {
  const c = common(args);
  const summary = textOf(args.summary, c.sources);
  return {
    kind: 'quote-change',
    recordType: c.recordType,
    title: c.title || 'Proposed change',
    subtitle: c.subtitle,
    status: CHANGE_STATUSES.includes(args.status) ? args.status : 'preview',
    message: textOf(args.message, c.sources),
    summary,
    changes: (Array.isArray(args.changes) ? args.changes : [])
      .filter((d) => isPlainObject(d) && typeof d.label === 'string' && d.label)
      .slice(0, 20)
      .map((d) => ({
        label: d.label,
        before: formatValue(resolve(d.before, c.sources), d.type, c.currency),
        after: formatValue(resolve(d.after, c.sources), d.type, c.currency),
      })),
    lines: lineTable(args.lines, c.sources, c.currency),
    totals: fieldList(args.totals, c.sources, c.currency, 6),
    details: fieldList(args.fields, c.sources, c.currency),
    notes: noteList(args.notes, c.sources).filter(notIn(summary)),
    confirmHint: textOf(args.confirmHint, c.sources),
    url: c.url,
    links: c.links,
    footerNote: c.footerNote,
  };
}

const WRITE_STATUSES = ['saved', 'failed', 'not-saved'];

export function buildWriteResultCard(args = {}) {
  const c = common(args);
  return {
    kind: 'write-result',
    recordType: c.recordType,
    title: c.title || c.recordType,
    subtitle: c.subtitle,
    status: WRITE_STATUSES.includes(args.status) ? args.status : 'unknown',
    message: textOf(args.message, c.sources),
    pendingNote: textOf(args.pendingNote, c.sources),
    details: fieldList(args.fields, c.sources, c.currency),
    lines: lineTable(args.lines, c.sources, c.currency),
    totals: fieldList(args.totals, c.sources, c.currency, 6),
    notes: noteList(args.notes, c.sources),
    url: c.url,
    links: c.links,
    footerNote: c.footerNote,
  };
}

export function buildCard(kind, args) {
  if (kind === 'record') return buildRecordCard(args);
  if (kind === 'quote-change') return buildQuoteChangeCard(args);
  return buildWriteResultCard(args);
}
