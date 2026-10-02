// Card runtime: a minimal MCP Apps (2026-01-26) view. It renders from the tool
// result's structuredContent, or from the tool input when no result arrives.
// It never fetches anything; links and "confirm" go through the host, and only
// when the host advertises that capability.

const KIND = document.body.dataset.kind;
const APP_INFO = { name: 'salesforce-mcp-app', version: document.body.dataset.version || '0.0.0' };
const state = { host: {}, input: undefined, card: undefined, initialized: false };

// ---------- bridge ----------
let nextId = 1;
const pending = new Map();
const post = (msg) => window.parent.postMessage(msg, '*');
function request(method, params) {
  const id = nextId++;
  post({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }
    }, 15000);
  });
}
const notify = (method, params) => post({ jsonrpc: '2.0', method, params });

// A result from an older version of the server has an older model; the tool input still builds the current one.
const isCurrentModel = (sc) => Boolean(sc) && sc.kind === KIND && sc.v === MODEL_VERSION;

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const msg = event.data;
  if (!msg || msg.jsonrpc !== '2.0') return;
  if (msg.id !== undefined && !msg.method) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(Object.assign(new Error(msg.error.message || 'error'), { code: msg.error.code }));
    else p.resolve(msg.result);
    return;
  }
  if (msg.id !== undefined && msg.method) {
    if (msg.method === 'ui/resource-teardown' || msg.method === 'ping') post({ jsonrpc: '2.0', id: msg.id, result: {} });
    else post({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    return;
  }
  const params = msg.params || {};
  switch (msg.method) {
    case 'ui/notifications/tool-input':
      state.input = params.arguments || {};
      if (!state.card) renderFrom(buildCard(KIND, state.input), 'input');
      break;
    case 'ui/notifications/tool-result': {
      const sc = params.structuredContent;
      if (isCurrentModel(sc)) renderFrom(sc, 'result');
      else if (state.input) renderFrom(buildCard(KIND, state.input), 'input');
      break;
    }
    case 'ui/notifications/tool-cancelled':
      if (!state.card) renderNothing();
      break;
    case 'ui/notifications/host-context-changed':
      state.host.context = Object.assign({}, state.host.context, params);
      break;
    default:
      break;
  }
});

async function start() {
  renderMessage('Loading…');
  try {
    const result = await request('ui/initialize', {
      protocolVersion: '2026-01-26',
      appInfo: APP_INFO,
      appCapabilities: { availableDisplayModes: ['inline'] },
    });
    state.host = { capabilities: (result && result.hostCapabilities) || {}, context: (result && result.hostContext) || {} };
  } catch {
    state.host = { capabilities: {}, context: {} };
  }
  state.initialized = true;
  notify('ui/notifications/initialized', {});
  if (state.card) render(state.card);
}

// ---------- DOM helpers ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Account, Opportunity and Quote use the icon images from card.css.
const IMAGE_ICONS = new Set(['account', 'opportunity', 'quote']);
const RECORD_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="5" y="4" width="14" height="16" rx="1"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>';

function icon(name) {
  return h('div', { class: `obj-icon ${name}`, html: IMAGE_ICONS.has(name) ? undefined : RECORD_ICON, 'aria-hidden': 'true' });
}

const objectIconName = (type) => (/^(Account|Opportunity|Quote)$/.test(type || '') ? type.toLowerCase() : 'record');

function shortStage(name) {
  const numbered = /^(\d+)\s*-/.exec(name);
  if (numbered) return numbered[1];
  if (/^closed won$/i.test(name)) return 'Won';
  if (/^closed lost$/i.test(name)) return 'Lost';
  return String(name).split(/\s+/)[0];
}

function field(label, value, changed) {
  return h('div', { class: changed ? 'changed' : null }, h('div', { class: 'field-label' }, label), h('div', { class: 'field-value' }, value));
}

