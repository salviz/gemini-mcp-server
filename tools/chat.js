import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { resolve, isAbsolute } from 'path';

if (!process.env.GEMINI_API_KEY) {
  process.stderr.write('ERROR: GEMINI_API_KEY environment variable is required.\nSee README.md for setup instructions.\n');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

function success(text) {
  return { content: [{ type: 'text', text }] };
}

function error(e) {
  return { content: [{ type: 'text', text: 'Error: ' + (e?.message || String(e)) }], isError: true };
}

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const DEFAULT_THINKING_CONFIG = {
  thinkingConfig: {
    thinkingBudget: 32768,
  },
  mediaResolution: 'MEDIA_RESOLUTION_HIGH',
};

export function registerChatTools(server) {

  // 1. gemini_chat - Send a prompt to Gemini
  server.tool(
    'gemini_chat',
    'Send a prompt to Gemini and get a text response',
    {
      prompt: z.string().describe('The prompt to send to Gemini'),
      model: z.string().optional().describe('Model name (default: gemini-3.1-pro-preview)'),
      systemInstruction: z.string().optional().describe('System instruction for the model'),
      temperature: z.number().optional().describe('Temperature for generation'),
      maxOutputTokens: z.number().optional().describe('Maximum output tokens'),
    },
    async ({ prompt, model: modelName, systemInstruction, temperature, maxOutputTokens }) => {
      try {
        const generationConfig = { ...DEFAULT_THINKING_CONFIG.thinkingConfig ? { thinkingConfig: DEFAULT_THINKING_CONFIG.thinkingConfig } : {} };
        const genConfig = {};
        if (temperature !== undefined) genConfig.temperature = temperature;
        if (maxOutputTokens !== undefined) genConfig.maxOutputTokens = maxOutputTokens;

        const modelConfig = {
          model: modelName || 'gemini-3.1-pro-preview',
          safetySettings,
          generationConfig: { ...genConfig, ...DEFAULT_THINKING_CONFIG },
        };
        if (systemInstruction) modelConfig.systemInstruction = systemInstruction;

        const model = genAI.getGenerativeModel(modelConfig);
        const result = await model.generateContent(prompt);
        const response = result.response;
        return success(response.text());
      } catch (e) {
        return error(e);
      }
    }
  );

  // Media MIME type resolver
  const MIME_MAP = {
    // Images
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    // Audio
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac',
    aac: 'audio/aac', m4a: 'audio/mp4', wma: 'audio/x-ms-wma', opus: 'audio/opus',
    // Video
    mp4: 'video/mp4', avi: 'video/x-msvideo', mov: 'video/quicktime',
    mkv: 'video/x-matroska', webm: 'video/webm', wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv', m4v: 'video/mp4', '3gp': 'video/3gpp',
    // Documents
    pdf: 'application/pdf',
  };

  function getMimeType(filePath) {
    const ext = filePath.toLowerCase().split('.').pop();
    return MIME_MAP[ext] || 'application/octet-stream';
  }

  // 2. gemini_analyze_image - Analyze an image file with Gemini Vision
  server.tool(
    'gemini_analyze_image',
    'Analyze an image file with Gemini Vision',
    {
      imagePath: z.string().describe('Absolute path to the image file'),
      prompt: z.string().optional().describe('Prompt for image analysis (default: Describe this image in detail)'),
      model: z.string().optional().describe('Model name (default: gemini-3.1-pro-preview)'),
    },
    async ({ imagePath, prompt, model: modelName }) => {
      try {
        const imageBuffer = readFileSync(validateFilePath(imagePath));
        const base64data = imageBuffer.toString('base64');
        const mimeType = getMimeType(imagePath);

        const imagePart = {
          inlineData: { data: base64data, mimeType },
        };

        const model = genAI.getGenerativeModel({
          model: modelName || 'gemini-3.1-pro-preview',
          safetySettings,
        });

        const result = await model.generateContent([prompt || 'Describe this image in detail', imagePart]);
        return success(result.response.text());
      } catch (e) {
        return error(e);
      }
    }
  );

  // 2b. gemini_analyze_audio - Analyze an audio file with Gemini
  server.tool(
    'gemini_analyze_audio',
    'Analyze an audio file with Gemini (transcribe, summarize, describe)',
    {
      audioPath: z.string().describe('Absolute path to the audio file'),
      prompt: z.string().optional().describe('Prompt for audio analysis (default: Transcribe and describe this audio)'),
      model: z.string().optional().describe('Model name (default: gemini-3.1-pro-preview)'),
    },
    async ({ audioPath, prompt, model: modelName }) => {
      try {
        const audioBuffer = readFileSync(validateFilePath(audioPath));
        const base64data = audioBuffer.toString('base64');
        const mimeType = getMimeType(audioPath);

        const audioPart = {
          inlineData: { data: base64data, mimeType },
        };

        const model = genAI.getGenerativeModel({
          model: modelName || 'gemini-3.1-pro-preview',
          safetySettings,
        });

        const result = await model.generateContent([prompt || 'Transcribe and describe this audio', audioPart]);
        return success(result.response.text());
      } catch (e) {
        return error(e);
      }
    }
  );

  // 2c. gemini_analyze_video - Analyze a video file with Gemini
  server.tool(
    'gemini_analyze_video',
    'Analyze a video file with Gemini (describe, summarize, extract info)',
    {
      videoPath: z.string().describe('Absolute path to the video file'),
      prompt: z.string().optional().describe('Prompt for video analysis (default: Describe what happens in this video)'),
      model: z.string().optional().describe('Model name (default: gemini-3.1-pro-preview)'),
    },
    async ({ videoPath, prompt, model: modelName }) => {
      try {
        const videoBuffer = readFileSync(validateFilePath(videoPath));
        const base64data = videoBuffer.toString('base64');
        const mimeType = getMimeType(videoPath);

        const videoPart = {
          inlineData: { data: base64data, mimeType },
        };

        const model = genAI.getGenerativeModel({
          model: modelName || 'gemini-3.1-pro-preview',
          safetySettings,
        });

        const result = await model.generateContent([prompt || 'Describe what happens in this video', videoPart]);
        return success(result.response.text());
      } catch (e) {
        return error(e);
      }
    }
  );

  // 2d. gemini_analyze_pdf - Analyze a PDF document with Gemini
  server.tool(
    'gemini_analyze_pdf',
    'Analyze a PDF document with Gemini (summarize, extract, answer questions)',
    {
      pdfPath: z.string().describe('Absolute path to the PDF file'),
      prompt: z.string().optional().describe('Prompt for PDF analysis (default: Summarize this document)'),
      model: z.string().optional().describe('Model name (default: gemini-3.1-pro-preview)'),
    },
    async ({ pdfPath, prompt, model: modelName }) => {
      try {
        const pdfBuffer = readFileSync(validateFilePath(pdfPath));
        const base64data = pdfBuffer.toString('base64');

        const pdfPart = {
          inlineData: { data: base64data, mimeType: 'application/pdf' },
        };

        const model = genAI.getGenerativeModel({
          model: modelName || 'gemini-3.1-pro-preview',
          safetySettings,
        });

        const result = await model.generateContent([prompt || 'Summarize this document', pdfPart]);
        return success(result.response.text());
      } catch (e) {
        return error(e);
      }
    }
  );

  // 3. gemini_chat_multi - Multi-turn conversation with Gemini
  server.tool(
    'gemini_chat_multi',
    'Multi-turn conversation with Gemini using message history',
    {
      messages: z.string().describe('JSON array of {role: "user"|"model", text: "..."} messages'),
      model: z.string().optional().describe('Model name (default: gemini-3.1-pro-preview)'),
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

        const modelConfig = {
          model: modelName || 'gemini-3.1-pro-preview',
          safetySettings,
        };
        if (systemInstruction) modelConfig.systemInstruction = systemInstruction;

        const model = genAI.getGenerativeModel(modelConfig);
        const chat = model.startChat({ history });
        const result = await chat.sendMessage(lastMessage.parts);
        const response = result.response;
        return success(response.text());
      } catch (e) {
        return error(e);
      }
    }
  );

  // 4. gemini_search_grounded - Chat with Google Search grounding
  server.tool(
    'gemini_search_grounded',
    'Send a prompt to Gemini with Google Search grounding for up-to-date information',
    {
      prompt: z.string().describe('The prompt to send with search grounding'),
      model: z.string().optional().describe('Model name (default: gemini-3.1-pro-preview)'),
    },
    async ({ prompt, model: modelName }) => {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName || 'gemini-3.1-pro-preview',
          safetySettings,
          tools: [{ googleSearchRetrieval: {} }],
        });

        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();

        let output = text;

        const candidate = response.candidates?.[0];
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

        return success(output);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 5. gemini_structured_output - Get JSON structured output from Gemini
  server.tool(
    'gemini_structured_output',
    'Get structured JSON output from Gemini using a provided JSON schema',
    {
      prompt: z.string().describe('The prompt to send to Gemini'),
      jsonSchema: z.string().describe('JSON schema string defining the expected output structure'),
      model: z.string().optional().describe('Model name (default: gemini-3.1-pro-preview)'),
    },
    async ({ prompt, jsonSchema, model: modelName }) => {
      try {
        const parsedSchema = JSON.parse(jsonSchema);

        const model = genAI.getGenerativeModel({
          model: modelName || 'gemini-3.1-pro-preview',
          safetySettings,
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: parsedSchema,
          },
        });

        const result = await model.generateContent(prompt);
        const response = result.response;
        return success(response.text());
      } catch (e) {
        return error(e);
      }
    }
  );
}
