import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { GoogleGenerativeAI, Content, Part } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk"; // Import the default export
import { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs"; // Import the specific type
import OpenAI from "openai";
import { ChatModel } from 'openai/resources';

// Define an interface for the configuration passed from agents
interface LlmConfig {
  provider?: string;
  model?: string;
  maxTokens?: number;
  apiKey?: string; // Generic key, specific keys passed within (used for OpenRouter)
  // baseURL?: string; // Removed - OpenRouter URL will be hardcoded
  geminiApiKey?: string;
  anthropicApiKey?: string;
}

export async function callLlm(
  messages: ChatCompletionMessageParam[],
  config: LlmConfig
): Promise<string> {
  const {
    provider,
    model,
    maxTokens = 4096,
    apiKey, // Keep generic apiKey for OpenRouter case
    // baseURL, // Removed
    geminiApiKey,
    anthropicApiKey
  } = config;

  const lowerCaseProvider = provider?.toLowerCase();

  if (lowerCaseProvider === 'openrouter') {
    if (!apiKey) throw new Error("OpenRouter API key is required for 'openrouter' provider.");
    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://openrouter.ai/api/v1', // Hardcoded OpenRouter URL
    });
    const completion = await openai.chat.completions.create({
      model: (model || 'openai/gpt-4o') as ChatModel, // Use provided model or default
      max_tokens: maxTokens,
      messages
    });
    return completion.choices?.[0]?.message?.content || '';
  }

  if (lowerCaseProvider === 'gemini') {
    if (!geminiApiKey) throw new Error("Gemini API key is required for 'gemini' provider.");
    const gemini = new GoogleGenerativeAI(geminiApiKey);
    const model_name = model || 'gemini-1.5-pro'; // Use provided model or default
    const genModel = gemini.getGenerativeModel({ model: model_name });

    // Correctly map messages to Gemini's Content[] format
    const geminiHistory: Content[] = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content as string }] as Part[] // Ensure parts is an array of Part
    }));

    const result = await genModel.generateContent({
      contents: geminiHistory,
      generationConfig: {
        maxOutputTokens: maxTokens
      }
    });
    const response = await result.response;
    return response.text() || '';
  }

  if (lowerCaseProvider === 'anthropic') {
    if (!anthropicApiKey) throw new Error("Anthropic API key is required for 'anthropic' provider.");
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    // Correctly map messages to Anthropic's MessageParam[] format with explicit roles
    const anthropicMessages: MessageParam[] = messages.map(m => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: m.content as string
    }));

    const raw = await anthropic.messages.create({
      model: (model || 'claude-3-sonnet-20240229') as any, // Use provided model or default
      max_tokens: maxTokens,
      messages: anthropicMessages,
    });
    // Check if the first content block is a TextBlock before accessing text
    const firstContent = raw.content[0];
    return firstContent && firstContent.type === 'text' ? firstContent.text : '';
  }

  throw new Error(`Unsupported provider '${lowerCaseProvider}'. Set LLM_PROVIDER env var to 'openrouter', 'gemini', or 'anthropic'`);
}