async function openLink(url) {
  if (state.host.capabilities && state.host.capabilities.openLinks) {
    try {
      await request('ui/open-link', { url });
      return;
    } catch {
      /* fall through */
    }
  }
  try {
    window.open(url, '_blank', 'noopener');
  } catch {
    /* sandboxed */
  }
}

function linkButton(url) {
  if (!url) return null;
  const logo = h('span', { class: 'sf-logo', html: SALESFORCE_LOGO, 'aria-hidden': 'true' });
  return h('button', { class: 'btn', type: 'button', 'aria-label': 'Open in Salesforce', onclick: () => openLink(url) }, 'Open in', logo, 'Salesforce');
}

const extraButtons = (links) => (links || []).map((l) => h('button', { class: 'btn', type: 'button', title: l.url, onclick: () => openLink(l.url) }, l.label));

const CALENDAR_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3"/></svg>';

const TAG_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2.5 2.5h5l6 6-5 5-6-6z"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none"/></svg>';

const SPARKLE_ICON =
  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4z"/><path d="M12.5 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>';

const WARNING_ICON =
  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 15 14H1z"/><path d="M8 6v3.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><circle cx="8" cy="11.75" r="0.85" fill="#fff"/></svg>';

const chip = (iconSvg, text, title, variant) =>
  h('span', { class: variant ? `chip ${variant}` : 'chip', title }, iconSvg ? h('span', { class: 'chip-icon', html: iconSvg, 'aria-hidden': 'true' }) : null, text);

const aiPill = (text) => h('span', { class: 'ai-pill' }, h('span', { class: 'chip-icon', html: SPARKLE_ICON, 'aria-hidden': 'true' }), text);
const suggestionsPill = (n) => aiPill(`${n} suggestion${n === 1 ? '' : 's'}`);
const suggestedChip = () => chip(SPARKLE_ICON, 'Suggested', undefined, 'ai');

const termLabel = (term) => `${term} ${Number(term) === 1 ? 'mo' : 'mos'}`;

function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : null;
}

function termChip(l) {
  const from = shortDate(l.start);
  const to = shortDate(l.end);
  const dates = from && to ? `${from}-${to}` : null;
  if (!l.term && !dates) return null;
  return chip(CALENDAR_ICON, [l.term ? termLabel(l.term) : null, dates].filter(Boolean).join(' '));
}

function discountChip(l) {
  if (!l.discount || /^-?0(\.0+)?%$/.test(l.discount) || !l.listPrice) return null;
  return chip(TAG_ICON, `${l.discount} off ${l.listPrice}`);
}

function lineName(l) {
  if (!l.url) return l.name;
  return h('a', { class: 'record-link', href: '#', title: l.url, onclick: (e) => (e.preventDefault(), openLink(l.url)) }, l.name);
}

function lineTotal(l) {
  if (l.total !== 'Pending') return l.total || '—';
  const proposed = l.state === 'suggested' || l.state === 'draft';
  return h('span', { class: 'pending', title: 'The total is set when the record reprices' }, proposed ? 'Calculated on save' : 'Calculating…');
}

function itemList(items) {
  const rows = items.map((l) => {
    const price = l.price || l.listPrice;
    const qtyPrice = l.quantity && price ? `${l.quantity} × ${price}` : l.quantity ? `Qty ${l.quantity}` : price || null;
    const tags = [l.state === 'added' ? chip(null, 'New', undefined, 'new') : null, termChip(l), discountChip(l)].filter(Boolean);
    const suggested = l.state === 'suggested';
    return h(
      'div',
      { class: `line-row${suggested ? ' suggested' : ''}${l.state === 'added' ? ' added' : ''}` },
      h('div', null, h('div', { class: 'line-name' }, lineName(l)), tags.length ? h('div', { class: 'line-meta line-tags' }, tags) : null),
      h('div', { class: 'line-amount' }, h('div', { class: 'line-total' }, lineTotal(l)), qtyPrice ? h('div', { class: 'line-meta' }, qtyPrice) : null),
      suggested ? aiPill('Suggested') : null,
    );
  });
  return h('div', { class: 'line-list' }, rows);
}

