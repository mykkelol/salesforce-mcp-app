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

const CHEVRON_DOWN =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';

const chip = (iconSvg, text, title, variant) =>
  h('span', { class: variant ? `chip ${variant}` : 'chip', title }, iconSvg ? h('span', { class: 'chip-icon', html: iconSvg, 'aria-hidden': 'true' }) : null, text);

const aiPill = (text) =>
  h('span', { class: 'ai-pill' }, h('span', { class: 'chip-icon', html: SPARKLE_ICON, 'aria-hidden': 'true' }), h('span', { class: 'ai-pill-text' }, text));
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

// A link to a record, opened through the host. It never toggles the section or option it sits in.
function recordLink(text, url) {
  if (!url) return text;
  return h('a', { class: 'record-link', href: '#', title: url, onclick: (e) => (e.preventDefault(), e.stopPropagation(), openLink(url)) }, text);
}

const lineName = (l) => recordLink(l.name, l.url);

function lineTotal(l) {
  if (l.total !== 'Pending') return l.total || '—';
  const proposed = l.state === 'suggested' || l.state === 'draft';
  return h('span', { class: 'pending', title: 'The total is set when the record reprices' }, proposed ? 'Calculated on save' : 'Calculating…');
}

function itemList(items) {
  const rows = items.map((l) => {
    const price = l.price || l.listPrice;
    const qtyPrice = l.quantity && price ? `${l.quantity} × ${price}` : l.quantity ? `Qty ${l.quantity}` : price || null;
    const tags = [termChip(l), discountChip(l)].filter(Boolean);
    const suggested = l.state === 'suggested';
    return h(
      'div',
      { class: suggested ? 'line-row suggested' : 'line-row' },
      h('div', null, h('div', { class: 'line-name' }, lineName(l)), tags.length ? h('div', { class: 'line-meta line-tags' }, tags) : null),
      h('div', { class: 'line-amount' }, h('div', { class: 'line-total' }, lineTotal(l)), qtyPrice ? h('div', { class: 'line-meta' }, qtyPrice) : null),
      suggested ? aiPill('Adding quote line') : null,
    );
  });
  return h('div', { class: 'line-list' }, rows);
}

function lineTable(lines) {
  const head = h('tr', null, lines.columns.map((col) => h('th', { class: col.numeric ? 'num' : undefined }, col.label)));
  const rows = lines.rows.map((r) => h('tr', null, r.cells.map((cell, i) => h('td', { class: lines.columns[i].numeric ? 'num' : undefined }, cell))));
  return h('table', { class: 'data' }, h('thead', null, head), h('tbody', null, rows));
}

const hasLines = (lines) => Boolean(lines) && (lines.style === 'items' ? lines.items.length > 0 : lines.rows.length > 0);

// Every section starts collapsed, so its header says what's inside.
const summary = (...parts) => {
  const text = eyebrowOf(...parts);
  return text ? h('span', { class: 'count' }, text) : null;
};
const mainTotal = (totals) => (totals && totals.length ? totals.find((t) => t.main) || totals[totals.length - 1] : null);
const totalSummary = (totals) => {
  const main = mainTotal(totals);
  return main ? `${main.label} ${main.value}` : null;
};

function linesCard(lines, totals) {
  const suggested = lines.style === 'items' ? lines.items.filter((l) => l.state === 'suggested').length : 0;
  const existing = lines.style === 'items' ? lines.items.length - suggested : lines.rows.length;
  const title = [lines.title, summary(`${existing} item${existing === 1 ? '' : 's'}`, totalSummary(totals)), suggested ? suggestionsPill(suggested) : null];
  const body = lines.style === 'items' ? itemList(lines.items) : lineTable(lines);
  return card(cardBody(section(title, false, body, totalsRow(totals, true), lines.note ? h('p', { class: 'footnote' }, lines.note) : null)));
}

const isZero = (value) => /^[^\d-]*-?0(\.0+)?$/.test(String(value).replace(/[,\s%]/g, ''));

