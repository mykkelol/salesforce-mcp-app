import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(here, ...p), 'utf8');

const SHARED_MODULES = ['../cards/format.js', '../cards/markdown.js', '../cards/normalize.js'];

// The card ships as one HTML document: our modules are concatenated into a
// single classic script, so the card loads nothing at runtime.
function inlineModule(source) {
  return source
    .split('\n')
    .filter((line) => !/^\s*import\s.+from\s+['"].+['"];?\s*$/.test(line))
    .map((line) => line.replace(/^export\s+(?=(async\s+)?function|const|let|class)/, ''))
    .join('\n');
}

export function buildCardHtml(kind, { title, version }) {
  const js = [...SHARED_MODULES.map((m) => inlineModule(read(m))), inlineModule(read('card-app.js'))].join('\n;\n');
  const script = `(function () {\n'use strict';\n${js}\n})();`.replace(/<\/script/gi, '<\\/script');
  return read('card.html')
    .replace('__TITLE__', title)
    .replace('__CSS__', () => read('card.css'))
    .replace('__KIND__', kind)
    .replace('__VERSION__', version)
    .replace('__JS__', () => script);
}