function lineTable(lines) {
  const head = h('tr', null, lines.columns.map((col) => h('th', { class: col.numeric ? 'num' : undefined }, col.label)));
  const rows = lines.rows.map((r) =>
    h(
      'tr',
      { class: r.added ? 'added' : undefined },
      r.cells.map((cell, i) =>
        h('td', { class: lines.columns[i].numeric ? 'num' : undefined }, i === 0 && r.added ? [chip(null, 'New', undefined, 'new'), ' '] : null, cell),
      ),
    ),
  );
  return h('table', { class: 'data' }, h('thead', null, head), h('tbody', null, rows));
}

const hasLines = (lines) => Boolean(lines) && (lines.style === 'items' ? lines.items.length > 0 : lines.rows.length > 0);

function linesCard(lines, totals, { open = true } = {}) {
  const suggested = lines.style === 'items' ? lines.items.filter((l) => l.state === 'suggested').length : 0;
  const existing = lines.style === 'items' ? lines.items.length - suggested : lines.rows.length;
  const title = [lines.title, h('span', { class: 'count' }, `${existing} item${existing === 1 ? '' : 's'}`), suggested ? suggestionsPill(suggested) : null];
  const body = lines.style === 'items' ? itemList(lines.items) : lineTable(lines);
  return card(cardBody(section(title, open, body, totalsRow(totals, true), lines.note ? h('p', { class: 'footnote' }, lines.note) : null)));
}

const isZero = (value) => /^[^\d-]*-?0(\.0+)?$/.test(String(value).replace(/[,\s%]/g, ''));

function totalsRow(totals, wide) {
  if (!totals || !totals.length) return null;
  const main = totals.find((t) => t.main) || totals[totals.length - 1];
  const shown = totals.filter((t) => t === main || (t.value !== main.value && !isZero(t.value)));
  const amount = (t) => (/discount/i.test(t.label) && !/^[-−]/.test(t.value) ? `−${t.value}` : t.value);
  return h(
    'div',
    { class: wide ? 'totals wide' : 'totals' },
    shown.map((t) => h('div', { class: t === main ? 'totals-row main' : 'totals-row' }, h('span', null, t.label), h('span', null, amount(t)))),
  );
}

// ---------- Lightning layout pieces ----------
const stack = (...cards) => h('div', { class: 'stack' }, cards);
const card = (...children) => h('div', { class: 'card' }, children);
const cardBody = (...children) => h('div', { class: 'card-body' }, children);

function actionBar(...buttons) {
  const shown = buttons.flat().filter(Boolean);
  return shown.length ? h('div', { class: 'actions' }, shown) : null;
}

function pageHeader(iconNode, eyebrow, title, actions) {
  return h(
    'div',
    { class: 'page-header' },
    iconNode,
    h('div', { class: 'grow' }, eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null, h('div', { class: 'title' }, title)),
    actions ? h('div', { class: 'header-actions' }, actions) : null,
  );
}

function section(title, open, ...content) {
  return h('details', { class: 'sf-section', open }, h('summary', null, title), h('div', { class: 'sf-section-body' }, content));
}

const eyebrowOf = (...parts) => parts.filter(Boolean).join(' · ');

function changeValue(ch) {
  const after = h('span', { class: 'after ai-value' }, ch.after);
  return ch.before && ch.before !== '—' ? [h('span', { class: 'before' }, ch.before), h('span', { class: 'arrow' }, '→'), after] : after;
}

function detailRow(label, value, changed) {
  return h('div', { class: changed ? 'detail changed' : 'detail' }, h('div', { class: 'field-label' }, label), h('div', { class: 'field-value' }, value));
}

