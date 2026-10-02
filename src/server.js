import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { buildRecordCard, buildQuoteChangeCard, buildWriteResultCard } from './cards/normalize.js';
import { recordText, quoteChangeText, writeResultText } from './cards/text.js';
import { buildCardHtml } from './ui/build-html.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const NAME = 'salesforce-mcp-app';
export const VERSION = pkg.version;
export const MCP_APP_MIME = 'text/html;profile=mcp-app';
const MAX_INPUT_CHARS = 200_000;

export const CARD_URIS = {
  record: 'ui://salesforce-mcp-app/record-card-v2.html',
  'quote-change': 'ui://salesforce-mcp-app/quote-change-v2.html',
  'write-result': 'ui://salesforce-mcp-app/write-result-v2.html',
};

// Cards already in a chat point at these. They get the current card, which
// rebuilds an older card from its saved tool input.
// The card's images are inlined as data: URIs. Hosts that build the frame's CSP
// from resourceDomains (and default img-src to 'none') need data: listed.
const UI_META = { prefersBorder: false, csp: { resourceDomains: ['data:'] } };

const LEGACY_URIS = {
  record: 'ui://salesforce-mcp-app/record-card-v1.html',
  'quote-change': 'ui://salesforce-mcp-app/quote-change-v1.html',
  'write-result': 'ui://salesforce-mcp-app/write-result-v1.html',
};

const INSTRUCTIONS =
  'Render-only cards for Salesforce data. After a Salesforce tool returns data, call a card tool and pass that ' +
  'JSON unchanged as `record` (a read) or `result` (a write or preview). Point values at it with {"path": "Field"}, ' +
  'adding "from": "result" for the write or preview, instead of retyping numbers. Each tool returns a card plus a ' +
  'short text version you can send as your reply. These tools never read or change Salesforce: saving happens ' +
  'through your Salesforce tools, after the user confirms.';

const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const Ref = z
  .object({
    path: z.string().describe('Dot path into the JSON, for example "Account.Name" or "Lines.records".'),
    from: z.enum(['record', 'result']).optional().describe('Which JSON to read: "record" (default) or "result".'),
  })
  .describe('A reference to a value in `record` or `result`.');
const Val = z.union([z.string(), z.number(), z.boolean(), z.null(), Ref]);
const Text = z.union([Val, z.array(Val)]).describe('A value, a reference, or a list of them joined with " · ".');
const Notes = z.union([z.array(Val), Ref]);
const ValueType = z
  .enum(['text', 'number', 'currency', 'percent', 'date', 'datetime', 'boolean', 'url'])
  .describe('How to format the value. Percent values are whole numbers: 15 means 15%.');
const Field = z.object({ label: z.string(), value: Val, type: ValueType.optional(), currency: z.string().optional() });
const Total = Field.extend({ main: z.boolean().optional().describe('The headline total, shown in bold. Defaults to the last one.') });
const RowPath = z.string().optional();
const Lines = z
  .object({
    title: Text.optional(),
    rows: z.union([z.array(z.unknown()), Ref]).optional().describe('Row objects as returned, or a reference to them.'),
    item: z
      .object({
        name: z.string().describe('Path to the line name in each row, for example "Product2.Name".'),
        quantity: RowPath,
        price: RowPath.describe('Net unit price, shown as quantity × price.'),
        listPrice: RowPath.describe('List unit price; with a discount it shows as "15% off $100.00".'),
        discount: RowPath.describe('Discount percent.'),
        total: RowPath.describe('Line total. The literal "Pending" shows as being calculated.'),
        term: RowPath.describe('Term in months.'),
        start: RowPath.describe('Start date (YYYY-MM-DD).'),
        end: RowPath.describe('End date (YYYY-MM-DD).'),
        id: RowPath.describe('Path to the row id, used with `recordType` to link the line. Defaults to "Id".'),
        url: RowPath.describe('Path to an https link for the line.'),
      })
      .optional()
      .describe('Paths into each row. Draws each line as a row: name, quantity × price, discount, term and dates, total.'),
    recordType: z.string().optional().describe('Object type of the rows, for example "QuoteLineItem", so a line links to its record.'),
    defaults: z
      .object({ term: Val.optional(), start: Val.optional(), end: Val.optional() })
      .optional()
      .describe('Term and dates for lines that have none of their own, such as the quote’s.'),
    new: z
      .array(
        z.object({
          name: Val,
          quantity: Val.optional(),
          price: Val.optional(),
          listPrice: Val.optional(),
          discount: Val.optional(),
          total: Val.optional(),
          term: Val.optional(),
          start: Val.optional(),
          end: Val.optional(),
          id: Val.optional(),
          recordType: z.string().optional(),
          url: Val.optional(),
        }),
      )
      .max(10)
      .optional()
      .describe('Lines to add, as values or references. A preview shows them as suggested; a write result shows them as new.'),
    added: z.union([Val, z.array(Val)]).optional().describe('Ids or record links of rows that were just saved; those rows show as new.'),
    columns: z
      .array(z.object({ label: z.string(), path: z.string().describe('Path into each row.'), type: ValueType.optional() }))
      .min(1)
      .max(8)
      .optional()
      .describe('Instead of `item`: draw the lines as a table with these columns.'),
    newRows: z.array(z.array(Val)).optional().describe('With `columns`: rows to be added, one value or reference per column; shown as New.'),
    note: Text.optional(),
  })
  .describe('Related rows, such as line items.');

