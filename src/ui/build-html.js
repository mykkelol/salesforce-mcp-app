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

// The CSP only allows data: images, so the background and icons are inlined.
const imageDataUri = (...p) => {
  const type = p.at(-1).endsWith('.jpg') ? 'jpeg' : 'png';
  return `data:image/${type};base64,${readFileSync(join(here, ...p)).toString('base64')}`;
};

export function buildCardHtml(kind, { title, version }) {
  const js = [...SHARED_MODULES.map((m) => inlineModule(read(m))), inlineModule(read('card-app.js'))].join('\n;\n');
  const script = `(function () {\n'use strict';\n${js}\n})();`.replace(/<\/script/gi, '<\\/script');
  const css = read('card.css')
    .replace('__BACKGROUND__', () => imageDataUri('lightning-bg.jpg'))
    .replace(/__ICON_(\w+)__/g, (_, name) => imageDataUri('icons', `${name}.png`));
  return read('card.html')
    .replace('__TITLE__', title)
    .replace('__CSS__', () => css)
    .replace('__KIND__', kind)
    .replace('__VERSION__', version)
    .replace('__JS__', () => script);
}
