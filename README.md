# Gemini MCP Server

A custom [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that provides 14 tools for interacting with Google Gemini AI -- chat, vision, audio, video, PDF analysis, code execution, embeddings, search grounding, and more.

Built with the official [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) and [`@google/generative-ai`](https://www.npmjs.com/package/@google/generative-ai) packages.

## Features

- **Chat** with Gemini (default model: `gemini-3.1-pro-preview`, configurable per-call)
- **Image analysis** (Gemini Vision) -- JPG, PNG, GIF, WebP, BMP, SVG
- **Audio analysis** and transcription -- MP3, WAV, OGG, FLAC, AAC, M4A, Opus
- **Video analysis** -- MP4, AVI, MOV, MKV, WebM, WMV, FLV, 3GP
- **PDF document analysis** -- summarize, extract, answer questions
- **Multi-turn conversations** with message history
- **Google Search grounded responses** with source citations
- **Structured JSON output** via user-provided JSON schemas
- **Code execution** using Gemini's built-in sandbox
- **Text embeddings** (default model: `text-embedding-004`)
- **Token counting**
- **Model listing** with capabilities and token limits
- **Summarization** with configurable style (brief, detailed, bullet-points)
- **Translation** to any language with optional source language
- **Max thinking budget** of 32,768 tokens for deeper reasoning
- **High media resolution** by default (`MEDIA_RESOLUTION_HIGH`)
- **All safety filters disabled** for unrestricted analysis

## Prerequisites

- **Node.js 18+**
- **Google Gemini API key** -- get one free at <https://aistudio.google.com/apikey>

## Quick Install

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/gemini-mcp-server.git
cd gemini-mcp-server
npm install
```

### 2. Set your API key

```bash
export GEMINI_API_KEY="your-api-key-here"
```

### 3. Register with Claude Code

Using the CLI:

```bash
claude mcp add gemini -- node /path/to/gemini-mcp-server/index.js
```

Or manually add to your Claude Code MCP configuration (`~/.claude/claude_desktop_config.json` or project `.mcp.json`):

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

### 4. Verify

Restart Claude Code. The 14 Gemini tools will appear in your tool list.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Your Google Gemini API key |

## Tools Reference

All 14 tools provided by this server:

| Tool | Description |
|---|---|
| `gemini_chat` | Send a prompt to Gemini and get a text response. Supports system instructions, temperature, and max output tokens. |
| `gemini_analyze_image` | Analyze an image file with Gemini Vision. Accepts JPG, PNG, GIF, WebP, BMP, SVG. |
| `gemini_analyze_audio` | Analyze an audio file -- transcribe, summarize, or describe. Accepts MP3, WAV, OGG, FLAC, AAC, M4A, Opus. |
| `gemini_analyze_video` | Analyze a video file -- describe, summarize, extract info. Accepts MP4, AVI, MOV, MKV, WebM, WMV, FLV, 3GP. |
| `gemini_analyze_pdf` | Analyze a PDF document -- summarize, extract data, answer questions about content. |
| `gemini_chat_multi` | Multi-turn conversation with message history. Pass a JSON array of `{role, text}` messages. |
| `gemini_search_grounded` | Send a prompt with Google Search grounding for up-to-date information. Returns sources and search queries. |
| `gemini_structured_output` | Get structured JSON output using a provided JSON schema. Useful for data extraction and classification. |
| `gemini_list_models` | List all available Gemini models with their capabilities, token limits, and supported methods. |
| `gemini_count_tokens` | Count the number of tokens in provided text using a Gemini model's tokenizer. |
| `gemini_embed` | Generate text embeddings using a Gemini embedding model (default: `text-embedding-004`). |
| `gemini_code_execute` | Generate and execute code using Gemini's built-in code execution sandbox. Returns code and output. |
| `gemini_summarize` | Summarize long text with configurable style: `brief`, `detailed`, or `bullet-points`. |
| `gemini_translate` | Translate text to a target language. Source language is auto-detected if not specified. |

## Model Selection

The default model for all tools is **`gemini-3.1-pro-preview`**. Every tool accepts an optional `model` parameter to override this.

To see all available models and their capabilities, use the `gemini_list_models` tool:

```
Use gemini_list_models to show available Gemini models
```

Common model choices:

| Model | Best For |
|---|---|
| `gemini-3.1-pro-preview` | Default. Best quality for most tasks. |
| `gemini-2.0-flash` | Faster responses, lower cost. |
| `text-embedding-004` | Text embeddings (used by `gemini_embed` by default). |

## Usage Examples

### Basic chat

```
Ask Gemini: What is the Model Context Protocol?
```

### Analyze an image

```
Use gemini_analyze_image on /path/to/photo.jpg with prompt "What objects are in this image?"
```

### Search-grounded response

```
Use gemini_search_grounded: "What are the latest developments in AI safety?"
```

### Structured output

```
Use gemini_structured_output with prompt "List 3 programming languages" and JSON schema for an array of {name, year, paradigm}
```

### Multi-turn conversation

```
Use gemini_chat_multi with messages:
[{"role": "user", "text": "Hello"}, {"role": "model", "text": "Hi!"}, {"role": "user", "text": "Tell me a joke"}]
```

### Code execution

```
Use gemini_code_execute: "Write Python code to calculate the first 20 Fibonacci numbers"
```

## Project Structure

```
gemini-mcp-server/
  index.js          # Server entry point -- registers tools and starts stdio transport
  tools/
    chat.js         # Chat, vision, audio, video, PDF, multi-turn, search grounded, structured output
    utility.js      # List models, count tokens, embeddings, code execution, summarize, translate
  package.json      # Dependencies and metadata
```

## Security

- **API key from environment only** -- the key is read from the `GEMINI_API_KEY` environment variable and never hardcoded in source code.
- **File paths validated** -- all file analysis tools require absolute paths and verify file existence before reading.
- **API key sent via header** -- the key is transmitted via the `x-goog-api-key` HTTP header, not as a URL parameter.
- **No data logged or stored** -- the server does not persist any prompts, responses, or file contents.
- **Stdio transport** -- communication happens over stdin/stdout with no network server exposed.

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP server framework |
| `@google/generative-ai` | ^0.24.0 | Google Gemini AI SDK |
| `zod` | ^3.24.0 | Input schema validation |

## License

MIT
