// A stand-in MCP Apps host: mounts the card in a sandboxed iframe and speaks the
// same postMessage JSON-RPC a chat client would.

import { buildCard } from '/cards/normalize.js';
import { cardText } from '/cards/text.js';
import { FIXTURES, TOOL_FOR_KIND } from './fixtures.js';

const WIDTHS = { 360: 'Narrow 360', 560: 'Medium 560', 760: 'Wide 760', full: 'Full' };
const MODES = { result: 'Tool result', input: 'Input only', cancelled: 'Cancelled' };

const params = new URLSearchParams(location.hash.slice(1));
const state = {
  fixture: params.get('f') || FIXTURES[0].id,
  width: params.get('w') || '560',
  mode: params.get('mode') || 'result',
  message: params.get('msg') !== '0',
  links: params.get('links') !== '0',
};

const $ = (id) => document.getElementById(id);
const logEl = $('log');
let frame;

function saveHash() {
  const p = new URLSearchParams({ f: state.fixture, w: state.width, mode: state.mode, msg: state.message ? '1' : '0', links: state.links ? '1' : '0' });
  history.replaceState(null, '', `#${p}`);
}

function log(line) {
  const t = new Date().toLocaleTimeString([], { hour12: false });
  logEl.textContent = `${t}  ${line}\n${logEl.textContent}`;
}

function segmented(el, options, key) {
  el.replaceChildren(
    ...Object.entries(options).map(([value, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = state[key] === value ? 'on' : '';
      b.onclick = () => {
        state[key] = value;
        renderControls();
        mount();
      };
      return b;
    }),
  );
}

function renderControls() {
  const nav = $('fixtures');
  nav.replaceChildren();
  let group;
  for (const f of FIXTURES) {
    if (f.group !== group) {
      group = f.group;
      const h = document.createElement('h2');
      h.textContent = group;
      nav.append(h);
    }
    const b = document.createElement('button');
    b.textContent = f.label;
    b.className = f.id === state.fixture ? 'active' : '';
    b.onclick = () => {
      state.fixture = f.id;
      renderControls();
      mount();
    };
    nav.append(b);
  }
  segmented($('widths'), WIDTHS, 'width');
  segmented($('modes'), MODES, 'mode');
  $('cap-message').checked = state.message;
  $('cap-links').checked = state.links;
  document.body.style.setProperty('--card-width', state.width === 'full' ? 'none' : `${state.width}px`);
  saveHash();
}

$('cap-message').onchange = (e) => {
  state.message = e.target.checked;
  renderControls();
  mount();
};
$('cap-links').onchange = (e) => {
  state.links = e.target.checked;
  renderControls();
  mount();
};

function mount() {
  const fixture = FIXTURES.find((f) => f.id === state.fixture) || FIXTURES[0];
  const card = buildCard(fixture.kind, fixture.args);
  $('caption').textContent = `The assistant called ${TOOL_FOR_KIND[fixture.kind]} → ${fixture.kind} card · ${fixture.label}`;
  $('text').textContent = cardText(card);
  logEl.textContent = '';

  frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts allow-popups');
  frame.src = `/card/${fixture.kind}`;
  $('frame-slot').replaceChildren(frame);
  const target = frame;

  const send = (msg) => target.contentWindow && target.contentWindow.postMessage(msg, '*');
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });

  const onMessage = (event) => {
    if (event.source !== target.contentWindow) return;
    const msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    switch (msg.method) {
      case 'ui/initialize':
        reply(msg.id, {
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'card-preview', version: '0.0.0' },
          hostCapabilities: { ...(state.message ? { message: {} } : {}), ...(state.links ? { openLinks: {} } : {}) },
          hostContext: { theme: 'light', displayMode: 'inline', containerDimensions: { maxWidth: frame.clientWidth } },
        });
        break;
      case 'ui/notifications/initialized':
        $('status').textContent = 'Card initialized';
        send({ jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: fixture.args } });
        if (state.mode === 'result') {
          setTimeout(() => send({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: cardText(card) }], structuredContent: card } }), 250);
        } else if (state.mode === 'cancelled') {
          send({ jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled', params: { reason: 'user' } });
        }
        break;
      case 'ui/notifications/size-changed':
        target.style.height = `${msg.params.height}px`;
        break;
      case 'ui/message': {
        const text = (msg.params.content || []).map((c) => c.text).join(' ');
        log(`ui/message → chat: "${text}"`);
        reply(msg.id, {});
        break;
      }
      case 'ui/open-link':
        log(`ui/open-link → ${msg.params.url}`);
        window.open(msg.params.url, '_blank', 'noopener');
        reply(msg.id, {});
        break;
      default:
        if (msg.method) log(`${msg.method} ${JSON.stringify(msg.params || {})}`);
        if (msg.id !== undefined && msg.method) reply(msg.id, {});
    }
  };
  window.onmessage = onMessage;
}

new EventSource('/events').onmessage = () => location.reload();
window.addEventListener('hashchange', () => location.reload());

renderControls();
mount();
