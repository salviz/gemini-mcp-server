import { ai, DEFAULT_MODEL, DEFAULT_CONFIG, extractText, success, error } from './shared.js';
import { createPartFromUri } from '@google/genai';
import { z } from 'zod';
import { readFile, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import { execFile } from 'child_process';

const INLINE_MAX_MB = 20;
const FILES_API_MAX_MB = 2048;

function extractOutputText(interaction) {
  if (!interaction.outputs?.length) return JSON.stringify(interaction);
  const texts = [];
  for (const output of interaction.outputs) {
    if (output.text) texts.push(output.text);
    else if (output.parts) texts.push(...output.parts.map(p => p.text).filter(Boolean));
  }
  return texts.join('\n') || JSON.stringify(interaction);
}

function sendNotification(title, content) {
  execFile('termux-notification', [
    '--title', title,
    '--content', content.slice(0, 500),
    '--id', 'gemini-research',
    '--group', 'gemini',
    '--priority', 'high',
    '--button1', 'Dismiss',
    '--button1-action', 'termux-notification-remove gemini-research',
  ], (err) => {
    if (err) process.stderr.write(`Notification error: ${err.message}\n`);
  });
}

function pollResearchInBackground(interactionId) {
  const resultPath = `/data/data/com.termux/files/home/.cache/deep_research_${interactionId.slice(-12)}.txt`;
  let attempts = 0;
  const maxAttempts = 60; // 30s * 60 = 30 minutes max

  const poll = async () => {
    attempts++;
    try {
      const result = await ai.interactions.get(interactionId);
      if (result.status === 'completed') {
        const text = extractOutputText(result);
        await writeFile(resultPath, text, 'utf-8');
        sendNotification('Deep Research Complete', text.slice(0, 200));
        return;
      }
      if (result.status === 'failed' || result.status === 'cancelled') {
        sendNotification('Deep Research Failed', `Status: ${result.status}`);
        return;
      }
    } catch (e) {
      process.stderr.write(`Poll error: ${e.message}\n`);
    }
    if (attempts < maxAttempts) setTimeout(poll, 30000);
    else sendNotification('Deep Research Timeout', 'Research did not complete within 30 minutes.');
  };

  setTimeout(poll, 30000);
  return resultPath;
}

function validateFilePath(filePath) {
  if (!filePath || !isAbsolute(filePath)) {
    throw new Error('File path must be an absolute path');
  }
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }
  return resolved;
}

async function prepareFilePart(filePath, mimeType) {
  const stats = await stat(filePath);
  const sizeMB = stats.size / (1024 * 1024);
  if (sizeMB > FILES_API_MAX_MB) {
    throw new Error(`File too large (${sizeMB.toFixed(1)}MB). Maximum is ${FILES_API_MAX_MB}MB.`);
  }
  if (sizeMB > INLINE_MAX_MB) {
    // Use Files API for large files
    sendNotification('Gemini Upload', `Uploading ${sizeMB.toFixed(0)}MB file via Files API...`);
    const uploaded = await ai.files.upload({
      file: filePath,
      config: { mimeType },
    });
    // Wait for processing if needed
    let file = uploaded;
    while (file.state === 'PROCESSING') {
      await new Promise(r => setTimeout(r, 3000));
      file = await ai.files.get({ name: file.name });
    }
    sendNotification('Gemini Upload', `Upload complete: ${file.name}`);
    if (file.state === 'FAILED') {
      throw new Error(`File processing failed: ${file.name}`);
    }
    return { part: createPartFromUri(file.uri, file.mimeType), uploaded: file.name };
  }
  // Inline for small files
  const buffer = await readFile(filePath);
  return { part: { inlineData: { data: buffer.toString('base64'), mimeType } } };
}

const MIME_MAP = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
  aac: 'audio/aac', m4a: 'audio/mp4', opus: 'audio/opus',
  mp4: 'video/mp4', avi: 'video/x-msvideo', mov: 'video/quicktime',
  mkv: 'video/x-matroska', webm: 'video/webm', wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv', '3gp': 'video/3gpp',
  pdf: 'application/pdf',
};

