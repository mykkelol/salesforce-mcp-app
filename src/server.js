import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { buildRecordCard, buildQuoteChangeCard, buildQuoteOptionsCard, buildWriteResultCard } from './cards/normalize.js';
import { recordText, quoteChangeText, quoteOptionsText, writeResultText } from './cards/text.js';
import { buildCardHtml } from './ui/build-html.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const NAME = 'salesforce-mcp-app';
export const VERSION = pkg.version;
export const MCP_APP_MIME = 'text/html;profile=mcp-app';
const MAX_INPUT_CHARS = 200_000;

export const CARD_URIS = {
  record: 'ui://salesforce-mcp-app/record-card-v6.html',
  'quote-change': 'ui://salesforce-mcp-app/quote-change-v4.html',
  'quote-options': 'ui://salesforce-mcp-app/quote-options-v7.html',
  'write-result': 'ui://salesforce-mcp-app/write-result-v4.html',
};

// Cards already in a chat point at these. They get the current card, which
// rebuilds an older card from its saved tool input. A new URI per release that
// changes the card's look keeps hosts that cache by URI from showing the old one.
// The card's images are inlined as data: URIs. Hosts that build the frame's CSP
// from resourceDomains (and default img-src to 'none') need data: listed.
const UI_META = { prefersBorder: false, csp: { resourceDomains: ['data:'] } };

const LEGACY_URIS = {
  record: [
    'ui://salesforce-mcp-app/record-card-v5.html',
    'ui://salesforce-mcp-app/record-card-v3.html',
    'ui://salesforce-mcp-app/record-card-v2.html',
    'ui://salesforce-mcp-app/record-card-v1.html',
  ],
  'quote-change': ['ui://salesforce-mcp-app/quote-change-v3.html', 'ui://salesforce-mcp-app/quote-change-v2.html', 'ui://salesforce-mcp-app/quote-change-v1.html'],
  'quote-options': ['ui://salesforce-mcp-app/quote-options-v6.html', 'ui://salesforce-mcp-app/quote-options-v5.html', 'ui://salesforce-mcp-app/quote-options-v4.html'],
  'write-result': ['ui://salesforce-mcp-app/write-result-v3.html', 'ui://salesforce-mcp-app/write-result-v2.html', 'ui://salesforce-mcp-app/write-result-v1.html'],
};

const INSTRUCTIONS =
  'Render-only cards for Salesforce data. After a Salesforce tool returns data, call a card tool and pass that ' +
  'JSON unchanged as `record` (a read) or `result` (a write or preview). Point values at it with {"path": "Field"}, ' +
  'adding "from": "result" for the write or preview, instead of retyping numbers. Each tool returns a card plus a ' +
  'short text version you can send as your reply. For 2 or 3 alternative quotes in one request, use ' +
  'show_quote_options. These tools never read or change Salesforce: saving happens through your Salesforce tools, ' +
  'after the user confirms.';

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
const Value = { label: z.string(), value: Val, type: ValueType.optional(), currency: z.string().optional() };
// A plain string: allowing a reference here would add about 500 tokens to every host's tool list.
const Field = z.object({ ...Value, url: z.string().optional().describe('https link to the record it names') });
const Total = z.object({ ...Value, main: z.boolean().optional().describe('The headline total, shown in bold. Defaults to the last one.') });
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

// Plain text only: allowing a reference for each value would add about 700 tokens to every host's tool list.
const Triggers = z
  .object({
    approvals: z
      .array(z.object({ name: z.string(), approver: z.string().optional(), reason: z.string().optional(), steps: z.array(z.string()).max(6).optional() }))
      .max(6)
      .optional()
      .describe('Approvals that would run on submit, which can run in parallel. `steps`: approvers in turn within one approval.'),
    processes: z
      .array(z.object({ name: z.string(), when: z.string().optional() }))
      .max(6)
      .optional()
      .describe('What else runs after the submit or the approval, in order, with `when`, for example "When approved".'),
    note: z.string().optional(),
  })
  .describe('What submitting the record for approval would set off, shown as a "What This Triggers" section.');

const recordCard = {
  ...common,
  highlights: z.array(Field).max(8).optional().describe('Up to 8 key values shown in the header.'),
  fields: z.array(Field).max(30).optional().describe('More labeled values, shown under Information.'),
  stages: z.object({ steps: z.array(z.string()).max(12), current: Text }).optional(),
  lines: Lines.optional(),
  totals: z.array(Total).max(6).optional(),
  triggers: Triggers.optional(),
};

const quoteChange = {
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
};

const optionKeys = {
  label: Text.describe('A short name for the option, for example "Standard support".'),
  approvalNote: Text.optional().describe('For example that its discount needs approval. Shown with its notes, unless a note already says it.'),
};
const OPTION_SHAPES = {
  preview: { tool: 'show_quote_change', schema: z.object({ ...optionKeys, ...quoteChange }) },
  created: { tool: 'show_record_card', schema: z.object({ ...optionKeys, ...recordCard }) },
};

