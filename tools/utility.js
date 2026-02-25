import { ai, DEFAULT_MODEL, DEFAULT_CONFIG, extractText, success, error } from './shared.js';
import { z } from 'zod';

export function registerUtilityTools(server) {

  // 1. gemini_list_models
  server.tool(
    'gemini_list_models',
    'List available Gemini models with their capabilities and token limits',
    {},
    async () => {
      try {
        const pager = await ai.models.list({ config: { pageSize: 100 } });
        const models = [];
        for await (const m of pager) {
          models.push(m);
        }

        if (models.length === 0) {
          return success('No models found.');
        }

        const formatted = models.map((m, i) => {
          const methods = Array.isArray(m.supportedActions)
            ? m.supportedActions.join(', ')
            : (Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods.join(', ') : 'N/A');
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

  // 2. gemini_count_tokens
  server.tool(
    'gemini_count_tokens',
    'Count the number of tokens in the provided text using a Gemini model',
    {
      text: z.string().describe('The text to count tokens for'),
      model: z.string().optional().describe(`Model to use (default: ${DEFAULT_MODEL})`),
    },
    async ({ text, model: modelName }) => {
      try {
        const name = modelName || DEFAULT_MODEL;
        const result = await ai.models.countTokens({
          model: name,
          contents: text,
        });
        return success(`Token count (model: ${name}): ${result.totalTokens}`);
      } catch (e) {
        return error(e);
      }
    }
  );

  // 3. gemini_embed
  server.tool(
    'gemini_embed',
    'Generate text embeddings using a Gemini embedding model',
    {
      text: z.string().describe('The text to generate embeddings for'),
      model: z.string().optional().describe('Embedding model to use (default: gemini-embedding-001)'),
    },
    async ({ text, model: modelName }) => {
      try {
        const name = modelName || 'gemini-embedding-001';
        const result = await ai.models.embedContent({
          model: name,
          contents: text,
        });
        const embedding = result.embeddings?.[0] || result.embedding;
        const values = embedding?.values || [];
        if (values.length === 0) {
          return success(`Embedding (model: ${name}): No values returned.`);
        }
        const preview = values.slice(0, 10).map((v) => v.toFixed(6)).join(', ');
        return success(
          `Embedding (model: ${name}):\n` +
          `Dimensions: ${values.length}\n` +
          `First 10 values: [${preview}]\n` +
          `(${Math.max(0, values.length - 10)} more values omitted)`
        );
      } catch (e) {
        return error(e);
      }
    }
  );

  // 4. gemini_code_execute
  server.tool(
    'gemini_code_execute',
    'Generate and execute code using Gemini\'s built-in code execution capability',
    {
      prompt: z.string().describe('The prompt describing what code to generate and execute'),
      model: z.string().optional().describe(`Model to use (default: ${DEFAULT_MODEL})`),
    },
    async ({ prompt, model: modelName }) => {
      try {
        const name = modelName || DEFAULT_MODEL;
        const response = await ai.models.generateContent({
          model: name,
          contents: prompt,
          config: { ...DEFAULT_CONFIG, tools: [{ codeExecution: {} }] },
        });

        const parts = response.candidates?.[0]?.content?.parts || [];

        if (parts.length === 0) {
          return success(extractText(response) || 'No response parts received from the model.');
        }

        const sections = [];
        for (const part of parts) {
          if (part.text) {
            sections.push(`**Text:**\n${part.text}`);
          }
          if (part.executableCode) {
            const lang = part.executableCode.language || 'python';
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

  // 5. gemini_summarize
  server.tool(
    'gemini_summarize',
    'Summarize long text using Gemini with configurable summary style',
    {
      text: z.string().describe('The text to summarize'),
      style: z.string().optional().describe('Summary style: brief, detailed, bullet-points (default: brief)'),
      model: z.string().optional().describe(`Model to use (default: ${DEFAULT_MODEL})`),
    },
    async ({ text, style, model: modelName }) => {
      try {
        const name = modelName || DEFAULT_MODEL;
        const summaryStyle = style || 'brief';
        const response = await ai.models.generateContent({
          model: name,
          contents: `Summarize the following text in a ${summaryStyle} style:\n\n${text}`,
          config: { ...DEFAULT_CONFIG },
        });
        return success(extractText(response));
      } catch (e) {
        return error(e);
      }
    }
  );

  // 6. gemini_translate
  server.tool(
    'gemini_translate',
    'Translate text to a target language using Gemini',
    {
      text: z.string().describe('The text to translate'),
      targetLanguage: z.string().describe('The language to translate into'),
      sourceLanguage: z.string().optional().describe('The source language (auto-detected if omitted)'),
      model: z.string().optional().describe(`Model to use (default: ${DEFAULT_MODEL})`),
    },
    async ({ text, targetLanguage, sourceLanguage, model: modelName }) => {
      try {
        const prompt = sourceLanguage
          ? `Translate the following text from ${sourceLanguage} to ${targetLanguage}:\n\n${text}`
          : `Translate the following text to ${targetLanguage}:\n\n${text}`;
        const response = await ai.models.generateContent({
          model: modelName || DEFAULT_MODEL,
          contents: prompt,
          config: { ...DEFAULT_CONFIG },
        });
        return success(extractText(response));
      } catch (e) {
        return error(e);
      }
    }
  );
}