function totalsRow(totals, wide) {
  if (!totals || !totals.length) return null;
  const main = mainTotal(totals);
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

function pageHeader(iconNode, eyebrow, title, actions, meta) {
  return h(
    'div',
    { class: 'page-header' },
    iconNode,
    h('div', { class: 'grow' }, eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null, h('div', { class: 'title' }, title), meta),
    actions ? h('div', { class: 'header-actions' }, actions) : null,
  );
}

function section(title, open, ...content) {
  return h('details', { class: 'sf-section', open }, h('summary', null, title), h('div', { class: 'sf-section-body' }, content));
}

const eyebrowOf = (...parts) => parts.filter(Boolean).join(' · ');

function changeValue(ch) {
  const after = h('span', { class: 'after ai-value' }, ch.after);
  return ch.before && ch.before !== '—' ? [h('span', { class: 'before' }, ch.before), ' ', after] : after;
}

function detailRow(label, value, changed) {
  return h('div', { class: changed ? 'detail changed' : 'detail' }, h('div', { class: 'field-label' }, label), h('div', { class: 'field-value' }, value));
}

const fieldValue = (f) => (f.change ? changeValue(f.change) : recordLink(f.value, f.url));

const detailRows = (details) => h('div', { class: 'details' }, details.map((f) => detailRow(f.label, fieldValue(f), Boolean(f.change))));

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

const highlightsPanel = (fields) => (fields.length ? h('div', { class: 'highlights' }, fields.map((f) => field(f.label, fieldValue(f), Boolean(f.change)))) : null);
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
  const header = card(pageHeader(icon(objectIconName(c.recordType)), c.eyebrow || eyebrowOf(c.recordType, c.subtitle), c.title, badge), highlightsPanel(c.highlights));
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
  if (!hasLines(c.lines) && c.totals.length) sections.push(section(['Totals', summary(totalSummary(c.totals))], false, totalsRow(c.totals)));
  if (details.length) {
    const title = ['Information', summary(`${details.length} field${details.length === 1 ? '' : 's'}`), suggestions ? suggestionsPill(suggestions) : null];
    sections.push(section(title, false, detailRows(details)));
  }
  const info = sections.length ? card(cardBody(sections)) : null;
  const lines = hasLines(c.lines) ? linesCard(c.lines, c.totals) : null;
  const notes = c.notes && c.notes.length && c.kind !== 'quote-change' ? card(cardBody(note('info', c.notes))) : null;
  const triggers = c.triggers ? triggersCard(c.triggers, c.submitHint) : null;
  const more = c.otherRecords ? `Showing 1 of ${c.otherRecords + 1} matching records` : null;
  const cards = withFooters([header, path, info, lines, notes, triggers, ...afterCards], more && h('div', { class: 'card-footer center' }, more), footerLine(c.footerNote));
  return stack(cards, actionBar(linkButton(c.url), extraButtons(c.links), actions));
}

function recordCard(c) {
  return recordView(c);
}

const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function triggersSummary(t) {
  return eyebrowOf(t.approvals.length ? counted(t.approvals.length, 'approval', 'approvals') : 'No approvals', t.processes.length ? counted(t.processes.length, 'process', 'processes') : null);
}

// What submitting the record would set off. Approvals can run in parallel, so they aren't numbered.
function triggersCard(t, hint) {
  const approval = (a) =>
    h(
      'li',
      null,
      h('div', { class: 'trigger-name' }, a.name),
      a.approver ? h('div', { class: 'small' }, `Approver: ${a.approver}`) : null,
      a.steps.length ? h('div', { class: 'small' }, a.steps.join(' → ')) : null,
      a.reason ? h('div', { class: 'small muted' }, a.reason) : null,
    );
  const process = (p) => h('li', null, p.name, p.when ? h('span', { class: 'muted' }, ` · ${p.when}`) : null);
  const body = [
    t.approvals.length ? [h('div', { class: 'trigger-head' }, 'Approvals'), h('ul', { class: 'list trigger-list' }, t.approvals.map(approval))] : null,
    t.processes.length ? [h('div', { class: 'trigger-head' }, 'Then'), h('ul', { class: 'list' }, t.processes.map(process))] : null,
    t.note ? h('p', { class: 'trigger-note small muted' }, t.note) : null,
    hint ? h('p', { class: 'trigger-note' }, hint) : null,
  ];
  const title = ['What This Triggers', summary(triggersSummary(t))];
  return h('div', { class: 'card triggers' }, cardBody(section(title, false, body)));
}

function statusBadge(status) {
  if (status === 'preview') return h('span', { class: 'badge warning' }, 'Not saved yet');
  return h('span', { class: 'badge neutral' }, 'Not saved');
}

// A record that doesn't exist yet: the whole proposal sits in one purple frame.
const aiFrame = (label, content) => h('div', { class: 'ai-frame' }, aiPill(label), content);

// A write's card is only the record as read after a successful save, passed as the tool input's `record`.
const hasLaterRead = () => Boolean(state.input) && state.input.record !== undefined && state.input.record !== null && state.input.record !== '';