const detailRows = (details) => h('div', { class: 'details' }, details.map((f) => detailRow(f.label, f.change ? changeValue(f.change) : f.value, Boolean(f.change))));

function note(kind, items) {
  return h('div', { class: `note ${kind}` }, items.length === 1 ? items[0] : h('ul', { class: 'list' }, items.map((w) => h('li', null, w))));
}

function markdownBlock(md) {
  const onclick = (e) => {
    const a = e.target.closest && e.target.closest('a[data-url]');
    if (!a) return;
    e.preventDefault();
    openLink(a.dataset.url);
  };
  return h('div', { class: 'md', html: markdownToHtml(md), onclick });
}

const highlightsPanel = (fields) =>
  fields.length ? h('div', { class: 'highlights' }, fields.map((f) => field(f.label, f.change ? changeValue(f.change) : f.value, Boolean(f.change)))) : null;
const headerNote = (...children) => (children.some(Boolean) ? h('div', { class: 'header-note' }, children) : null);
const footerLine = (text) => (text ? h('div', { class: 'card-footer' }, text) : null);

// Puts a footer line on the last card, or on a card of its own.
function withFooters(cards, ...lines) {
  const footers = lines.filter(Boolean);
  if (!footers.length) return cards;
  const shown = cards.filter(Boolean);
  const last = shown[shown.length - 1];
  if (last) footers.forEach((f) => last.append(f));
  else shown.push(card(footers));
  return shown;
}

// ---------- cards ----------
// The record as it is, optionally with changes and new lines drawn in place.
function recordView(c, { badge, extraChanges = [], afterCards = [], actions = [] } = {}) {
  const header = card(pageHeader(icon(objectIconName(c.recordType)), eyebrowOf(c.recordType, c.subtitle), c.title, badge), highlightsPanel(c.highlights));
  let path = null;
  if (c.stage) {
    const step = (name, stateName) =>
      h('div', { class: `path-step ${stateName}`, title: name }, h('span', { class: 'full' }, name), h('span', { class: 'short' }, shortStage(name)));
    const steps = c.stage.steps.map((s) => step(s.name, s.state));
    if (c.stage.offPath) steps.push(step(c.stage.current, 'current'));
    path = card(h('div', { class: 'path', role: 'list' }, steps));
  }
  const details = [...extraChanges.map((ch) => ({ label: ch.label, change: ch })), ...c.details];
  const suggestions = details.filter((f) => f.change).length;
  const sections = [];
  if (!hasLines(c.lines) && c.totals.length) sections.push(section('Totals', true, totalsRow(c.totals)));
  if (details.length) {
    const title = ['Information', h('span', { class: 'count' }, `${details.length} field${details.length === 1 ? '' : 's'}`), suggestions ? suggestionsPill(suggestions) : null];
    sections.push(section(title, suggestions > 0, detailRows(details)));
  }
  const info = sections.length ? card(cardBody(sections)) : null;
  const lines = hasLines(c.lines) ? linesCard(c.lines, c.totals) : null;
  const notes = c.notes && c.notes.length && c.kind !== 'quote-change' ? card(cardBody(note('info', c.notes))) : null;
  const more = c.otherRecords ? `Showing 1 of ${c.otherRecords + 1} matching records` : null;
  const cards = withFooters([header, path, info, lines, notes, ...afterCards], more && h('div', { class: 'card-footer center' }, more), footerLine(c.footerNote));
  return stack(cards, actionBar(linkButton(c.url), extraButtons(c.links), actions));
}

function recordCard(c) {
  return recordView(c);
}

function statusBadge(status) {
  if (status === 'preview') return h('span', { class: 'badge warning' }, 'Not saved yet');
  if (status === 'needs-input') return h('span', { class: 'badge info' }, 'Needs input');
  if (status === 'rejected') return h('span', { class: 'badge error' }, 'Refused');
  return h('span', { class: 'badge neutral' }, 'Not saved');
}

