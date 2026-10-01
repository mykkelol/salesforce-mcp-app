#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createServer, VERSION } from '../src/server.js';

const USAGE = `salesforce-mcp-app ${VERSION}
Render-only MCP App cards for Salesforce data. No credentials, no network calls.

Usage:
  salesforce-mcp-app     serve MCP over stdio
`;

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: true,
});

if (values.help) {
  process.stdout.write(USAGE);
} else if (values.version) {
  process.stdout.write(`${VERSION}\n`);
} else {
  const { serveStdio } = await import('@modelcontextprotocol/server/stdio');
  serveStdio(() => createServer());
}
