export interface Model {
  id: string; // the actual model string sent to the API
  name: string; // display name shown in the picker
}

export interface Provider {
  id: string; // internal key, also used for storing the API key in-memory
  name: string; // display name
  envKey: string; // env var name checked first for an existing API key
  baseUrl: string; // chat completions endpoint
  apiFormat: "openai" | "anthropic"; // request/response shape — most providers are OpenAI-compatible, Anthropic is not
  models: Model[];
}

// NOTE: model lineups change often (deprecations, renames, new releases).
// Groq's list above was verified against https://console.groq.com/docs/models
// at the time this was written. The others are believed accurate but
// weren't all individually re-verified — if a model 404s, check the
// provider's docs and update its `id` here.
export const PROVIDERS: Provider[] = [
  {
    id: "groq",
    name: "Groq",
    envKey: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiFormat: "openai",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant" },
      { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
      { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B" },
      { id: "groq/compound", name: "Groq Compound (agentic)" },
      { id: "groq/compound-mini", name: "Groq Compound Mini (agentic)" },
      { id: "qwen/qwen3.6-27b", name: "Qwen3.6 27B (preview)" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    apiFormat: "openai",
    models: [
      { id: "anthropic/claude-opus-4.1", name: "Claude Opus 4.1" },
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
      { id: "anthropic/claude-3.5-haiku", name: "Claude 3.5 Haiku" },
      { id: "openai/gpt-4o", name: "GPT-4o" },
      { id: "openai/gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "openai/o3", name: "o3" },
      { id: "openai/o4-mini", name: "o4-mini" },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "meta-llama/llama-3.1-70b-instruct", name: "Llama 3.1 70B" },
      { id: "meta-llama/llama-4-maverick", name: "Llama 4 Maverick" },
      { id: "mistralai/mistral-large", name: "Mistral Large" },
      { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
      { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
      { id: "qwen/qwen-2.5-72b-instruct", name: "Qwen 2.5 72B" },
      { id: "x-ai/grok-4", name: "Grok 4" },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    envKey: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1/chat/completions",
    apiFormat: "openai",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
      { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
      { id: "o3", name: "o3" },
      { id: "o3-mini", name: "o3-mini" },
      { id: "o4-mini", name: "o4-mini" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com/v1/messages",
    apiFormat: "anthropic",
    models: [
      { id: "claude-opus-4-1-20250805", name: "Claude Opus 4.1" },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus" },
      { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku" },
    ],
  },
  {
    id: "gemini",
    name: "Gemini",
    envKey: "GEMINI_API_KEY",
    // Google's OpenAI-compatibility layer, so this can use the same
    // request/response handling as the other OpenAI-format providers
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    apiFormat: "openai",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/chat/completions",
    apiFormat: "openai",
    models: [
      { id: "deepseek-chat", name: "DeepSeek Chat (V3)" },
      { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)" },
    ],
  },
];
