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
      if (sc && sc.kind === KIND) renderFrom(sc, 'result');
      else if (state.input) renderFrom(buildCard(KIND, state.input), 'input');
      break;
    }
    case 'ui/notifications/tool-cancelled':
      if (!state.card) renderMessage('The tool call was cancelled.');
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
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICONS = {
  account: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M5 20V5h8v15M13 10h6v10M3 20h18M8 8h2M8 12h2M8 16h2M16 13h1M16 16h1"/></svg>',
  opportunity: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M4 8l4 4 4-6 4 6 4-4-2 10H6z"/></svg>',
  quote: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5"/></svg>',
  change: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  failed: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  record: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="5" y="4" width="14" height="16" rx="1"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>',
};

function icon(name, extraClass) {
  const key = ICONS[name] ? name : 'record';
  return h('div', { class: `obj-icon ${name}${extraClass ? ` ${extraClass}` : ''}`, html: ICONS[key], 'aria-hidden': 'true' });
}

const objectIconName = (type) => (/^(Account|Opportunity|Quote)$/.test(type || '') ? type.toLowerCase() : 'record');

function field(label, value) {
  return h('div', null, h('div', { class: 'field-label' }, label), h('div', { class: 'field-value' }, value));
}

function shortStage(name) {
  const numbered = /^(\d+)\s*-/.exec(name);
  if (numbered) return numbered[1];
  if (/^closed won$/i.test(name)) return 'Won';
  if (/^closed lost$/i.test(name)) return 'Lost';
  return String(name).split(/\s+/)[0];
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

function linkButton(url, label) {
  if (!url) return null;
  return h('button', { class: 'btn', type: 'button', onclick: () => openLink(url) }, label || 'Open in Salesforce');
}

function extraLinks(links) {
  if (!links || !links.length) return null;
  const items = links.map((l) => {
    const open = (e) => {
      e.preventDefault();
      openLink(l.url);
    };
    return h('a', { class: 'link', href: '#', onclick: open }, l.label);
  });
  return h('div', { class: 'section links' }, items);
}

function heading(c) {
  return [c.title, c.subtitle].filter(Boolean).join(' · ');
}

function header(iconNode, eyebrow, title, actions) {
  return h(
    'div',
    { class: 'card-header' },
    iconNode,
    h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, eyebrow), h('div', { class: 'title' }, title)),
    h('div', { class: 'header-actions' }, actions),
  );
}

function linesSection(lines, extras) {
  if (!lines || !lines.rows.length) return null;
  const head = h('tr', null, lines.columns.map((col) => h('th', { class: col.numeric ? 'num' : undefined }, col.label)));
  const rows = lines.rows.map((r) =>
    h(
      'tr',
      { class: r.added ? 'added' : undefined },
      r.cells.map((cell, i) =>
        h(
          'td',
          { class: lines.columns[i].numeric ? 'num' : undefined },
          i === 0 && r.added ? [h('span', { class: 'badge success' }, 'New'), ' '] : null,
          cell,
        ),
      ),
    ),
  );
  const count = lines.newCount ? `${lines.count} now + ${lines.newCount} new` : `${lines.count}`;
  return h(
    'div',
    { class: 'section' },
    h('div', { class: 'section-title' }, lines.title, h('span', { class: 'badge neutral' }, count)),
    h('table', { class: 'data' }, h('thead', null, head), h('tbody', null, rows)),
    extras,
    lines.note ? h('p', { class: 'muted' }, lines.note) : null,
  );
}

function totalsRow(totals) {
  if (!totals || !totals.length) return null;
  return h('div', { class: 'totals' }, totals.map((t) => field(t.label, t.value)));
}

function detailsSection(details, title) {
  if (!details || !details.length) return null;
  return h(
    'div',
    { class: 'section' },
    title ? h('div', { class: 'section-title' }, title) : null,
    h('div', { class: 'details' }, details.map((f) => h('div', { class: 'detail' }, field(f.label, f.value)))),
  );
}

function notesSection(notes) {
  if (!notes || !notes.length) return null;
  return h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Notes'), h('ul', { class: 'list' }, notes.map((n) => h('li', null, n))));
}

function footer(left, url) {
  if (!left && !url) return null;
  return h('div', { class: 'footer' }, h('span', null, left || ''), url ? h('span', { class: 'url', title: url }, url) : null);
}

