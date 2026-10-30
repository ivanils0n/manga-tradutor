// Provedores de IA e configurações salvas. Usado pelo background e pela página de configurações.

export const PROVEDORES = {
  deepseek: {
    nome: "DeepSeek", tipo: "openai", url: "https://api.deepseek.com", modelo: "deepseek-flash",
    sugestoes: ["deepseek-flash"], site: "https://platform.deepseek.com/api_keys",
    extras: { thinking: { type: "disabled" }, response_format: { type: "json_object" } },
  },
  gemini: {
    nome: "Google Gemini", tipo: "gemini", url: "https://generativelanguage.googleapis.com",
    modelo: "gemini-3.5-flash-lite", sugestoes: ["gemini-3.5-flash-lite", "gemini-3.8-flash"],
    site: "https://aistudio.google.com/apikey",
    coords: "yx", // o Gemini foi treinado com caixas [ymin, xmin, ymax, xmax]
  },
  openai: {
    nome: "OpenAI", tipo: "openai", url: "https://api.openai.com/v1", modelo: "gpt-4.1-mini",
    sugestoes: ["gpt-4.1-mini", "gpt-4.1"], site: "https://platform.openai.com/api-keys",
    extras: { response_format: { type: "json_object" } },
  },
  claude: {
    nome: "Anthropic Claude", tipo: "claude", url: "https://api.anthropic.com", modelo: "claude-haiku-5-5",
    sugestoes: ["claude-haiku-5-5", "claude-sonnet-5-5"], site: "https://console.anthropic.com/settings/keys",
  },
  openrouter: {
    nome: "OpenRouter", tipo: "openai", url: "https://openrouter.ai/api/v1", modelo: "google/gemini-3.5-flash-lite",
    sugestoes: ["google/gemini-3.5-flash-lite", "openai/gpt-4.1-mini"], site: "https://openrouter.ai/keys",
  },
  ollama: {
    nome: "Ollama (no PC)", tipo: "openai", url: "http://localhost:11434/v1", modelo: "qwen2.5vl",
    sugestoes: ["qwen2.5vl", "gemma3"], semChave: true, editarUrl: true,
  },
  personalizado: {
    nome: "Outro (compatível com OpenAI)", tipo: "openai", url: "", modelo: "", editarUrl: true,
  },
};

export const IDIOMAS = {
  "pt-BR": "Português (Brasil)", "pt-PT": "Português (Portugal)", en: "English", es: "Español",
  fr: "Français", it: "Italiano", de: "Deutsch",
};

export const PADRAO = {
  provedor: "deepseek", chaves: {}, modelos: {}, urls: {},
  idioma: "pt-BR", honorificos: true, onomatopeias: false, maiusculas: false, fonte: "quadrinhos", glossario: "",
  adiantar: "todas", // modo ao rolar: "tela", "3", "10" (telas à frente) ou "todas" as páginas carregadas
};

/** Configuração pronta para uso: provedor escolhido já com chave, modelo e URL resolvidos. */
export async function lerConfig() {
  const s = { ...PADRAO, ...(await chrome.storage.local.get(null)) };
  // versões antigas guardavam só a chave/modelo da DeepSeek
  if (s.chave && !s.chaves.deepseek) s.chaves = { ...s.chaves, deepseek: s.chave };
  if (s.modelo && !s.modelos.deepseek) s.modelos = { ...s.modelos, deepseek: s.modelo };
  const p = PROVEDORES[s.provedor] ? s.provedor : "deepseek";
  const def = PROVEDORES[p];
  return {
    ...s, provedor: p, def,
    chave: (s.chaves[p] || "").trim(),
    modelo: (s.modelos[p] || def.modelo).trim(),
    url: (s.urls[p] || def.url).trim().replace(/\/+$/, ""),
  };
}

export function faltaConfig(cfg) {
  if (!cfg.def.semChave && cfg.provedor !== "personalizado" && !cfg.chave) return "Falta a chave da API";
  if (!cfg.url) return "Falta o endereço da API";
  if (!cfg.modelo) return "Falta o modelo";
  return "";
}
