#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerChatTools } from './tools/chat.js';
import { registerUtilityTools } from './tools/utility.js';

const server = new McpServer({
  name: 'gemini-mcp-server',
  version: '2.0.0',
  description: 'Custom Gemini MCP server - chat, vision, code execution, embeddings, search grounding, URL context, deep research',
});

registerChatTools(server);
registerUtilityTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