function getMimeType(filePath) {
  const ext = filePath.toLowerCase().split('.').pop();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function appendGroundingMetadata(output, candidate) {
  if (candidate?.groundingMetadata) {
    const metadata = candidate.groundingMetadata;
    const sources = [];
    if (metadata.groundingChunks) {
      for (const chunk of metadata.groundingChunks) {
        if (chunk.web) {
          sources.push(`- [${chunk.web.title || 'Source'}](${chunk.web.uri})`);
        }
      }
    }
    if (metadata.webSearchQueries) {
      output += '\n\nSearch queries: ' + metadata.webSearchQueries.join(', ');
    }
    if (sources.length > 0) {
      output += '\n\nSources:\n' + sources.join('\n');
    }
  }
  if (candidate?.urlContextMetadata?.urlMetadata?.length > 0) {
    output += '\n\nURL Context:';
    for (const u of candidate.urlContextMetadata.urlMetadata) {
      output += `\n- ${u.retrievedUrl} (${u.urlRetrievalStatus})`;
    }
  }
  return output;
}

function appendCodeParts(output, parts) {
  for (const part of parts || []) {
    if (part.executableCode) {
      const lang = part.executableCode.language || 'python';
      output += `\n\n**Code (${lang}):**\n\`\`\`${lang}\n${part.executableCode.code}\n\`\`\``;
    }
    if (part.codeExecutionResult) {
      const outcome = part.codeExecutionResult.outcome || 'unknown';
      output += `\n\n**Execution (${outcome}):**\n\`\`\`\n${part.codeExecutionResult.output || '(no output)'}\n\`\`\``;
    }
  }
  return output;
}

export function registerChatTools(server) {

  // 1. gemini_chat - Basic chat with optional search/URL context
  server.tool(
    'gemini_chat',
    'Send a prompt to Gemini and get a text response. Optionally enable search grounding or URL context.',
    {
      prompt: z.string().describe('The prompt to send to Gemini'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
      systemInstruction: z.string().optional().describe('System instruction for the model'),
      temperature: z.coerce.number().optional().describe('Temperature for generation'),
      maxOutputTokens: z.coerce.number().optional().describe('Maximum output tokens'),
      enableSearch: z.boolean().optional().describe('Enable Google Search grounding (default: false)'),
      enableUrlContext: z.boolean().optional().describe('Enable URL context processing (default: false)'),
    },
    async ({ prompt, model: modelName, systemInstruction, temperature, maxOutputTokens, enableSearch, enableUrlContext }) => {
      try {
        const config = { ...DEFAULT_CONFIG };
        if (systemInstruction) config.systemInstruction = systemInstruction;
        if (temperature !== undefined) config.temperature = temperature;
        if (maxOutputTokens !== undefined) config.maxOutputTokens = maxOutputTokens;

        const tools = [];
        if (enableSearch) tools.push({ googleSearch: {} });
        if (enableUrlContext) tools.push({ urlContext: {} });
        if (tools.length > 0) config.tools = tools;

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: prompt,
          config,
        });

        let output = extractText(response);
        const candidate = response.candidates?.[0];
        output = appendGroundingMetadata(output, candidate);
        return success(output);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 2. gemini_analyze_image
  server.tool(
    'gemini_analyze_image',
    'Analyze an image file with Gemini Vision',
    {
      imagePath: z.string().describe('Absolute path to the image file'),
      prompt: z.string().optional().describe('Prompt for image analysis (default: Describe this image in detail)'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
    },
    async ({ imagePath, prompt, model: modelName }) => {
      try {
        const resolved = validateFilePath(imagePath);
        const mimeType = getMimeType(imagePath);
        const { part, uploaded } = await prepareFilePart(resolved, mimeType);

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: [part, { text: prompt || 'Describe this image in detail' }],
          config: { ...DEFAULT_CONFIG },
        });
        let out = extractText(response);
        if (uploaded) out += `\n(File uploaded via Files API: ${uploaded})`;
        return success(out);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 3. gemini_analyze_audio
  server.tool(
    'gemini_analyze_audio',
    'Analyze an audio file with Gemini (transcribe, summarize, describe)',
    {
      audioPath: z.string().describe('Absolute path to the audio file'),
      prompt: z.string().optional().describe('Prompt for audio analysis (default: Transcribe and describe this audio)'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
    },
    async ({ audioPath, prompt, model: modelName }) => {
      try {
        const resolved = validateFilePath(audioPath);
        const mimeType = getMimeType(audioPath);
        const { part, uploaded } = await prepareFilePart(resolved, mimeType);

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: [part, { text: prompt || 'Transcribe and describe this audio' }],
          config: { ...DEFAULT_CONFIG },
        });
        let out = extractText(response);
        if (uploaded) out += `\n(File uploaded via Files API: ${uploaded})`;
        return success(out);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 4. gemini_analyze_video
  server.tool(
    'gemini_analyze_video',
    'Analyze a video file with Gemini (describe, summarize, extract info)',
    {
      videoPath: z.string().describe('Absolute path to the video file'),
      prompt: z.string().optional().describe('Prompt for video analysis (default: Describe what happens in this video)'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
    },
    async ({ videoPath, prompt, model: modelName }) => {
      try {
        const resolved = validateFilePath(videoPath);
        const mimeType = getMimeType(videoPath);
        const { part, uploaded } = await prepareFilePart(resolved, mimeType);

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: [part, { text: prompt || 'Describe what happens in this video' }],
          config: { ...DEFAULT_CONFIG },
        });
        let out = extractText(response);
        if (uploaded) out += `\n(File uploaded via Files API: ${uploaded})`;
        return success(out);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 5. gemini_analyze_pdf
  server.tool(
    'gemini_analyze_pdf',
    'Analyze a PDF document with Gemini (summarize, extract, answer questions)',
    {
      pdfPath: z.string().describe('Absolute path to the PDF file'),
      prompt: z.string().optional().describe('Prompt for PDF analysis (default: Summarize this document)'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
    },
    async ({ pdfPath, prompt, model: modelName }) => {
      try {
        const resolved = validateFilePath(pdfPath);
        const { part, uploaded } = await prepareFilePart(resolved, 'application/pdf');

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: [part, { text: prompt || 'Summarize this document' }],
          config: { ...DEFAULT_CONFIG },
        });
        let out = extractText(response);
        if (uploaded) out += `\n(File uploaded via Files API: ${uploaded})`;
        return success(out);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 6. gemini_chat_multi - Multi-turn conversation
  server.tool(
    'gemini_chat_multi',
    'Multi-turn conversation with Gemini using message history',
    {
      messages: z.string().describe('JSON array of {role: "user"|"model", text: "..."} messages'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
      systemInstruction: z.string().optional().describe('System instruction for the model'),
    },
    async ({ messages, model: modelName, systemInstruction }) => {
      try {
        const parsed = JSON.parse(messages);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          return error('messages must be a non-empty JSON array');
        }

        const geminiMessages = parsed.map((msg) => ({
          role: msg.role,
          parts: [{ text: msg.text }],
        }));

        const history = geminiMessages.slice(0, -1);
        const lastMessage = geminiMessages[geminiMessages.length - 1];

        const config = { ...DEFAULT_CONFIG };
        if (systemInstruction) config.systemInstruction = systemInstruction;

        const chat = ai.chats.create({
          model: modelName || DEFAULT_MODEL,
          history,
          config,
        });
        const response = await chat.sendMessage({ message: lastMessage.parts[0].text });
        return success(extractText(response));
      } catch (e) {
        return error(e);
      }
    }
  );

  // 7. gemini_search_grounded - Search grounding + URL context
  server.tool(
    'gemini_search_grounded',
    'Send a prompt to Gemini with Google Search grounding and URL context for up-to-date information',
    {
      prompt: z.string().describe('The prompt to send with search grounding'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
      enableUrlContext: z.boolean().optional().describe('Also enable URL context (default: true)'),
    },
    async ({ prompt, model: modelName, enableUrlContext }) => {
      try {
        const tools = [{ googleSearch: {} }];
        if (enableUrlContext !== false) tools.push({ urlContext: {} });

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: prompt,
          config: { ...DEFAULT_CONFIG, tools },
        });

        let output = extractText(response);
        const candidate = response.candidates?.[0];
        output = appendGroundingMetadata(output, candidate);
        return success(output);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 8. gemini_structured_output - JSON structured output
  server.tool(
    'gemini_structured_output',
    'Get structured JSON output from Gemini using a provided JSON schema',
    {
      prompt: z.string().describe('The prompt to send to Gemini'),
      jsonSchema: z.string().describe('JSON schema string defining the expected output structure'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
    },
    async ({ prompt, jsonSchema, model: modelName }) => {
      try {
        const parsedSchema = JSON.parse(jsonSchema);

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: prompt,
          config: {
            ...DEFAULT_CONFIG,
            thinkingConfig: undefined,
            responseMimeType: 'application/json',
            responseSchema: parsedSchema,
          },
        });
        return success(extractText(response));
      } catch (e) {
        return error(e);
      }
    }
  );

  // 9. gemini_url_context - Analyze URLs with Gemini
  server.tool(
    'gemini_url_context',
    'Analyze one or more URLs using Gemini URL context tool. Gemini fetches and reads the URLs directly.',
    {
      prompt: z.string().describe('Prompt about the URL(s). URLs in the prompt text are also auto-detected.'),
      urls: z.array(z.string()).optional().describe('Array of URLs to analyze (optional)'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
    },
    async ({ prompt, urls, model: modelName }) => {
      try {
        let fullPrompt = prompt;
        if (urls?.length > 0) {
          fullPrompt += '\n\nURLs to analyze:\n' + urls.join('\n');
        }

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: fullPrompt,
          config: { ...DEFAULT_CONFIG, tools: [{ urlContext: {} }] },
        });

        let output = extractText(response);
        const candidate = response.candidates?.[0];
        output = appendGroundingMetadata(output, candidate);
        return success(output);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 10. gemini_chat_with_tools - Flexible mode switching
  server.tool(
    'gemini_chat_with_tools',
    'Flexible Gemini chat with mode switching: "search" (Google Search + URL context), "code" (code execution), or "all" (everything)',
    {
      prompt: z.string().describe('The prompt to send'),
      mode: z.enum(['search', 'code', 'all']).optional().describe('Tool mode: "search" (default) = Google Search + URL context, "code" = code execution, "all" = everything'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
      systemInstruction: z.string().optional().describe('System instruction'),
    },
    async ({ prompt, mode, model: modelName, systemInstruction }) => {
      try {
        const selectedMode = mode || 'search';
        const tools = [];

        if (selectedMode === 'search' || selectedMode === 'all') {
          tools.push({ googleSearch: {} });
          tools.push({ urlContext: {} });
        }
        if (selectedMode === 'code' || selectedMode === 'all') {
          tools.push({ codeExecution: {} });
        }

        const config = { ...DEFAULT_CONFIG, tools };
        if (systemInstruction) config.systemInstruction = systemInstruction;

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: prompt,
          config,
        });

        let output = extractText(response);
        const candidate = response.candidates?.[0];
        output = appendGroundingMetadata(output, candidate);
        output = appendCodeParts(output, candidate?.content?.parts);
        return success(output);
      } catch (e) {
        if (mode === 'all' && e.message) {
          return error(new Error(`Mode "all" failed (API may not support combining tools). Try "search" or "code" mode instead. ${e.message}`));
        }
        return error(e);
      }
    }
  );

  // 11. gemini_deep_research - Start deep research (returns ID for polling)
  server.tool(
    'gemini_deep_research',
    'Start a deep research task using Gemini Deep Research. Returns an interaction ID. Then call gemini_check_research with wait=true in the background to get notified when complete.',
    {
      query: z.string().describe('The research query or question'),
    },
    async ({ query }) => {
      try {
        const interaction = await ai.interactions.create({
          agent: 'deep-research-pro-preview-12-2025',
          input: query,
          background: true,
          agent_config: { type: 'deep-research', thinking_summaries: 'auto' },
        });

        const interactionId = interaction.id;
        if (!interactionId) {
          return success('Deep research started but no interaction ID returned.\nRaw: ' + JSON.stringify(interaction));
        }

        // Quick check: poll 5 times at 10s intervals (50s total) in case it finishes fast
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 10000));
          const result = await ai.interactions.get(interactionId);

          if (result.status === 'completed') {
            const text = extractOutputText(result);
            return success(`Deep Research Complete:\n\n${text}`);
          }
          if (result.status === 'failed' || result.status === 'cancelled') {
            return error(new Error(`Deep research ${result.status}: ${JSON.stringify(result)}`));
          }
        }

        // Start background polling with push notification
        const resultPath = pollResearchInBackground(interactionId);
        return success(
          `Deep research is running in background.\nInteraction ID: ${interactionId}\n\nYou will receive a push notification when complete.\nResults will be saved to: ${resultPath}\n\nOr use gemini_check_research to check manually.`
        );
      } catch (e) {
        return error(e);
      }
    }
  );

  // 12. gemini_check_research - Check or wait for deep research results
  server.tool(
    'gemini_check_research',
    'Check or wait for deep research results. Use wait=true to block until completion (ideal for background execution — the tool returns when research finishes, triggering a task notification in your AI client).',
    {
      interactionId: z.string().describe('The interaction ID returned by gemini_deep_research'),
      wait: z.boolean().optional().describe('If true, block and poll until research completes (default: false, single check)'),
      timeoutMinutes: z.coerce.number().optional().describe('Max wait time in minutes when wait=true (default: 30)'),
    },
    async ({ interactionId, wait, timeoutMinutes }) => {
      try {
        const maxMinutes = timeoutMinutes || 30;
        const maxAttempts = wait ? Math.ceil((maxMinutes * 60) / 30) : 1;

        for (let i = 0; i < maxAttempts; i++) {
          if (i > 0) await new Promise(r => setTimeout(r, 30000));

          const result = await ai.interactions.get(interactionId);

          if (result.status === 'completed') {
            const text = extractOutputText(result);
            return success(`Deep Research Complete:\n\n${text}`);
          }
          if (result.status === 'failed' || result.status === 'cancelled') {
            return error(new Error(`Deep research ${result.status}: ${JSON.stringify(result)}`));
          }
        }

        if (wait) {
          return success(`Deep research did not complete within ${maxMinutes} minutes.\nStatus: in_progress\nInteraction ID: ${interactionId}`);
        }
        return success(`Deep research still running.\nStatus: in_progress\nInteraction ID: ${interactionId}\n\nUse wait=true to block until completion.`);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 13. gemini_upload_file - Upload a file to Gemini Files API
  server.tool(
    'gemini_upload_file',
    'Upload a file to Gemini Files API for use with analysis tools. Files are retained for 48 hours. Max 2GB per file, 20GB total.',
    {
      filePath: z.string().describe('Absolute path to the file to upload'),
      mimeType: z.string().optional().describe('MIME type override (auto-detected from extension if omitted)'),
      displayName: z.string().optional().describe('Display name for the uploaded file'),
    },
    async ({ filePath, mimeType, displayName }) => {
      try {
        const resolved = validateFilePath(filePath);
        const mime = mimeType || getMimeType(resolved);
        const config = { mimeType: mime };
        if (displayName) config.displayName = displayName;

        const uploaded = await ai.files.upload({ file: resolved, config });

        let file = uploaded;
        while (file.state === 'PROCESSING') {
          await new Promise(r => setTimeout(r, 3000));
          file = await ai.files.get({ name: file.name });
        }

        return success(
          `File uploaded successfully.\n` +
          `Name: ${file.name}\n` +
          `URI: ${file.uri}\n` +
          `MIME: ${file.mimeType}\n` +
          `Size: ${file.sizeBytes} bytes\n` +
          `State: ${file.state}\n` +
          `Expires: ${file.expirationTime || 'N/A'}`
        );
      } catch (e) {
        return error(e);
      }
    }
  );

  // 14. gemini_list_files - List uploaded files
  server.tool(
    'gemini_list_files',
    'List files uploaded to the Gemini Files API',
    {
      pageSize: z.coerce.number().optional().describe('Number of files to list (default: 20)'),
    },
    async ({ pageSize }) => {
      try {
        const files = [];
        const listResponse = await ai.files.list({ config: { pageSize: pageSize || 20 } });
        for await (const file of listResponse) {
          files.push(`${file.name} | ${file.displayName || ''} | ${file.mimeType} | ${file.sizeBytes}B | ${file.state} | expires: ${file.expirationTime || 'N/A'}`);
        }
        if (files.length === 0) return success('No files uploaded.');
        return success(`Uploaded files (${files.length}):\n${files.join('\n')}`);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 15. gemini_delete_file - Delete an uploaded file
  server.tool(
    'gemini_delete_file',
    'Delete a file from the Gemini Files API',
    {
      fileName: z.string().describe('File name (e.g., "files/abc123") from upload or list'),
    },
    async ({ fileName }) => {
      try {
        await ai.files.delete({ name: fileName });
        return success(`File ${fileName} deleted.`);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 16. gemini_analyze_youtube - Analyze a YouTube video
  server.tool(
    'gemini_analyze_youtube',
    'Analyze a public YouTube video with Gemini (summarize, transcribe, answer questions). Supports up to 10 videos with Gemini 2.5+ models.',
    {
      url: z.string().describe('YouTube video URL (e.g., https://www.youtube.com/watch?v=...)'),
      prompt: z.string().optional().describe('Prompt for video analysis (default: Summarize this video)'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
    },
    async ({ url, prompt, model: modelName }) => {
      try {
        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: [
            { fileData: { fileUri: url } },
            { text: prompt || 'Summarize this video' },
          ],
          config: { ...DEFAULT_CONFIG },
        });
        return success(extractText(response));
      } catch (e) {
        return error(e);
      }
    }
  );

  // 17. gemini_analyze_url - Analyze content from an HTTP/HTTPS URL or GCS URI
  server.tool(
    'gemini_analyze_url',
    'Analyze a file from a public URL (HTTP/HTTPS) or Google Cloud Storage URI (gs://). Supports images, audio, video, PDFs, and documents up to 100MB.',
    {
      url: z.string().describe('Public URL (https://...) or GCS URI (gs://bucket/file)'),
      mimeType: z.string().describe('MIME type of the file (e.g., application/pdf, image/jpeg, audio/mpeg, video/mp4)'),
      prompt: z.string().optional().describe('Prompt for analysis (default: Describe this content)'),
      model: z.string().optional().describe(`Model name (default: ${DEFAULT_MODEL})`),
    },
    async ({ url, mimeType, prompt, model: modelName }) => {
      try {
        const isGcs = url.startsWith('gs://');
        const part = isGcs
          ? { fileData: { fileUri: url, mimeType } }
          : createPartFromUri(url, mimeType);

        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: [part, { text: prompt || 'Describe this content' }],
          config: { ...DEFAULT_CONFIG },
        });
        return success(extractText(response));
      } catch (e) {
        return error(e);
      }
    }
  );
}