// Questions, refusals and other writes draw no card; the tool's text result carries the message.
const drawsNothing = (model) =>
  (model.kind === 'record' && Boolean(model.error)) ||
  (model.kind === 'quote-change' && (model.status === 'needs-input' || model.status === 'rejected')) ||
  (model.kind === 'quote-options' && !(model.options && model.options.length)) ||
  (model.kind === 'write-result' && !(model.status === 'saved' && hasLaterRead()));

const countNewLines = (lines) => (lines && lines.style === 'items' ? lines.items.filter((l) => l.state === 'suggested').length : lines ? lines.newCount : 0);

// The first line of the tool's preview text, as the header of its collapsed section.
function firstLine(md) {
  const line = (markdownToTextLines(md)[0] || '').replace(/^•\s*/, '');
  return line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line;
}

function quoteChangeCard(c) {
  const lead = summary(c.summary && firstLine(c.summary));
  const proposalTitle = [c.draft ? `Proposed ${c.recordType}` : 'Proposed Change', lead, suggestedChip()];
  // The tool's own preview text leads when nothing else shows the change.
  const structured = c.changes.length > 0 || countNewLines(c.lines) > 0 || (c.draft && hasLines(c.lines));
  const confirm = confirmSection(c, Boolean(c.summary) && !structured);
  const preview = c.summary
    ? card(cardBody(structured ? section(['Salesforce Preview', lead], false, markdownBlock(c.summary)) : section(proposalTitle, false, markdownBlock(c.summary))))
    : null;
  const unshown = c.changes.filter((ch) => !ch.shown);
  const recordShape = c.highlights.length > 0 || c.details.length > 0 || hasLines(c.lines);
  let node;
  if (c.draft || recordShape) {
    node = recordView(c, { extraChanges: unshown, afterCards: [preview, confirm.card], actions: [confirm.button] });
    if (c.draft) node.replaceChildren(aiFrame('Creating new quote', [...node.childNodes]));
  } else {
    const header = card(
      pageHeader(icon(objectIconName(c.recordType)), c.eyebrow || eyebrowOf(c.action || 'Proposed change', c.subtitle), c.title, statusBadge(c.status)),
      headerNote(c.message && !c.summary ? h('p', { class: 'lead' }, c.message) : null),
    );
    const changes = c.changes.length
      ? card(cardBody(section(['Proposed Changes', summary(plural(c.changes.length, 'change')), suggestedChip()], false, detailRows(c.changes.map((ch) => ({ label: ch.label, change: ch }))))))
      : null;
    node = stack(withFooters([header, changes, preview, confirm.card], footerLine(c.footerNote)), actionBar(linkButton(c.url), extraButtons(c.links), confirm.button));
  }
  return node;
}

const warnItem = (text) => h('li', { class: 'warn' }, h('span', { class: 'warn-icon', html: WARNING_ICON, 'aria-label': 'Warning:' }), text);

// Items the expanded preview text already says are left out.
function confirmSection(c, summaryShown, open = false) {
  const fresh = (item) => !summaryShown || !c.summary.includes(item);
  const warnings = c.notes.filter(fresh);
  if (c.status !== 'preview') return { card: warnings.length ? card(cardBody(note('warning', warnings))) : null, button: null };
  const hint = c.confirmHint || (canMessage() ? 'Not saved until you confirm.' : 'Not saved until you reply “confirm” in the chat.');
  const list = h('ul', { class: 'list' }, warnings.map(warnItem), c.consequences.filter(fresh).map((w) => h('li', null, w)), h('li', null, hint));
  const flag = warnings.length
    ? h('span', { class: 'summary-warn', html: WARNING_ICON, role: 'img', 'aria-label': plural(warnings.length, 'note'), title: plural(warnings.length, 'note') })
    : null;
  const title = ['When You Confirm', summary(`Reply “${replyWord(c)}”`), flag];
  return { card: card(cardBody(section(title, open, list))), button: canMessage() ? confirmButton(c, list) : null };
}

const replyWord = (c) => (c.number ? `confirm ${c.number}` : 'confirm');

const canMessage = () => Boolean(state.host.capabilities && state.host.capabilities.message);

// Posts a reply for the user in hosts that accept messages from the card. `settles` is what stops moving once sent.
function replyButton(label, text, settles, onRefused) {
  const button = h('button', { class: 'btn brand', type: 'button' }, label);
  button.addEventListener('click', async () => {
    settles(button).classList.add('settled');
    button.disabled = true;
    try {
      await request('ui/message', { role: 'user', content: [{ type: 'text', text }] });
      button.textContent = 'Sent to chat';
    } catch {
      button.disabled = false;
      onRefused(button);
    }
  });
  return button;
}

