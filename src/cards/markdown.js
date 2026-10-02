// A small Markdown subset for a tool's preview text: headings, paragraphs,
// lists, pipe tables, bold, italics with *, inline code, and https links.
// Everything is escaped first, so the output never carries raw HTML.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineHtml(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, (_, label, href) => `<a href="#" data-url="${href}">${label}</a>`);
  return s;
}

function inlineText(text) {
  return String(text)
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .trim();
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

const isTableSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

export function parseBlocks(md) {
  const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

export function markdownToHtml(md) {
  return parseBlocks(md)
    .map((b) => {
      switch (b.type) {
        case 'heading':
          return `<p class="md-heading">${inlineHtml(b.text)}</p>`;
        case 'list': {
          const tag = b.ordered ? 'ol' : 'ul';
          return `<${tag}>${b.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</${tag}>`;
        }
        case 'table': {
          const head = `<tr>${b.header.map((h) => `<th>${inlineHtml(h)}</th>`).join('')}</tr>`;
          const body = b.rows
            .map((r) => `<tr>${b.header.map((_, j) => `<td>${inlineHtml(r[j] ?? '')}</td>`).join('')}</tr>`)
            .join('');
          return `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>`;
        }
        case 'rule':
          return '<hr>';
        default:
          return `<p>${inlineHtml(b.text)}</p>`;
      }
    })
    .join('');
}

export function markdownToTextLines(md) {
  const out = [];
  for (const b of parseBlocks(md)) {
    if (b.type === 'heading' || b.type === 'paragraph') out.push(inlineText(b.text));
    else if (b.type === 'list') b.items.forEach((it) => out.push(`• ${inlineText(it)}`));
    else if (b.type === 'table') {
      const header = b.header.map(inlineText);
      const keyValue =
        header.length === 2 && /^(field|item|detail|name|)$/i.test(header[0]) && /^(value|details?|)$/i.test(header[1]);
      if (keyValue) {
        out.push(b.rows.map((r) => `${inlineText(r[0] ?? '')}: ${inlineText(r[1] ?? '')}`).join(' · '));
      } else {
        b.rows.forEach((r) =>
          out.push(
            header
              .map((h, j) => [h, inlineText(r[j] ?? '')])
              .filter(([, v]) => v)
              .map(([h, v]) => (h ? `${h}: ${v}` : v))
              .join(' · '),
          ),
        );
      }
    }
  }
  return out.filter(Boolean);
}
