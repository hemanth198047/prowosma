// Backup AI providers: the services an admin can pick, and how rows are converted to and from what the server sends.

export const MAX_BACKUPS = 3;

/** Services an admin can add as a backup. Most are "OpenAI-compatible", so they only differ by address. */
export const BACKUP_PRESETS = [
  { id: "GEMINI", label: "Google Gemini", apiProvider: "GEMINI", url: "", keyUrl: "https://aistudio.google.com/app/apikey", tag: "Free tier", hint: "AIza..." },
  { id: "GROQ", label: "Groq", apiProvider: "CUSTOM", url: "https://api.groq.com/openai/v1/chat/completions", keyUrl: "https://console.groq.com/keys", tag: "Free tier", hint: "gsk_..." },
  { id: "MISTRAL", label: "Mistral", apiProvider: "CUSTOM", url: "https://api.mistral.ai/v1/chat/completions", keyUrl: "https://console.mistral.ai/api-keys", tag: "Free tier", hint: "your Mistral key" },
  { id: "OPENROUTER", label: "OpenRouter", apiProvider: "CUSTOM", url: "https://openrouter.ai/api/v1/chat/completions", keyUrl: "https://openrouter.ai/keys", tag: "Free models", hint: "sk-or-..." },
  { id: "CEREBRAS", label: "Cerebras", apiProvider: "CUSTOM", url: "https://api.cerebras.ai/v1/chat/completions", keyUrl: "https://cloud.cerebras.ai/", tag: "Free tier", hint: "csk-..." },
  { id: "OPENAI", label: "OpenAI (ChatGPT)", apiProvider: "OPENAI", url: "", keyUrl: "https://platform.openai.com/api-keys", tag: "Paid", hint: "sk-proj-..." },
  { id: "ANTHROPIC", label: "Anthropic (Claude)", apiProvider: "ANTHROPIC", url: "", keyUrl: "https://console.anthropic.com/settings/keys", tag: "Paid", hint: "sk-ant-api..." },
  { id: "OTHER", label: "Other (OpenAI-compatible)", apiProvider: "CUSTOM", url: "", keyUrl: "", tag: "Advanced", hint: "your-api-key" },
];

export function presetOf(b) {
  const p = (b.apiProvider || "CUSTOM").toUpperCase();
  const url = (b.apiBaseUrl || "").replace(/\/+$/, "").toLowerCase();
  return (
    BACKUP_PRESETS.find((x) => x.apiProvider === p && (p !== "CUSTOM" ? true : x.url && x.url.toLowerCase() === url)) ||
    BACKUP_PRESETS.find((x) => x.id === "OTHER")
  );
}

/** The saved list from the server (keys are never sent back) as editable rows. */
export function backupsFromServer(list) {
  return (list || []).map((b) => ({ ...b, apiKey: "", _k: b.id || Math.random().toString(36).slice(2) }));
}

/** What the server expects: no helper fields. A blank apiKey means "keep the saved one". */
export function backupsForServer(rows) {
  return (rows || []).map((b) => ({
    id: b.id || null,
    label: b.label || presetOf(b).label,
    apiProvider: b.apiProvider,
    apiBaseUrl: b.apiBaseUrl || "",
    model: b.model || "",
    apiKey: (b.apiKey || "").trim(),
  }));
}