const optionOrRoot = (button) => button.closest('.batch-item') || document.getElementById('root');
const refusedNote = (reply) => warnItem(`The chat didn’t accept the message. Reply “${reply}” instead.`);

function confirmButton(c, list) {
  const reply = replyWord(c);
  const text = `${reply}: ${c.number ? eyebrowOf(c.label, c.title) : eyebrowOf(c.action, c.title, c.subtitle)}`;
  return replyButton('Confirm', text, optionOrRoot, () => list.append(refusedNote(reply)));
}

// Options for one request, such as the same quote with different support. Each
// quote's own header is the toggle; every option starts collapsed, showing only
// that header, and in created mode also the header of what submitting it triggers.
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const orList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : items[0]);

function collapsible(item) {
  item.classList.add('batch-item');
  const header = item.querySelector('.page-header');
  if (!header) return item;
  const toggle = h('button', { class: 'collapse-toggle', type: 'button' });
  const setOpen = (value) => {
    item.classList.toggle('collapsed', !value);
    toggle.setAttribute('aria-expanded', String(value));
    toggle.setAttribute('aria-label', value ? 'Collapse quote' : 'Expand quote');
  };
  header.classList.add('toggles');
  header.append(toggle);
  header.addEventListener('click', () => setOpen(item.classList.contains('collapsed')));
  const triggers = item.querySelector(':scope > .triggers summary');
  if (triggers) {
    triggers.addEventListener('click', (e) => {
      if (!item.classList.contains('collapsed')) return;
      e.preventDefault();
      triggers.parentElement.open = true;
      setOpen(true);
    });
  }
  setOpen(false);
  return item;
}

function moreQuotes(hidden, saved) {
  if (hidden <= 0) return null;
  const text = saved ? `${plural(hidden, 'more quote')} not shown.` : `${plural(hidden, 'more quote')} not shown. Ask for ${hidden === 1 ? 'it' : 'them'} in a new request.`;
  return card(h('div', { class: 'card-footer center' }, text));
}

const refusedLine = (reply) => (button) =>
  button.parentElement.prepend(h('span', { class: 'small muted' }, `The chat didn’t accept the message. Reply “${reply}” instead.`));

function confirmAllBar(options) {
  if (options.length < 2 || !canMessage()) return null;
  const root = () => document.getElementById('root');
  return h('div', { class: 'actions' }, replyButton('Confirm all', `confirm all: ${plural(options.length, 'quote')}`, root, refusedLine('confirm all')));
}

// A saved quote: its number links to it, and what submitting it triggers stays in view.
function savedQuoteCard(c) {
  const name = c.subtitle ? `${c.recordType} ${c.subtitle}` : `Open ${c.recordType.toLowerCase()}`;
  const link = c.url
    ? h('a', { class: 'record-link', href: '#', title: c.url, onclick: (e) => (e.preventDefault(), e.stopPropagation(), openLink(c.url)) }, name)
    : c.subtitle
      ? name
      : null;
  const eyebrow = [eyebrowOf(`Option ${c.number}`, c.label), link ? ' · ' : null, link];
  const reply = `submit ${c.number}`;
  const submitHint = `Reply “${reply}” to make this the primary quote and submit it for approval.`;
  const submit = canMessage() ? replyButton('Submit', `${reply}: ${eyebrowOf(c.label, c.title)}`, optionOrRoot, refusedLine(reply)) : null;
  if (submit) submit.setAttribute('aria-label', `Make option ${c.number} the primary quote and submit it`);
  return recordView({ ...c, eyebrow, submitHint }, { actions: [submit] });
}

// A quote that would be created, drawn like the quote card. Collapsed, its header still
// says what it leaves out next to the other options; open, it shows its products and
// what confirming it does.
function previewOptionCard(o) {
  if (!hasLines(o.lines) || o.lines.style !== 'items') return quoteChangeCard(o);
  const items = o.lines.items;
  const missing = o.missing || [];
  const meta = h('div', { class: 'option-meta' }, h('span', null, plural(items.length, 'product')), missing.map((m) => h('span', { class: 'chip missing' }, m)));
  const header = card(pageHeader(icon(objectIconName(o.recordType)), o.eyebrow, o.title, null, meta));
  const list = itemList(items);
  missing.forEach((m) => list.append(h('div', { class: 'line-row missing' }, h('div', { class: 'line-name' }, m))));
  const title = [o.lines.title, summary(plural(items.length, 'item'), totalSummary(o.totals))];
  const products = card(cardBody(section(title, true, list, totalsRow(o.totals, true), o.lines.note ? h('p', { class: 'footnote' }, o.lines.note) : null)));
  const confirm = confirmSection(o, false, true);
  const node = stack(withFooters([header, products, confirm.card], footerLine(o.footerNote)), actionBar(linkButton(o.url), extraButtons(o.links), confirm.button));
  node.replaceChildren(aiFrame('Creating new quote', [...node.childNodes]));
  return node;
}