const countNewLines = (lines) => (lines && lines.style === 'items' ? lines.items.filter((l) => l.state === 'suggested').length : lines ? lines.newCount : 0);

function quoteChangeCard(c) {
  const proposalTitle = [c.draft ? `Proposed ${c.recordType}` : 'Proposed Change', suggestedChip()];
  // The tool's own preview text leads when nothing else shows the change.
  const structured = c.changes.length > 0 || countNewLines(c.lines) > 0 || (c.draft && hasLines(c.lines));
  const confirm = confirmSection(c, Boolean(c.summary) && !structured);
  const preview = c.summary
    ? card(cardBody(structured ? section('Salesforce Preview', false, markdownBlock(c.summary)) : section(proposalTitle, true, markdownBlock(c.summary))))
    : null;
  const unshown = c.changes.filter((ch) => !ch.shown);
  const recordShape = c.highlights.length > 0 || c.details.length > 0 || hasLines(c.lines);
  if (c.status === 'preview' && (c.draft || recordShape)) {
    return recordView(c, {
      badge: c.draft ? aiPill('Suggested') : null,
      extraChanges: unshown,
      afterCards: [preview, confirm.card],
      actions: [confirm.button],
    });
  }

  const blocked = c.status === 'rejected' || c.status === 'needs-input';
  const header = card(
    pageHeader(icon(objectIconName(c.recordType)), eyebrowOf(c.action || 'Proposed change', c.subtitle), c.title, statusBadge(c.status)),
    highlightsPanel(c.highlights.length ? c.highlights : c.details),
    headerNote(!blocked && c.message && !c.summary ? h('p', { class: 'lead' }, c.message) : null),
  );
  const banner = blocked
    ? card(
        h(
          'div',
          { class: `banner ${c.status === 'rejected' ? 'error' : 'info'}` },
          h('strong', null, c.status === 'rejected' ? 'Salesforce refused this change.' : 'More input needed.'),
          ' ',
          c.message || '',
        ),
      )
    : null;
  const changes = c.changes.length
    ? card(cardBody(section(['Proposed Changes', suggestedChip()], true, detailRows(c.changes.map((ch) => ({ label: ch.label, change: ch }))))))
    : null;
  const lines = hasLines(c.lines) ? linesCard(c.lines, c.totals, { open: countNewLines(c.lines) > 0 }) : null;
  const cards = withFooters(
    structured ? [header, banner, changes, lines, preview, confirm.card] : [header, banner, changes, preview, lines, confirm.card],
    footerLine(c.footerNote),
  );
  return stack(cards, actionBar(linkButton(c.url), extraButtons(c.links), confirm.button));
}

const warnItem = (text) => h('li', { class: 'warn' }, h('span', { class: 'warn-icon', html: WARNING_ICON, 'aria-label': 'Warning:' }), text);

// Items the expanded preview text already says are left out.
function confirmSection(c, summaryShown) {
  const fresh = (item) => !summaryShown || !c.summary.includes(item);
  const warnings = c.notes.filter(fresh);
  if (c.status !== 'preview') return { card: warnings.length ? card(cardBody(note('warning', warnings))) : null, button: null };
  const canMessage = Boolean(state.host.capabilities && state.host.capabilities.message);
  const hint = c.confirmHint || (canMessage ? 'Not saved until you confirm.' : 'Not saved until you reply “confirm” in the chat.');
  const list = h('ul', { class: 'list' }, warnings.map(warnItem), c.consequences.filter(fresh).map((w) => h('li', null, w)), h('li', null, hint));
  return { card: card(cardBody(section('When You Confirm', true, list))), button: canMessage ? confirmButton(c, list) : null };
}

function confirmButton(c, list) {
  const button = h('button', { class: 'btn brand', type: 'button' }, 'Confirm');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const text = `confirm: ${eyebrowOf(c.action, c.title, c.subtitle)}`;
      await request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
      button.textContent = 'Sent to chat';
    } catch {
      button.disabled = false;
      list.append(warnItem('The chat didn’t accept the message. Reply “confirm” instead.'));
    }
  });
  return button;
}

