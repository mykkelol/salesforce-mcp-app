// Compact text versions of each card. They are the tool's text result, which is
// what chat surfaces without MCP Apps show, so they avoid Markdown tables and
// stay readable as plain text.

import { markdownToTextLines } from './markdown.js';

const join = (items) => items.filter(Boolean).join(' · ');
const pairs = (list, max = 6) => join(list.slice(0, max).map((f) => `${f.label}: ${f.value}`));
const headline = (card) => [card.title, card.subtitle].filter(Boolean).join(' · ');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number);
  return y && m && d ? `${MONTHS[m - 1]} ${d}, ${y}` : String(iso);
};

function itemText(l) {
  const parts = [];
  if (l.quantity && (l.price || l.listPrice)) parts.push(`${l.quantity} × ${l.price || l.listPrice}`);
  else if (l.quantity) parts.push(`Qty ${l.quantity}`);
  if (l.total) parts.push(l.total === 'Pending' ? 'total pending' : l.total);
  if (l.discount && l.discount !== '0%') parts.push(`${l.discount} off`);
  if (l.term) parts.push(`${l.term} mo`);
  if (l.start && l.end) parts.push(`${longDate(l.start)} – ${longDate(l.end)}`);
  const tag = l.state === 'added' || l.state === 'suggested' ? 'New: ' : '';
  return `${tag}${l.name}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

function rowText(lines, r) {
  const [first, ...rest] = r.cells;
  const extras = rest
    .map((value, i) => [lines.columns[i + 1].label, value])
    .filter(([, value]) => value && value !== '—')
    .slice(0, 3)
    .map(([label, value]) => `${label} ${value}`);
  return `${r.added ? 'New: ' : ''}${first}${extras.length ? ` (${extras.join(', ')})` : ''}`;
}

function linesText(lines, max = 5) {
  if (!lines) return [];
  const all = lines.style === 'items' ? lines.items.map(itemText) : lines.rows.map((r) => rowText(lines, r));
  if (!all.length) return [];
  const more = all.length > max ? `; +${all.length - max} more` : '';
  return [`${lines.title} (${all.length}): ${all.slice(0, max).join('; ')}${more}`, lines.note].filter(Boolean);
}

const notes = (card) => card.notes.map((n) => `Note: ${n}`);
const fieldText = (f) => (f.change ? `${f.label}: ${f.change.before} → ${f.change.after}` : `${f.label}: ${f.value}`);

export function recordText(card) {
  if (card.error) return `Couldn't show a card: ${card.error}`;
  const out = [`${card.recordType}: ${headline(card)}`];
  if (card.stage) out.push(`Stage: ${card.stage.current}`);
  if (card.highlights.length) out.push(pairs(card.highlights, 8));
  if (card.details.length) out.push(pairs(card.details));
  out.push(...linesText(card.lines));
  if (card.totals.length) out.push(pairs(card.totals));
  if (card.otherRecords) out.push(`Showing 1 of ${card.otherRecords + 1} matching records.`);
  out.push(...notes(card), card.footerNote, card.url);
  return out.filter(Boolean).join('\n');
}

export function quoteChangeText(card) {
  const head = join([card.action, headline(card) !== card.action ? headline(card) : undefined]);
  if (card.status === 'rejected') {
    return [`Not saved. ${head ? `${head} was refused.` : 'The change was refused.'}`, card.message].filter(Boolean).join('\n');
  }
  if (card.status === 'needs-input') {
    return [`Not saved yet. ${head ? `${head} needs more input.` : 'More input is needed.'}`, card.message].filter(Boolean).join('\n');
  }
  const out = [`Preview, not saved.${head ? ` ${head}` : ''}`];
  if (card.summary) out.push(...markdownToTextLines(card.summary).slice(0, 14));
  else if (card.message) out.push(card.message);
  const shownFields = [...card.highlights, ...card.details];
  out.push(...card.changes.map((c) => `${c.label}: ${c.before} → ${c.after}`));
  if (!card.summary && shownFields.length) out.push(join(shownFields.filter((f) => !f.change).slice(0, 8).map(fieldText)));
  out.push(...linesText(card.lines));
  if (card.totals.length) out.push(`Totals: ${pairs(card.totals)}`);
  const fresh = (item) => !card.summary || !card.summary.includes(item);
  out.push(...card.consequences.filter(fresh).map((c) => `When you confirm: ${c}`));
  out.push(...card.notes.filter(fresh).map((n) => `Note: ${n}`), card.confirmHint || 'Reply "confirm" to save it.', card.footerNote);
  return out.filter(Boolean).join('\n');
}

export function writeResultText(card) {
  const head = headline(card);
  const prefix = { saved: 'Saved', failed: 'Not saved', 'not-saved': 'Not saved yet' }[card.status] || 'Result';
  const out = [`${prefix}: ${card.recordType}${head ? ` ${head}` : ''}`, card.message, card.pendingNote];
  if (card.details.length) out.push(pairs(card.details));
  out.push(...linesText(card.lines));
  if (card.totals.length) out.push(pairs(card.totals));
  out.push(...notes(card), card.footerNote, card.url);
  return out.filter(Boolean).join('\n');
}

export function cardText(card) {
  if (card.kind === 'record') return recordText(card);
  if (card.kind === 'quote-change') return quoteChangeText(card);
  return writeResultText(card);
}