const common = {
  record: z.unknown().optional().describe('A Salesforce read result, passed unchanged: a record, a query result, or the tool’s text.'),
  result: z.unknown().optional().describe('A Salesforce write or preview tool result, passed unchanged.'),
  recordId: z.string().optional().describe('Which record to use when `record` holds several.'),
  recordType: Text.optional().describe('For example "Opportunity". Defaults to the record’s attributes.type.'),
  title: Text.optional().describe('Defaults to the record’s Name.'),
  subtitle: Text.optional(),
  url: Val.optional().describe('An https link to the record.'),
  instanceUrl: Val.optional().describe('The org’s https base URL, used with ids to build record links.'),
  currency: z.string().optional().describe('ISO currency code; defaults to the record’s CurrencyIsoCode, then USD.'),
  links: z.array(z.object({ label: Text, url: Val })).max(4).optional().describe('More https links, shown as buttons.'),
  notes: Notes.optional().describe('Short notes or warnings; notes already in the summary are skipped.'),
  footerNote: Text.optional(),
};

const TOOLS = [
  {
    name: 'show_record_card',
    kind: 'record',
    title: 'Show Salesforce record card',
    description:
      'Shows one Salesforce record as a card, with a short text version. Pass a read tool’s result unchanged as ' +
      '`record`, then choose what to show: `highlights` (the header) and `fields` (an Information section), and ' +
      'optionally `stages` (a path such as opportunity stages), `lines` (related rows such as line items), `totals`, ' +
      'and `url` or `instanceUrl`. Values can be literals or {"path": ...} references into `record`, so numbers are ' +
      'read from the data rather than retyped. Render-only: it never reads or writes Salesforce.',
    inputSchema: z.object({
      ...common,
      highlights: z.array(Field).max(8).optional().describe('Up to 8 key values shown in the header.'),
      fields: z.array(Field).max(30).optional().describe('More labeled values, shown under Information.'),
      stages: z.object({ steps: z.array(z.string()).max(12), current: Text }).optional(),
      lines: Lines.optional(),
      totals: z.array(Total).max(6).optional(),
    }),
    build: buildRecordCard,
    text: recordText,
  },
  {
    name: 'show_quote_change',
    kind: 'quote-change',
    title: 'Show change preview',
    description:
      'Shows a proposed change before anything is saved. With the record’s `highlights`, `fields` and `lines`, it ' +
      'draws the record as it is, with each change in place: `changes` (before → after; a change whose `before` uses ' +
      'the same path or label as a shown value is drawn on that value) and `lines.new` (lines to add, shown as ' +
      'suggested). Set `draft` when the record doesn’t exist yet, such as a new quote. `consequences` and `notes` ' +
      'list what happens and what to check when the user confirms. Pass the preview tool’s result unchanged as ' +
      '`result`, and a read of the record as `record` if you have one. Render-only: saving still happens through ' +
      'your Salesforce tool, only after the user confirms.',
    inputSchema: z.object({
      ...common,
      status: z.enum(['preview', 'needs-input', 'rejected']).describe('preview: nothing saved yet; needs-input; rejected.'),
      action: Text.optional().describe('What the change does, for example "Add a quote line".'),
      draft: z.boolean().optional().describe('The record doesn’t exist yet; everything shown is proposed.'),
      message: Text.optional(),
      summary: Text.optional().describe('Preview text as the tool returned it (Markdown).'),
      highlights: z.array(Field).max(8).optional().describe('The record’s key values, shown in the header.'),
      changes: z
        .array(z.object({ label: z.string(), before: Val.optional(), after: Val.optional(), type: ValueType.optional() }))
        .max(20)
        .optional(),
      lines: Lines.optional(),
      totals: z.array(Total).max(6).optional(),
      fields: z.array(Field).max(30).optional(),
      consequences: Notes.optional().describe('What happens when the user confirms.'),
      confirmHint: Text.optional().describe('Overrides the "reply confirm" line.'),
    }),
    build: buildQuoteChangeCard,
    text: quoteChangeText,
  },
  {
    name: 'show_write_result',
    kind: 'write-result',
    title: 'Show Salesforce write result',
    description:
      'Shows the outcome of a Salesforce write as a card, with a short text version. Pass the write tool’s result ' +
      'unchanged as `result`, and a later read as `record` if you have one. Then set `status`, `message`, `fields`, ' +
      '`lines` (with `lines.new` for a saved line, or `lines.added` to mark saved rows in a later read), `totals` and ' +
      '`url`, referencing values with {"path": ...}. Render-only.',
    inputSchema: z.object({
      ...common,
      status: z.enum(['saved', 'failed', 'not-saved']),
      message: Text.optional(),
      pendingNote: Text.optional().describe('Shown as a notice, for example that totals update later.'),
      fields: z.array(Field).max(30).optional(),
      lines: Lines.optional(),
      totals: z.array(Total).max(6).optional(),
    }),
    build: buildWriteResultCard,
    text: writeResultText,
  },
];

