// Builds card models from generic input. A value can be a literal or a
// { path, from } reference into the JSON a Salesforce tool returned, so numbers
// are read from the tool's output instead of being retyped. Pure functions;
// this file is also inlined into the card.

import { formatValue, isEmpty, isNumericType, isPlainObject, lightningRecordUrl, safeHttpsUrl } from './format.js';

// Bumped when the card model changes shape; the card rebuilds older models from the tool input.
export const MODEL_VERSION = 6;

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
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string' && (a.length === 18 && b.length === 18 ? a === b : id15(a) === id15(b));
const ID_RE = /^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/;

// An id, or the id at the end of a record URL such as …/lightning/r/QuoteLineItem/<id>/view.
function idOf(v) {
  if (typeof v !== 'string') return undefined;
  if (ID_RE.test(v)) return v;
  const m = /\/([A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?)(?:\/view)?\/?(?:[?#].*)?$/.exec(v);
  return m ? m[1] : undefined;
}

function recordsOf(value) {
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
  return records.filter(isPlainObject);
}

// A read result: one record, a query result ({ records }), search results, or an array.
export function pickRecord(value, recordId) {
  const records = recordsOf(value);
  if (typeof recordId === 'string' && recordId) return records.find((r) => sameId(r.Id, recordId));
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
const refKey = (v) => (isRef(v) ? `${v.from === 'result' ? 'result' : 'record'}:${v.path}` : undefined);

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
    .map(({ f, raw }) => {
      const url = safeHttpsUrl(textOf(f.url, sources));
      return {
        label: f.label,
        value: formatValue(raw, f.type, f.currency || currency),
        key: refKey(f.value),
        ...(url ? { url } : {}),
        ...(f.main === true ? { main: true } : {}),
      };
    });
}

// Field entries carry their source path only while changes are matched to them.
const shown = ({ key, ...f }) => f;

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
  const raw = parseMaybeJson(resolve(val, sources));
  if (Array.isArray(raw)) return raw;
  if (isPlainObject(raw) && Array.isArray(raw.records)) return raw.records;
  return [];
}

const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined);
const optional = (raw, type, currency) => (isEmpty(raw) ? undefined : formatValue(raw, type, currency));
const pendingOr = (raw, currency) => (typeof raw === 'string' && /^pending$/i.test(raw.trim()) ? 'Pending' : optional(raw, 'currency', currency));

// One line as the card shows it: a name, then quantity × price, discount, term and dates, and a total.
function lineItem(get, defaults, currency, link) {
  const name = get('name');
  if (isEmpty(name) || isPlainObject(name)) return undefined;
  const term = isEmpty(get('term')) ? defaults.term : get('term');
  return {
    name: String(name),
    url: link,
    quantity: optional(get('quantity'), 'number'),
    price: optional(get('price'), 'currency', currency),
    listPrice: optional(get('listPrice'), 'currency', currency),
    discount: optional(get('discount'), 'percent'),
    total: pendingOr(get('total'), currency),
    term: optional(term, 'number'),
    start: isoDate(get('start')) || defaults.start,
    end: isoDate(get('end')) || defaults.end,
  };
}

const ITEM_PARTS = ['name', 'quantity', 'price', 'listPrice', 'discount', 'total', 'term', 'start', 'end', 'id', 'url'];

function itemLines(lines, sources, currency, origin, states) {
  const item = isPlainObject(lines.item) && typeof lines.item.name === 'string' ? lines.item : undefined;
  const d = isPlainObject(lines.defaults) ? lines.defaults : {};
  const defaults = { term: resolve(d.term, sources), start: isoDate(resolve(d.start, sources)), end: isoDate(resolve(d.end, sources)) };
  const rowType = typeof lines.recordType === 'string' ? lines.recordType : undefined;
  const addedIds = (Array.isArray(lines.added) ? lines.added : lines.added === undefined ? [] : [lines.added])
    .map((v) => idOf(resolve(v, sources)))
    .filter(Boolean);
  const rows = (item ? rowsOf(lines.rows, sources) : [])
    .map(parseMaybeJson)
    .filter(isPlainObject)
    .slice(0, MAX_ROWS)
    .map((row) => {
      const at = (part) => (typeof item[part] === 'string' ? getPath(row, item[part]) : undefined);
      const id = idOf(typeof item.id === 'string' ? at('id') : row.Id);
      const link = safeHttpsUrl(at('url')) || lightningRecordUrl(origin, rowType, id);
      const line = lineItem(at, defaults, currency, link);
      return line && { ...line, state: addedIds.some((a) => sameId(a, id)) ? 'added' : states.row };
    })
    .filter(Boolean);
  const added = (Array.isArray(lines.new) ? lines.new : [])
    .filter(isPlainObject)
    .slice(0, MAX_NEW_ROWS)
    .map((n) => {
      const at = (part) => (ITEM_PARTS.includes(part) ? resolve(n[part], sources) : undefined);
      const type = typeof n.recordType === 'string' ? n.recordType : rowType;
      const link = safeHttpsUrl(at('url')) || lightningRecordUrl(origin, type, idOf(at('id')));
      const line = lineItem(at, defaults, currency, link);
      return line && { ...line, state: states.added };
    })
    .filter(Boolean);
  // A proposed line has no total until it's saved.
  const items = [...rows, ...added].map((l) => (!l.total && (l.state === 'suggested' || l.state === 'draft') ? { ...l, total: 'Pending' } : l));
  return {
    style: 'items',
    title: textOf(lines.title, sources) || 'Line items',
    note: textOf(lines.note, sources),
    items,
    count: rows.length,
    newCount: added.length,
  };
}

function tableLines(lines, sources, currency) {
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
    style: 'table',
    title: textOf(lines.title, sources) || 'Line items',
    note: textOf(lines.note, sources),
    columns: columns.map((c) => ({ label: c.label, numeric: isNumericType(c.type) })),
    rows: [...rows, ...newRows],
    count: rows.length,
    newCount: newRows.length,
  };
}