function writeResultCard(c) {
  const failed = c.status === 'failed';
  const saved = c.status === 'saved';
  const badge = saved ? h('span', { class: 'badge success' }, 'Saved') : failed ? h('span', { class: 'badge error' }, 'Not saved') : h('span', { class: 'badge neutral' }, 'Not saved yet');
  const header = card(
    pageHeader(icon(objectIconName(c.recordType)), eyebrowOf(c.recordType, c.subtitle), c.title, badge),
    highlightsPanel(c.details),
    headerNote(
      !failed && c.message ? h('p', { class: 'lead' }, c.message) : null,
      c.pendingNote ? note('info', [c.pendingNote]) : null,
      c.notes.length ? note('warning', c.notes) : null,
    ),
  );
  const banner = failed && c.message ? card(h('div', { class: 'banner error' }, c.message)) : null;
  const lines = hasLines(c.lines) ? linesCard(c.lines, c.totals) : c.totals.length ? card(cardBody(section('Totals', true, totalsRow(c.totals)))) : null;
  return stack(withFooters([header, banner, lines], footerLine(c.footerNote)), actionBar(linkButton(c.url), extraButtons(c.links)));
}

const SALESFORCE_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="5 17 83 62"><path d="M37.963 22.47c2.706-2.83 6.474-4.584 10.641-4.584 5.54 0 10.372 3.099 12.946 7.7a17.84 17.84 0 0 1 7.317-1.56c9.991 0 18.091 8.198 18.091 18.31 0 10.114-8.1 18.312-18.09 18.312a17.84 17.84 0 0 1-3.564-.356c-2.267 4.057-6.586 6.797-11.543 6.797-2.075 0-4.038-.48-5.786-1.336-2.297 5.423-7.65 9.225-13.889 9.225-6.497 0-12.034-4.125-14.16-9.91-.928.198-1.89.301-2.878.301-7.735 0-14.006-6.357-14.006-14.2 0-5.256 2.818-9.845 7.004-12.3a16.303 16.303 0 0 1-1.341-6.495c0-9.02 7.297-16.332 16.299-16.332 5.284 0 9.981 2.521 12.959 6.428" fill="#00A1E0"/></svg>';

// ---------- render ----------
function renderMessage(text) {
  document.documentElement.classList.remove('is-empty');
  document.getElementById('root').replaceChildren(stack(card(h('div', { class: 'empty' }, text))));
}

// The tool's text result already says why; the frame collapses to nothing.
function renderNothing() {
  document.documentElement.classList.add('is-empty');
  document.getElementById('root').replaceChildren();
}

function render(model) {
  if (model.kind === 'record' && model.error) {
    renderNothing();
    document.body.dataset.rendered = model.kind;
    return;
  }
  document.documentElement.classList.remove('is-empty');
  const root = document.getElementById('root');
  let node;
  try {
    node = model.kind === 'record' ? recordCard(model) : model.kind === 'quote-change' ? quoteChangeCard(model) : writeResultCard(model);
  } catch (err) {
    node = stack(card(h('div', { class: 'empty' }, `Couldn't draw this card: ${err && err.message ? err.message : err}`)));
  }
  root.replaceChildren(node);
  document.body.dataset.rendered = model.kind;
}

function renderFrom(model, source) {
  state.card = model;
  document.body.dataset.source = source;
  render(model);
}

// scrollHeight never drops below the iframe's current height, so collapsing a
// section would never shrink the frame; the root element's own height does.
new ResizeObserver(() => {
  const el = document.documentElement;
  notify('ui/notifications/size-changed', { width: el.scrollWidth, height: Math.ceil(el.getBoundingClientRect().height) });
}).observe(document.documentElement);

start();
