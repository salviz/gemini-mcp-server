import { GoogleGenAI } from '@google/genai';

if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY environment variable is required. See README.md for setup.');
}

export const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
export const DEFAULT_MODEL = 'gemini-3.1-pro-preview';

export const safetySettings = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
];

// Max settings for quality
export const DEFAULT_CONFIG = {
  safetySettings,
  thinkingConfig: { thinkingBudget: 65535 },
  mediaResolution: 'MEDIA_RESOLUTION_HIGH',
  maxOutputTokens: 65536,
};

export function extractText(response) {
  if (!response) return '(empty response)';
  try {
    return response.text ?? '(no text in response)';
  } catch {
    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) return parts.map(p => p.text || '').join('');
    return '(could not extract text from response)';
  }
}

export function success(text) {
  return { content: [{ type: 'text', text }] };
}

export function error(e) {
  return { content: [{ type: 'text', text: 'Error: ' + (e?.message || String(e)) }], isError: true };
}