// Listing each option's full shape would repeat a card tool's schema, about 8,000
// tokens in every host's tool list, so the tool lists only the option's own keys and
// each option is checked against the full shape here.
function optionsError(args) {
  const created = args.mode === 'created';
  const shape = OPTION_SHAPES[created ? 'created' : 'preview'];
  for (const [i, option] of (Array.isArray(args.options) ? args.options : []).entries()) {
    // The created view says the quotes were saved, so a preview must never be drawn in it.
    if (created && option && (option.status !== undefined || option.draft !== undefined)) {
      return `Couldn't show the options: option ${i + 1} is a preview, not a saved quote. In created mode, pass each saved quote's record card.`;
    }
    const parsed = shape.schema.safeParse(option);
    if (parsed.success) continue;
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? `, ${issue.path.join('.')}` : '';
    return `Couldn't show the options: option ${i + 1}${where}: ${issue.message}. Each option takes the ${shape.tool} input, plus label and approvalNote.`;
  }
  return null;
}

const TOOLS = [
  {
    name: 'show_record_card',
    kind: 'record',
    title: 'Show Salesforce record card',
    description:
      'Shows one Salesforce record as a card, with a short text version. Pass a read tool’s result unchanged as ' +
      '`record`, then choose what to show: `highlights` (the header) and `fields` (an Information section), and ' +
      'optionally `stages` (a path such as opportunity stages), `lines` (related rows such as line items), `totals`, ' +
      '`triggers` (what submitting it for approval would set off), and `url` or `instanceUrl`. Values can be ' +
      'literals or {"path": ...} references into `record`, so numbers are read from the data rather than retyped. ' +
      'Render-only: it never reads or writes Salesforce.',
    inputSchema: z.object(recordCard),
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
      '`result`, and a read of the record as `record` if you have one. With status `needs-input` or `rejected` no ' +
      'card is drawn; reply with the text version, which carries the message. Render-only: saving still happens ' +
      'through your Salesforce tool, only after the user confirms.',
    inputSchema: z.object(quoteChange),
    build: buildQuoteChangeCard,
    text: quoteChangeText,
  },
  {
    name: 'show_quote_options',
    kind: 'quote-options',
    title: 'Show quote options',
    description:
      'Shows 2 or 3 alternative quotes for one request as numbered options, so the user can compare them and pick. ' +
      'Each option has a short `label` such as "Standard support" and an optional `approvalNote`. Before anything ' +
      'is saved (`mode` preview, the default), each option takes the same input as a show_quote_change preview of a ' +
      'new quote; every option starts collapsed, and the user replies "confirm 1", ' +
      '"confirm 2" or "confirm 3" for one quote, or "confirm all" for every one shown. An option with status ' +
      '`needs-input` or `rejected` isn’t drawn, and the text version carries its message. After the quotes are ' +
      'saved (`mode` created), each option takes the same input as a show_record_card card of the saved quote, ' +
      'with its `triggers`; all start collapsed, showing the quote number, its link and what submitting it ' +
      'triggers, and the user replies "submit N" to make one primary and submit it. Options are numbered in the ' +
      'order you pass them; up to 3 are shown. Render-only: saving and submitting happen through your Salesforce ' +
      'tools, only after the user replies.',
    inputSchema: z.object({
      mode: z
        .enum(['preview', 'created'])
        .optional()
        .describe('preview (default): quotes not saved yet, confirmed by number. created: saved quotes, submitted by number.'),
      options: z
        .array(
          z
            .looseObject(optionKeys)
            .describe('In preview mode a show_quote_change input; in created mode a show_record_card input. Plus `label` and an optional `approvalNote`.'),
        )
        .min(1)
        .max(10)
        .describe('The options, in the order they are numbered.'),
    }),
    check: optionsError,
    build: buildQuoteOptionsCard,
    text: quoteOptionsText,
  },
  {
    name: 'show_write_result',
    kind: 'write-result',
    title: 'Show Salesforce write result',
    description:
      'Shows the outcome of a Salesforce write, with a short text version. Only a successful save (`status` saved) ' +
      'with a later read of the record passed as `record` draws a card: that record as it is now, with nothing ' +
      'marking the save. Anything else draws no card, and the text version carries the message. Pass the write ' +
      'tool’s result unchanged as `result`, then set `status`, `message`, `fields`, `lines`, `totals` and `url`, ' +
      'referencing values with {"path": ...}. Render-only.',
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
  const invalid = tool.check && tool.check(args ?? {});
  if (invalid) return { content: [{ type: 'text', text: invalid }], isError: true };
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
    for (const legacy of LEGACY_URIS[tool.kind] || []) {
      registerCard(server, tool, legacy, `${tool.kind}-card-${/-(v\d+)\.html$/.exec(legacy)[1]}`, `${tool.title} (card, earlier link)`);
    }
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
