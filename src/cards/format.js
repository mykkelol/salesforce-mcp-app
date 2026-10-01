// Display helpers shared by the server (text version) and the card (HTML).
// Plain functions only: this file is also inlined into the card's HTML.

export const VALUE_TYPES = ['text', 'number', 'currency', 'percent', 'date', 'datetime', 'boolean', 'url'];

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return s;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function formatDateTime(s) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  const d = new Date(t);
  const h = d.getUTCHours();
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${h12}:${mm} ${h < 12 ? 'AM' : 'PM'} UTC`;
}

function trimNumber(n) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6)));
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

function detectType(value) {
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime';
  }
  return 'text';
}

export const isEmpty = (v) => v === undefined || v === null || v === '';

export function formatValue(value, type, currency) {
  if (isEmpty(value)) return '—';
  if (Array.isArray(value)) return value.map((v) => formatValue(v, type, currency)).join(', ');
  if (isPlainObject(value)) return typeof value.Name === 'string' ? value.Name : JSON.stringify(value);
  const kind = VALUE_TYPES.includes(type) ? type : detectType(value);
  const n = toNumber(value);
  switch (kind) {
    case 'boolean':
      if (value === true || value === 'true') return 'Yes';
      if (value === false || value === 'false') return 'No';
      return String(value);
    case 'percent':
      return n === undefined ? String(value) : `${trimNumber(n)}%`;
    case 'currency':
      if (n === undefined) return String(value);
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: currency || 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        }).format(n);
      } catch {
        return trimNumber(n);
      }
    case 'number':
      if (n === undefined) return String(value);
      return Number.isInteger(n) ? n.toLocaleString('en-US') : trimNumber(n);
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? formatDate(value) : String(value);
    case 'datetime':
      return typeof value === 'string' ? formatDateTime(value) : String(value);
    default: {
      const s = String(value);
      return s.length > 600 ? `${s.slice(0, 597)}…` : s;
    }
  }
}

export const isNumericType = (type) => type === 'number' || type === 'currency' || type === 'percent';

export function safeHttpsUrl(url) {
  if (typeof url !== 'string') return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

export function lightningRecordUrl(instanceUrl, recordType, id) {
  const base = safeHttpsUrl(instanceUrl);
  if (!base || !recordType || typeof id !== 'string' || !/^[A-Za-z0-9]{15,18}$/.test(id)) return undefined;
  return `${new URL(base).origin}/lightning/r/${encodeURIComponent(recordType)}/${id}/view`;
}