export function renderToolResult(tool, args) {
  const size = JSON.stringify(args ?? {}).length;
  if (size > MAX_INPUT_CHARS) {
    return {
      content: [{ type: 'text', text: `Couldn't show a card: the data is ${size} characters; pass one record or one result.` }],
      isError: true,
    };
  }
  const card = tool.build(args ?? {});
  return { content: [{ type: 'text', text: tool.text(card) }], structuredContent: card };
}

let htmlCache;
function cardHtml() {
  if (!htmlCache) {
    htmlCache = Object.fromEntries(TOOLS.map((t) => [t.kind, buildCardHtml(t.kind, { title: t.title, version: VERSION })]));
  }
  return htmlCache;
}

function registerCard(server, tool, uri, name, title) {
  server.registerResource(
    name,
    uri,
    { title, description: `MCP App view for ${tool.name}.`, mimeType: MCP_APP_MIME, _meta: { ui: UI_META } },
    async () => ({
      contents: [{ uri, mimeType: MCP_APP_MIME, text: cardHtml()[tool.kind], _meta: { ui: UI_META } }],
    }),
  );
}

export function createServer() {
  const server = new McpServer(
    { name: NAME, title: 'Salesforce MCP App', version: VERSION },
    { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS },
  );
  for (const tool of TOOLS) {
    const uri = CARD_URIS[tool.kind];
    registerCard(server, tool, uri, `${tool.kind}-card`, `${tool.title} (card)`);
    registerCard(server, tool, LEGACY_URIS[tool.kind], `${tool.kind}-card-v1`, `${tool.title} (card, earlier link)`);
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: ANNOTATIONS,
        _meta: { ui: { resourceUri: uri, visibility: ['model', 'app'] }, 'ui/resourceUri': uri },
      },
      async (args) => renderToolResult(tool, args),
    );
  }
  return server;
}

export { TOOLS };