// `item` (paths into each row) draws lines as rows; `columns` draws the older table;
// `new` alone draws just the new lines.
function lineList(lines, sources, currency, origin, states = { row: 'existing', added: 'added' }) {
  if (!isPlainObject(lines)) return undefined;
  if (isPlainObject(lines.item) && typeof lines.item.name === 'string') return itemLines(lines, sources, currency, origin, states);
  if (Array.isArray(lines.columns)) return tableLines(lines, sources, currency);
  if (Array.isArray(lines.new)) return itemLines(lines, sources, currency, origin, states);
  return undefined;
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

const MAX_TRIGGERS = 6;

// Words compared by their first five letters, so "approves" in a note matches "Approved" in an item.
const STEM_STOPWORDS = new Set(['the', 'and', 'this', 'that', 'its', 'for', 'from', 'with', 'when', 'are', 'can', 'once']);
const stems = (s) =>
  (s.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length > 2 && !STEM_STOPWORDS.has(w)).map((w) => w.slice(0, 5));
// A note that says an item again, such as "…submitting approves it right away" beside "Approved right away".
const repeatsAnItem = (note, names) => {
  const said = new Set(stems(note));
  return names.some((name) => {
    const words = stems(name);
    return words.length > 1 && words.every((w) => said.has(w));
  });
};

// What submitting the record would set off. Approvals can run in parallel, so they keep the
// order they were given without being numbered.
function triggerList(t, sources) {
  if (!isPlainObject(t)) return undefined;
  const named = (list, entry) =>
    (Array.isArray(list) ? list : [])
      .filter(isPlainObject)
      .slice(0, MAX_TRIGGERS)
      .map(entry)
      .filter((x) => x.name);
  const approvals = named(t.approvals, (a) => ({
    name: textOf(a.name, sources),
    approver: textOf(a.approver, sources),
    reason: textOf(a.reason, sources),
    steps: (Array.isArray(a.steps) ? a.steps : []).slice(0, MAX_TRIGGERS).map((s) => textOf(s, sources)).filter(Boolean),
  }));
  const processes = named(t.processes, (p) => ({ name: textOf(p.name, sources), when: textOf(p.when, sources) }));
  const note = textOf(t.note, sources);
  const names = [...approvals, ...processes].map((x) => x.name);
  return { approvals, processes, note: note && !repeatsAnItem(note, names) ? note : undefined };
}

const originOf = (url) => (url ? new URL(url).origin : undefined);
const sourcesOf = (args) => ({ record: pickRecord(args.record, args.recordId), result: pickResult(args.result) });

function common(args) {
  const records = recordsOf(args.record);
  const sources = sourcesOf(args);
  const rec = sources.record || {};
  const currency = typeof args.currency === 'string' ? args.currency : typeof rec.CurrencyIsoCode === 'string' ? rec.CurrencyIsoCode : undefined;
  const recordType = textOf(args.recordType, sources) || (isPlainObject(rec.attributes) && rec.attributes.type) || 'Record';
  const instanceUrl = safeHttpsUrl(textOf(args.instanceUrl, sources));
  const url = safeHttpsUrl(textOf(args.url, sources)) || lightningRecordUrl(instanceUrl, String(recordType), rec.Id);
  const links = (Array.isArray(args.links) ? args.links : [])
    .filter(isPlainObject)
    .slice(0, 4)
    .map((l) => ({ label: textOf(l.label, sources) || 'Open in Salesforce', url: safeHttpsUrl(textOf(l.url, sources)) }))
    .filter((l) => l.url);
  return {
    sources,
    currency,
    otherRecords: sources.record ? Math.max(0, records.length - 1) : 0,
    recordType: String(recordType),
    title: textOf(args.title, sources) || (typeof rec.Name === 'string' ? rec.Name : undefined),
    subtitle: textOf(args.subtitle, sources),
    origin: originOf(instanceUrl || url),
    url,
    links,
    notes: noteList(args.notes, sources),
    footerNote: textOf(args.footerNote, sources),
  };
}

export function buildRecordCard(args = {}) {
  const c = common(args);
  const highlights = fieldList(args.highlights, c.sources, c.currency, 8).map(shown);
  const details = fieldList(args.fields, c.sources, c.currency).map(shown);
  if (!c.title && !highlights.length && !details.length) {
    return { kind: 'record', v: MODEL_VERSION, error: 'There was no record or field data to show.' };
  }
  return {
    kind: 'record',
    v: MODEL_VERSION,
    recordType: c.recordType,
    title: c.title || c.recordType,
    subtitle: c.subtitle,
    highlights,
    details,
    stage: stagePath(args.stages, c.sources),
    lines: lineList(args.lines, c.sources, c.currency, c.origin),
    totals: fieldList(args.totals, c.sources, c.currency, 6).map(shown),
    triggers: triggerList(args.triggers, c.sources),
    notes: c.notes,
    otherRecords: c.otherRecords,
    url: c.url,
    links: c.links,
    footerNote: c.footerNote,
  };
}

const CHANGE_STATUSES = ['preview', 'needs-input', 'rejected'];
const sameLabel = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function buildQuoteChangeCard(args = {}) {
  const c = common(args);
  const summary = textOf(args.summary, c.sources);
  const draft = args.draft === true;
  const status = CHANGE_STATUSES.includes(args.status) ? args.status : 'preview';
  // Lines to add are a proposal only while the change can still be confirmed.
  const lines = status === 'preview' || !isPlainObject(args.lines) ? args.lines : { ...args.lines, new: undefined, newRows: undefined };
  const changes = (Array.isArray(args.changes) ? args.changes : [])
    .filter((d) => isPlainObject(d) && typeof d.label === 'string' && d.label)
    .slice(0, 20)
    .map((d) => ({
      label: d.label,
      key: refKey(d.before),
      before: formatValue(resolve(d.before, c.sources), d.type, c.currency),
      after: formatValue(resolve(d.after, c.sources), d.type, c.currency),
    }));
  // A change to a value the card already shows is drawn in place, as before → after.
  const matched = new Set();
  const withChange = (f) => {
    const i = changes.findIndex((ch) => (ch.key && ch.key === f.key) || sameLabel(ch.label, f.label));
    if (i < 0) return shown(f);
    matched.add(i);
    return { ...shown(f), change: { before: changes[i].before, after: changes[i].after } };
  };
  const highlights = fieldList(args.highlights, c.sources, c.currency, 8).map(withChange);
  const details = fieldList(args.fields, c.sources, c.currency).map(withChange);
  return {
    kind: 'quote-change',
    v: MODEL_VERSION,
    recordType: c.recordType,
    action: textOf(args.action, c.sources),
    title: c.title || textOf(args.action, c.sources) || 'Proposed change',
    subtitle: c.subtitle,
    status,
    draft,
    message: textOf(args.message, c.sources),
    summary,
    highlights,
    details,
    changes: changes.map((ch, i) => ({ label: ch.label, before: ch.before, after: ch.after, shown: matched.has(i) })),
    lines: lineList(lines, c.sources, c.currency, c.origin, draft ? { row: 'draft', added: 'draft' } : { row: 'existing', added: 'suggested' }),
    totals: fieldList(args.totals, c.sources, c.currency, 6).map(shown),
    consequences: noteList(args.consequences, c.sources),
    notes: c.notes,
    confirmHint: textOf(args.confirmHint, c.sources),
    url: c.url,
    links: c.links,
    footerNote: c.footerNote,
  };
}

const MAX_OPTIONS = 10;
// One request shows at most this many quotes; each is confirmed on its own.
const SHOWN_OPTIONS = 3;

// An option is confirmed by its position in the request, so its reply word carries that number.
// With several options shown, the same line offers "confirm all" for every one of them.
function numberedHint(hint, number, together) {
  const reply = (open, close) =>
    `${open}confirm ${number}${close}${together ? ` (or ${open}confirm all${close} for all ${together})` : ''}`;
  const plain = `Not saved until you reply ${reply('“', '”')} in the chat.`;
  if (!hint) return plain;
  const numbered = hint.replace(/([“"'])confirm([”"'])/i, (_, open, close) => reply(open, close));
  return numbered === hint ? `${plain} ${hint}` : numbered;
}

const MODES = ['preview', 'created'];

const plainText = (s) =>
  s
    .toLowerCase()
    .replace(/[“”"‘’']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.!]+$/, '')
    .trim();
const saysTheSame = (a, b) => {
  const x = plainText(a);
  const y = plainText(b);
  return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
};

// An option's approval note goes first among its notes, unless a note already says it.
const withApprovalNote = (notes, note) => (!note || notes.some((n) => saysTheSame(n, note)) ? notes : [note, ...notes]);

// Lines of the same kind count as one product across options, so "Standard Support" on one
// and "Premium Support" on another are both the support line; any other line is its own kind.
const PRODUCT_KINDS = [
  ['license', /licen[cs]e|\bseats?\b/i],
  ['pre-commit', /pre-?commit/i],
  ['support', /support/i],
];
const productKind = (name) => (PRODUCT_KINDS.find(([, re]) => re.test(name)) || [name])[0];
const itemsOf = (o) => (o.lines && o.lines.style === 'items' && o.lines.items.length ? o.lines.items : null);

// What each option leaves out that another option has, such as "No support line".
function missingProducts(options) {
  const kinds = [...new Set(options.flatMap((o) => (itemsOf(o) || []).map((l) => productKind(l.name))))];
  return options.map((o) => {
    const items = itemsOf(o);
    if (!items) return [];
    const has = new Set(items.map((l) => productKind(l.name)));
    return kinds.filter((k) => !has.has(k)).map((k) => (PRODUCT_KINDS.some(([kind]) => kind === k) ? `No ${k} line` : `No ${k}`));
  });
}

export function buildQuoteOptionsCard(args = {}) {
  const mode = MODES.includes(args.mode) ? args.mode : 'preview';
  const build = mode === 'created' ? buildRecordCard : buildQuoteChangeCard;
  const all = (Array.isArray(args.options) ? args.options : [])
    .slice(0, MAX_OPTIONS)
    .map((o, i) => {
      if (!isPlainObject(o)) return null;
      const sources = sourcesOf(o);
      return { ...build(o), number: i + 1, label: textOf(o.label, sources), approvalNote: textOf(o.approvalNote, sources) };
    })
    .filter((o) => o && !o.error);
  const drawn = all.filter((o) => mode === 'created' || o.status === 'preview');
  const options = drawn.slice(0, SHOWN_OPTIONS);
  const together = options.length > 1 ? options.length : 0;
  const missing = missingProducts(options);
  const preview = (o, i) => ({
    ...o,
    notes: withApprovalNote(o.notes, o.approvalNote),
    confirmHint: numberedHint(o.confirmHint, o.number, together),
    missing: missing[i],
  });
  return {
    kind: 'quote-options',
    v: MODEL_VERSION,
    mode,
    options: mode === 'created' ? options.map((o, i) => ({ ...o, missing: missing[i] })) : options.map(preview),
    more: Math.max(0, drawn.length - SHOWN_OPTIONS),
    refused: all
      .filter((o) => !drawn.includes(o))
      .map((o) => ({ number: o.number, label: o.label, title: o.title, status: o.status, message: o.message })),
  };
}

const WRITE_STATUSES = ['saved', 'failed', 'not-saved'];

export function buildWriteResultCard(args = {}) {
  const c = common(args);
  return {
    kind: 'write-result',
    v: MODEL_VERSION,
    recordType: c.recordType,
    title: c.title || c.recordType,
    subtitle: c.subtitle,
    status: WRITE_STATUSES.includes(args.status) ? args.status : 'unknown',
    message: textOf(args.message, c.sources),
    pendingNote: textOf(args.pendingNote, c.sources),
    details: fieldList(args.fields, c.sources, c.currency).map(shown),
    lines: lineList(args.lines, c.sources, c.currency, c.origin),
    totals: fieldList(args.totals, c.sources, c.currency, 6).map(shown),
    notes: c.notes,
    url: c.url,
    links: c.links,
    footerNote: c.footerNote,
  };
}

export function buildCard(kind, args) {
  if (kind === 'record') return buildRecordCard(args);
  if (kind === 'quote-change') return buildQuoteChangeCard(args);
  if (kind === 'quote-options') return buildQuoteOptionsCard(args);
  return buildWriteResultCard(args);
}
