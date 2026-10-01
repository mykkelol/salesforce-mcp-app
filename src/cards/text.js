// Compact text versions of each card. They are the tool's text result, which is
// what chat surfaces without MCP Apps show, so they avoid Markdown tables and
// stay readable as plain text.

import { markdownToTextLines } from './markdown.js';

const join = (items) => items.filter(Boolean).join(' · ');
const pairs = (list, max = 6) => join(list.slice(0, max).map((f) => `${f.label}: ${f.value}`));
const headline = (card) => [card.title, card.subtitle].filter(Boolean).join(' · ');

function linesText(lines, max = 5) {
  if (!lines || !lines.rows.length) return [];
  const shown = lines.rows.slice(0, max).map((r) => {
    const [first, ...rest] = r.cells;
    const extras = rest
      .map((value, i) => [lines.columns[i + 1].label, value])
      .filter(([, value]) => value && value !== '—')
      .slice(0, 3)
      .map(([label, value]) => `${label} ${value}`);
    return `${r.added ? 'New: ' : ''}${first}${extras.length ? ` (${extras.join(', ')})` : ''}`;
  });
  const more = lines.rows.length > max ? `; +${lines.rows.length - max} more` : '';
  return [`${lines.title} (${lines.rows.length}): ${shown.join('; ')}${more}`, lines.note].filter(Boolean);
}

const notes = (card) => card.notes.map((n) => `Note: ${n}`);

export function recordText(card) {
  if (card.error) return `Couldn't show a card: ${card.error}`;
  const out = [`${card.recordType}: ${headline(card)}`];
  if (card.stage) out.push(`Stage: ${card.stage.current}`);
  if (card.highlights.length) out.push(pairs(card.highlights, 8));
  if (card.details.length) out.push(pairs(card.details));
  out.push(...linesText(card.lines));
  if (card.totals.length) out.push(pairs(card.totals));
  out.push(...notes(card), card.footerNote, card.url);
  return out.filter(Boolean).join('\n');
}

export function quoteChangeText(card) {
  const head = headline(card);
  if (card.status === 'rejected') {
    return [`Not saved. ${head ? `${head} was refused.` : 'The change was refused.'}`, card.message].filter(Boolean).join('\n');
  }
  if (card.status === 'needs-input') {
    return [`Not saved yet. ${head ? `${head} needs more input.` : 'More input is needed.'}`, card.message].filter(Boolean).join('\n');
  }
  const out = [`Preview, not saved.${head ? ` ${head}` : ''}`];
  if (card.summary) out.push(...markdownToTextLines(card.summary).slice(0, 14));
  else if (card.message) out.push(card.message);
  out.push(...card.changes.map((c) => `${c.label}: ${c.before} → ${c.after}`));
  out.push(...linesText(card.lines));
  if (card.totals.length) out.push(`Totals: ${pairs(card.totals)}`);
  if (card.details.length) out.push(pairs(card.details));
  out.push(...notes(card), card.confirmHint || 'Reply "confirm" to save it.', card.footerNote);
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
