# Gemini MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server providing **23 tools** for Google's Gemini API -- chat, multimodal analysis, deep research, file management, YouTube analysis, and more.

Built with [`@google/genai`](https://www.npmjs.com/package/@google/genai) SDK (v1.0.0+).

## Features

- Chat with Gemini models (single-turn, multi-turn, with tool modes)
- Analyze images, audio, video, PDFs, YouTube videos, and URLs
- Files API with auto-switching: inline for small files (<20MB), upload for large (up to 2GB)
- Deep research agent with background polling and push notifications (Termux)
- Structured JSON output, embeddings, code execution, translation, summarization
- Google Search grounding and URL context
- Thinking mode enabled by default (budget: 65535 tokens)
- High media resolution by default

## Prerequisites

- **Node.js 18+**
- A [Gemini API key](https://aistudio.google.com/apikey)

## Quick Install

```bash
git clone https://github.com/salviz/gemini-mcp-server.git
cd gemini-mcp-server
npm install
```

### Register with Claude Code

CLI:

```bash
claude mcp add gemini -- node /path/to/gemini-mcp-server/index.js
```

Or add to your MCP config (`~/.claude/claude_desktop_config.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "gemini": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/gemini-mcp-server/index.js"],
      "env": {
        "GEMINI_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Your Google Gemini API key |

## Tools (23)

### Chat & Generation (6)

| Tool | Description |
|------|-------------|
| `gemini_chat` | Send a prompt with optional search grounding and URL context |
| `gemini_chat_multi` | Multi-turn conversation with message history |
| `gemini_chat_with_tools` | Chat with mode switching: `search`, `code`, or `all` |
| `gemini_search_grounded` | Search-grounded generation with source citations |
| `gemini_structured_output` | Generate JSON output matching a provided schema |
| `gemini_url_context` | Analyze one or more URLs using Gemini's URL context tool |

### Multimodal Analysis (6)

| Tool | Description |
|------|-------------|
| `gemini_analyze_image` | Analyze an image file with Gemini Vision (JPG, PNG, GIF, WebP, BMP, SVG) |
| `gemini_analyze_audio` | Transcribe, summarize, or describe audio (MP3, WAV, OGG, FLAC, AAC, M4A, Opus) |
| `gemini_analyze_video` | Analyze a video file; auto-uploads large files via Files API (MP4, AVI, MOV, MKV, WebM) |
| `gemini_analyze_pdf` | Analyze a PDF document (up to 2GB via Files API) |
| `gemini_analyze_youtube` | Analyze a public YouTube video by URL (no download needed) |
| `gemini_analyze_url` | Analyze content from an HTTP/HTTPS URL or GCS URI (`gs://`) |

### Deep Research (2)

| Tool | Description |
|------|-------------|
| `gemini_deep_research` | Start a deep research task; sends push notification on completion |
| `gemini_check_research` | Check status of a running deep research task by interaction ID |

### Files API (3)

| Tool | Description |
|------|-------------|
| `gemini_upload_file` | Upload a file to Gemini (up to 2GB, retained 48 hours) |
| `gemini_list_files` | List all uploaded files with metadata |
| `gemini_delete_file` | Delete an uploaded file by name |

### Utilities (6)

| Tool | Description |
|------|-------------|
| `gemini_list_models` | List available Gemini models with capabilities and token limits |
| `gemini_count_tokens` | Count tokens in text using a model's tokenizer |
| `gemini_embed` | Generate text embeddings (default: `gemini-embedding-001`, 3072 dimensions) |
| `gemini_code_execute` | Execute Python code via Gemini's built-in sandbox |
| `gemini_summarize` | Summarize text with configurable style (brief, detailed, bullet-points) |
| `gemini_translate` | Translate text to any language with optional model override |

## Model Selection

Default model: **`gemini-3.1-pro-preview`**. Every tool accepts an optional `model` parameter.

| Model | Best For |
|-------|----------|
| `gemini-3.1-pro-preview` | Default. Best quality for most tasks |
| `gemini-2.5-flash` | Faster responses, lower cost |
| `gemini-embedding-001` | Text embeddings (used by `gemini_embed`) |
| `deep-research-pro-preview-12-2025` | Deep research agent (used internally) |

## Files API & Large File Handling

The server automatically handles file size:

- **<= 20MB**: Sent inline as base64 (fast, no upload step)
- **> 20MB up to 2GB**: Uploaded via Gemini Files API, then referenced by URI
- **YouTube URLs**: Passed directly via `fileData.fileUri` (no download)
- **HTTP/HTTPS URLs**: Passed via `createPartFromUri` (up to 100MB)
- **GCS URIs** (`gs://`): Passed via `fileData.fileUri`

Uploaded files are retained for 48 hours. Use `gemini_list_files` and `gemini_delete_file` to manage them.

## Deep Research

The `gemini_deep_research` tool uses Gemini's Interactions API with the `deep-research-pro-preview-12-2025` agent:

1. Starts research in background mode
2. Polls for 50 seconds in case it finishes quickly
3. If still running, starts background polling (every 30s, up to 30 minutes)
4. Sends a **push notification** via `termux-notification` when complete
5. Saves full results to `~/.cache/deep_research_*.txt`

Use `gemini_check_research` to manually poll at any time.

## Project Structure

```
gemini-mcp-server/
  index.js              # Server entry point
  tools/
    shared.js           # Shared config, AI client, extractText helper
    chat.js             # 17 tools: chat, analysis, research, files, YouTube
    utility.js          # 6 tools: models, tokens, embed, code, summarize, translate
  package.json
```

## Security

- **API key from environment only** -- never hardcoded in source
- **File paths validated** -- absolute paths required, existence checked before reading
- **Stdio transport** -- no network server exposed
- **No data logged or stored** -- prompts and responses are not persisted

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP server framework |
| `@google/genai` | ^1.0.0 | Google Gemini AI SDK |
| `zod` | ^3.24.0 | Input schema validation |

## License

MIT