function confirmPrompt(options) {
  const replies = orList(options.map((o) => `“confirm ${o.number}”`));
  const text = options.length === 1 ? `Reply ${replies} to save it.` : `Reply ${replies} for one, or “confirm all”.`;
  return card(cardBody(h('p', { class: 'lead prompt' }, text)));
}

function quoteOptionsCard(c) {
  if (c.mode === 'created') {
    const rows = c.options.map((o) => collapsible(savedQuoteCard(o)));
    return h('div', { class: 'stack batch' }, rows, moreQuotes(c.more, true));
  }
  const rows = c.options.map((o) => collapsible(previewOptionCard({ ...o, eyebrow: eyebrowOf(`Option ${o.number}`, o.label) })));
  return h('div', { class: 'stack batch' }, confirmPrompt(c.options), rows, moreQuotes(c.more, false), confirmAllBar(c.options));
}

// A successful save shows the record as it is now, with nothing marking the save.
const plainLines = (lines) =>
  lines && (lines.style === 'items' ? { ...lines, items: lines.items.map((l) => ({ ...l, state: 'existing' })) } : { ...lines, rows: lines.rows.map((r) => ({ ...r, added: false })) });

function writeResultCard(c) {
  return recordView({ ...c, kind: 'record', highlights: c.details, details: [], stage: undefined, lines: plainLines(c.lines), notes: [], otherRecords: 0 });
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
  if (drawsNothing(model)) {
    renderNothing();
    document.body.dataset.rendered = model.kind;
    return;
  }
  document.documentElement.classList.remove('is-empty');
  const root = document.getElementById('root');
  let node;
  try {
    const draw = { record: recordCard, 'quote-change': quoteChangeCard, 'quote-options': quoteOptionsCard }[model.kind] || writeResultCard;
    node = draw(model);
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

// ---------- capped hosts ----------
// The card always reports its full height. A host that caps the frame, say at
// one open option and the next header, scrolls it inside, so while there's more
// below, the bottom edge fades and a button scrolls down.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const fade = h('div', { class: 'scroll-fade', 'aria-hidden': 'true' });
const scrollButton = h(
  'button',
  { class: 'scroll-more', type: 'button', 'aria-label': 'Scroll down', onclick: () => window.scrollTo({ top: nextStop(), behavior: reducedMotion.matches ? 'auto' : 'smooth' }) },
  h('span', { class: 'chip-icon', html: CHEVRON_DOWN, 'aria-hidden': 'true' }),
  'Scroll down',
);
document.body.append(fade, scrollButton);

const bottomOf = () => document.documentElement.scrollHeight - window.innerHeight;
const moreBelow = () => bottomOf() - window.scrollY > 2;

// The next option's top, so the button brings it into view; past the last one, the bottom.
// An option that starts in the top quarter of the view is the one being read, not the next.
function nextStop() {
  const y = window.scrollY;
  const tops = [...document.querySelectorAll('#root .batch-item')].map((el) => Math.floor(el.getBoundingClientRect().top + y - 10));
  const next = tops.find((top) => top > y + window.innerHeight / 4);
  return Math.min(next === undefined ? bottomOf() : next, bottomOf());
}

// A host that isn't capped grows the frame a moment after the card grows, so the
// cue waits briefly before showing and never flashes there; it hides at once.
let showTimer;
function updateScrollCue() {
  clearTimeout(showTimer);
  if (!moreBelow()) {
    document.body.classList.remove('has-more');
    return;
  }
  showTimer = setTimeout(() => document.body.classList.toggle('has-more', moreBelow()), 250);
}
window.addEventListener('scroll', updateScrollCue, { passive: true });
window.addEventListener('resize', updateScrollCue);

// scrollHeight never drops below the iframe's current height, so collapsing a
// section would never shrink the frame; the root element's own height does.
// Some hosts ignore a height of 0 and keep the frame's last height, so a card
// that draws nothing reports 1px.
new ResizeObserver(() => {
  const el = document.documentElement;
  notify('ui/notifications/size-changed', { width: el.scrollWidth, height: Math.max(1, Math.ceil(el.getBoundingClientRect().height)) });
  updateScrollCue();
}).observe(document.documentElement);

start();
