# salesforce-mcp-app

Render-only MCP App cards for Salesforce data: a record card, a change preview, and a write result. Each tool returns a `ui://` card for hosts that support MCP Apps and a short text version for every other surface.

- **Render-only.** It holds no credentials, calls no Salesforce API, and makes no network requests. Each card's Content Security Policy blocks all network access.
- **It shows only what you pass in.** Links appear only when the input includes a URL or an instance URL.

## Tools

| Tool | Shows |
| --- | --- |
| `show_record_card` | One record: highlights, a stage path, details, line items, totals |
| `show_quote_change` | A proposed change before saving: status, the tool's preview text, before → after values, current and new line items |
| `show_write_result` | The outcome of a write: status, message, details, line items, totals |

Values can be literals or references into the Salesforce JSON you pass in. A reference reads from `record` by default; add `"from": "result"` to read from `result`. That way numbers come from the data instead of being retyped:

```json
{
  "record": { "attributes": { "type": "Opportunity" }, "Name": "Example deal", "Amount": 120000, "CloseDate": "2026-12-15" },
  "highlights": [
    { "label": "Amount", "value": { "path": "Amount" }, "type": "currency" },
    { "label": "Close Date", "value": { "path": "CloseDate" }, "type": "date" }
  ]
}
```

## Run it

It needs Node 20 or later. It speaks MCP over stdio and reads no environment variables.

```bash
npx -y --package=github:<github-username>/salesforce-mcp-app#v0.1.0 salesforce-mcp-app
```

As an MCP server entry:

```json
{
  "command": "npx",
  "args": ["-y", "--package=github:<github-username>/salesforce-mcp-app#v0.1.0", "salesforce-mcp-app"]
}
```
