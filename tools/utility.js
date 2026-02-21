import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function success(text) {
  return { content: [{ type: 'text', text }] };
}

function error(e) {
  return { content: [{ type: 'text', text: 'Error: ' + (e?.message || String(e)) }], isError: true };
}

export function registerUtilityTools(server) {

  // 1. List available Gemini models
  server.tool(
    'gemini_list_models',
    'List available Gemini models with their capabilities and token limits',
    {},
    async () => {
      try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          return error('GEMINI_API_KEY environment variable is not set');
        }

        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models',
          { headers: { 'x-goog-api-key': apiKey } }
        );
        if (!res.ok) {
          return error(`API request failed: ${res.status} ${res.statusText}`);
        }

        const data = await res.json();
        const models = data.models || [];

        if (models.length === 0) {
          return success('No models found.');
        }

        const formatted = models.map((m, i) => {
          const methods = Array.isArray(m.supportedGenerationMethods)
            ? m.supportedGenerationMethods.join(', ')
            : 'N/A';
          return [
            `${i + 1}. ${m.displayName || m.name}`,
            `   Name: ${m.name}`,
            `   Description: ${m.description || 'N/A'}`,
            `   Input Token Limit: ${m.inputTokenLimit ?? 'N/A'}`,
            `   Output Token Limit: ${m.outputTokenLimit ?? 'N/A'}`,
            `   Supported Methods: ${methods}`,
          ].join('\n');
        }).join('\n\n');

        return success(`Available Gemini Models (${models.length}):\n\n${formatted}`);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 2. Count tokens in text
  server.tool(
    'gemini_count_tokens',
    'Count the number of tokens in the provided text using a Gemini model',
    {
      text: z.string().describe('The text to count tokens for'),
      model: z.string().optional().describe('Model to use for tokenization (default: gemini-3.1-pro-preview)'),
    },
    async ({ text, model: modelName }) => {
      try {
        const name = modelName || 'gemini-3.1-pro-preview';
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.countTokens(text);
        return success(`Token count (model: ${name}): ${result.totalTokens}`);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 3. Generate text embeddings
  server.tool(
    'gemini_embed',
    'Generate text embeddings using a Gemini embedding model',
    {
      text: z.string().describe('The text to generate embeddings for'),
      model: z.string().optional().describe('Embedding model to use (default: text-embedding-004)'),
    },
    async ({ text, model: modelName }) => {
      try {
        const name = modelName || 'text-embedding-004';
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.embedContent(text);
        const values = result.embedding.values;
        const preview = values.slice(0, 10).map((v) => v.toFixed(6)).join(', ');
        return success(
          `Embedding (model: ${name}):\n` +
          `Dimensions: ${values.length}\n` +
          `First 10 values: [${preview}]\n` +
          `(${values.length - 10} more values omitted)`
        );
      } catch (e) {
        return error(e);
      }
    }
  );

  // 4. Generate and execute code using Gemini's code execution feature
  server.tool(
    'gemini_code_execute',
    'Generate and execute code using Gemini\'s built-in code execution capability',
    {
      prompt: z.string().describe('The prompt describing what code to generate and execute'),
      model: z.string().optional().describe('Model to use (default: gemini-3.1-pro-preview)'),
    },
    async ({ prompt, model: modelName }) => {
      try {
        const name = modelName || 'gemini-3.1-pro-preview';
        const model = genAI.getGenerativeModel({
          model: name,
          tools: [{ codeExecution: {} }],
        });
        const result = await model.generateContent(prompt);
        const response = result.response;
        const parts = response.candidates?.[0]?.content?.parts || [];

        if (parts.length === 0) {
          return success('No response parts received from the model.');
        }

        const sections = [];
        for (const part of parts) {
          if (part.text) {
            sections.push(`**Text:**\n${part.text}`);
          }
          if (part.executableCode) {
            const lang = part.executableCode.language || 'unknown';
            sections.push(
              `**Code (${lang}):**\n\`\`\`${lang}\n${part.executableCode.code}\n\`\`\``
            );
          }
          if (part.codeExecutionResult) {
            const outcome = part.codeExecutionResult.outcome || 'unknown';
            const output = part.codeExecutionResult.output || '(no output)';
            sections.push(
              `**Execution Result (${outcome}):**\n\`\`\`\n${output}\n\`\`\``
            );
          }
        }

        return success(sections.join('\n\n'));
      } catch (e) {
        return error(e);
      }
    }
  );

  // 5. Summarize long text with Gemini
  server.tool(
    'gemini_summarize',
    'Summarize long text using Gemini with configurable summary style',
    {
      text: z.string().describe('The text to summarize'),
      style: z.string().optional().describe('Summary style: brief, detailed, bullet-points (default: brief)'),
      model: z.string().optional().describe('Model to use (default: gemini-3.1-pro-preview)'),
    },
    async ({ text, style, model: modelName }) => {
      try {
        const name = modelName || 'gemini-3.1-pro-preview';
        const summaryStyle = style || 'brief';
        const model = genAI.getGenerativeModel({ model: name });
        const prompt = `Summarize the following text in a ${summaryStyle} style:\n\n${text}`;
        const result = await model.generateContent(prompt);
        const response = result.response;
        return success(response.text());
      } catch (e) {
        return error(e);
      }
    }
  );

  // 6. Translate text using Gemini
  server.tool(
    'gemini_translate',
    'Translate text to a target language using Gemini',
    {
      text: z.string().describe('The text to translate'),
      targetLanguage: z.string().describe('The language to translate into'),
      sourceLanguage: z.string().optional().describe('The source language (auto-detected if omitted)'),
    },
    async ({ text, targetLanguage, sourceLanguage }) => {
      try {
        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview' });
        const prompt = sourceLanguage
          ? `Translate the following text from ${sourceLanguage} to ${targetLanguage}:\n\n${text}`
          : `Translate the following text to ${targetLanguage}:\n\n${text}`;
        const result = await model.generateContent(prompt);
        const response = result.response;
        return success(response.text());
      } catch (e) {
        return error(e);
      }
    }
  );
}