// ---------- cards ----------
function recordCard(c) {
  if (c.error) return h('div', { class: 'card' }, h('div', { class: 'empty' }, c.error));
  const parts = [header(icon(objectIconName(c.recordType)), c.recordType, heading(c), linkButton(c.url))];
  if (c.highlights.length) parts.push(h('div', { class: 'highlights' }, c.highlights.map((f) => field(f.label, f.value))));
  if (c.stage) {
    const step = (name, stateName) =>
      h('div', { class: `path-step ${stateName}`, title: name }, h('span', { class: 'full' }, name), h('span', { class: 'short' }, shortStage(name)));
    const steps = c.stage.steps.map((s) => step(s.name, s.state));
    if (c.stage.offPath) steps.push(step(c.stage.current, 'current'));
    parts.push(h('div', { class: 'path', role: 'list' }, steps));
  }
  const lines = linesSection(c.lines, totalsRow(c.totals));
  if (lines) parts.push(lines);
  else if (c.totals.length) parts.push(h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Totals'), totalsRow(c.totals)));
  parts.push(detailsSection(c.details, 'Details'), notesSection(c.notes), extraLinks(c.links), footer(c.footerNote, c.url));
  return h('div', { class: 'card' }, parts);
}

function statusBadge(status) {
  if (status === 'preview') return h('span', { class: 'badge warning' }, 'Preview · not saved');
  if (status === 'needs-input') return h('span', { class: 'badge info' }, 'Needs input');
  if (status === 'rejected') return h('span', { class: 'badge error' }, 'Refused · not saved');
  return h('span', { class: 'badge neutral' }, 'Not saved');
}

function quoteChangeCard(c) {
  const parts = [header(icon('change'), `${c.recordType} change`, heading(c), statusBadge(c.status))];
  if (c.status === 'rejected' || c.status === 'needs-input') {
    const lead = c.status === 'rejected' ? 'The change was refused.' : 'More input needed.';
    parts.push(h('div', { class: `banner ${c.status === 'rejected' ? 'error' : 'info'}` }, h('strong', null, lead), ' ', c.message || ''));
  } else {
    const source = c.summary ? 'This is the preview the tool returned.' : 'These are the proposed changes.';
    parts.push(h('div', { class: 'banner warning' }, h('strong', null, 'Nothing has been saved.'), ' ', `${source} Saving needs your confirmation.`));
  }
  if (c.summary) parts.push(h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Proposed change'), h('div', { class: 'md', html: markdownToHtml(c.summary) })));
  else if (c.message && c.status === 'preview') parts.push(h('div', { class: 'section' }, h('p', null, c.message)));
  if (c.changes.length) {
    const rows = c.changes.flatMap((d) => [
      h('div', { class: 'field-label' }, d.label),
      h('div', null, h('span', { class: 'before' }, d.before), h('span', { class: 'arrow' }, '→'), h('span', { class: 'after' }, d.after)),
    ]);
    parts.push(h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Before → after'), h('div', { class: 'diff' }, rows)));
  }
  const lines = linesSection(c.lines, totalsRow(c.totals));
  if (lines) parts.push(lines);
  else if (c.totals.length) parts.push(h('div', { class: 'section' }, h('div', { class: 'section-title' }, 'Totals'), totalsRow(c.totals)));
  parts.push(detailsSection(c.details), notesSection(c.notes));
  if (c.status === 'preview') parts.push(confirmBox(c));
  parts.push(extraLinks(c.links), footer(c.footerNote || (c.status === 'preview' ? 'Preview' : 'Nothing was saved'), c.url));
  return h('div', { class: 'card' }, parts);
}

function confirmBox(c) {
  const canMessage = Boolean(state.host.capabilities && state.host.capabilities.message);
  const typed = c.confirmHint || 'To save, reply “confirm” in the chat.';
  const hint = h('span', { class: 'hint' }, canMessage ? 'Ready to save? Confirming posts "confirm" to the chat.' : typed);
  if (!canMessage) return h('div', { class: 'confirm' }, hint);
  const button = h('button', { class: 'btn brand', type: 'button' }, 'Confirm');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await request('ui/message', { role: 'user', content: [{ type: 'text', text: `confirm: ${heading(c)}` }] });
      hint.textContent = 'Sent “confirm” to the chat.';
    } catch {
      button.disabled = false;
      hint.textContent = `The chat didn’t accept the message. ${typed}`;
    }
  });
  return h('div', { class: 'confirm' }, hint, button);
}

function writeResultCard(c) {
  const failed = c.status === 'failed';
  const saved = c.status === 'saved';
  const badge = saved
    ? h('span', { class: 'badge success' }, 'Saved')
    : failed
      ? h('span', { class: 'badge error' }, 'Not saved')
      : h('span', { class: 'badge neutral' }, c.status === 'not-saved' ? 'Not saved yet' : 'Result');
  const parts = [
    header(icon(failed ? 'failed' : 'ok', failed ? 'result failed' : 'result'), [c.recordType, c.subtitle].filter(Boolean).join(' · '), c.title, [
      badge,
      linkButton(c.url),
    ]),
  ];
  if (c.message) parts.push(h('div', { class: `banner ${failed ? 'error' : saved ? 'success' : 'info'}` }, c.message));
  if (c.pendingNote) parts.push(h('div', { class: 'banner info' }, c.pendingNote));
  if (c.details.length) parts.push(h('div', { class: 'highlights' }, c.details.map((f) => field(f.label, f.value))));
  parts.push(extraLinks(c.links));
  const lines = linesSection(c.lines, totalsRow(c.totals));
  if (lines) parts.push(lines);
  else if (c.totals.length) parts.push(h('div', { class: 'section' }, totalsRow(c.totals)));
  parts.push(notesSection(c.notes), footer(c.footerNote || (saved ? 'Saved in Salesforce' : 'Result from Salesforce'), c.url));
  return h('div', { class: 'card' }, parts);
}

// ---------- render ----------
function renderMessage(text) {
  document.getElementById('root').replaceChildren(h('div', { class: 'card' }, h('div', { class: 'empty' }, text)));
}

function render(card) {
  const root = document.getElementById('root');
  let node;
  try {
    node = card.kind === 'record' ? recordCard(card) : card.kind === 'quote-change' ? quoteChangeCard(card) : writeResultCard(card);
  } catch (err) {
    node = h('div', { class: 'card' }, h('div', { class: 'empty' }, `Couldn't draw this card: ${err && err.message ? err.message : err}`));
  }
  root.replaceChildren(node);
  document.body.dataset.rendered = card.kind;
}

function renderFrom(card, source) {
  state.card = card;
  document.body.dataset.source = source;
  render(card);
}

new ResizeObserver(() => {
  const el = document.documentElement;
  notify('ui/notifications/size-changed', { width: el.scrollWidth, height: el.scrollHeight });
}).observe(document.documentElement);

start();
