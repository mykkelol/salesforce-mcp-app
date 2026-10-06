# salesforce-mcp-app

Render-only MCP App cards for Salesforce data: a record card, a change preview, alternative quotes to choose from, and a write result. Each tool returns a `ui://` card for hosts that support MCP Apps and a short text version for every other surface. The cards follow the Lightning look: a record header with highlights, a stage path, an Information section, and line items with their terms and discounts.

- **Render-only.** It holds no credentials, calls no Salesforce API, and makes no network requests. Each card's Content Security Policy blocks all network access. Its images are inlined as `data:` URIs, the only resource source the cards declare (`_meta.ui.csp.resourceDomains`).
- **It shows only what you pass in.** Links appear only when the input includes a URL or an instance URL.

## Tools

| Tool | Shows |
| --- | --- |
| `show_record_card` | One record: highlights, a stage path, an Information section, line items, totals, and what submitting it for approval triggers |
| `show_quote_change` | A proposed change before saving, drawn on the record: each changed value with the old one struck through, suggested lines, and what happens when the user confirms. With `draft`, a record that doesn't exist yet, in a purple frame. A change that needs input or was refused draws no card; the text version carries the message |
| `show_quote_options` | 2 or 3 alternative quotes for one request, numbered, each with a short label and an optional approval note. Before saving, the first is open and the others collapse to their headers, and the user replies "confirm 1", "confirm 2" or "confirm 3" for one, or "confirm all". With `mode` created, the saved quotes start collapsed, each showing its number, its link and what submitting it triggers, and the user replies "submit N" to make one primary and submit it. More than 3 show as a count. Replies are typed because a card can't post to the chat in every host |
| `show_write_result` | After a successful save with a later read passed as `record`, that record as it is now, with nothing marking the save. Anything else draws no card; the text version carries the message |

Values can be literals or references into the Salesforce JSON you pass in. A reference reads from `record` by default; add `"from": "result"` to read from `result`. That way numbers come from the data instead of being retyped:

```json
{
  "record": { "attributes": { "type": "Opportunity" }, "Name": "Example deal", "Amount": 95000, "CloseDate": "2026-12-15" },
  "highlights": [
    { "label": "Amount", "value": { "path": "Amount" }, "type": "currency" },
    { "label": "Close Date", "value": { "path": "CloseDate" }, "type": "date" }
  ]
}
```

Line items take paths into each row, so each line shows its name, quantity × price, discount, term and dates, and total:

```json
{
  "lines": {
    "title": "Products",
    "rows": { "path": "QuoteLineItems.records" },
    "item": { "name": "Product2.Name", "quantity": "Quantity", "price": "UnitPrice", "listPrice": "ListPrice", "discount": "Discount", "total": "TotalPrice" },
    "recordType": "QuoteLineItem"
  }
}
```

In a change preview, `lines.new` lists lines to add (shown as suggested), and a change whose `before` uses the same path as a shown value is drawn on that value. Suggested lines and changed values get a moving border, and their badges a shimmer, for about 11 seconds. Both stop when the user clicks Confirm, and neither runs with reduced motion. In a write result, saved lines show as ordinary rows. `lines.columns` still draws the lines as a table.

## Run it

It needs Node 20 or later. It speaks MCP over stdio and reads no environment variables.

```bash
npx -y --package=github:<github-username>/salesforce-mcp-app#v0.5.0 salesforce-mcp-app
```

As an MCP server entry:

```json
{
  "command": "npx",
  "args": ["-y", "--package=github:<github-username>/salesforce-mcp-app#v0.5.0", "salesforce-mcp-app"]
}
```

## Preview the cards

From a clone, `npm run preview` (no install needed) serves every card state from `preview/fixtures.js` at `http://127.0.0.1:5180/`, with a stand-in host and the text version beside each card. It reloads when you edit `src/` or `preview/`. The preview isn't part of the installed package.
