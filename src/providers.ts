import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// AI Provider / Model Registry
//
// Built-in providers (Gemini, Groq, Poolside, OpenRouter) are seeded from code
// and read their API keys from environment variables. Users can add custom
// OpenAI-compatible providers (or extra models to any provider) through the
// web UI; those additions are persisted server-side in model-config.json
// (gitignored). Custom API keys live ONLY on the server — they are stripped
// before any registry payload is sent to the browser.
// ---------------------------------------------------------------------------

export type ProviderKind = "openai-compatible" | "gemini";

export interface ModelConfig {
  id: string;       // model slug sent to the provider API
  name: string;     // display label
  badge?: string;   // e.g. "Recommended"
  desc?: string;
  builtin?: boolean; // true for seeded built-in models (not user-editable)
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl?: string;    // required for "openai-compatible"; omitted for Gemini
  apiKeyEnv?: string;  // env var holding the key (built-in providers)
  apiKey?: string;     // stored key (custom providers) — NEVER exposed to client
  builtin?: boolean;
  models: ModelConfig[];
}

export interface RegistryFile {
  defaultProvider: string;
  defaultModel: string;
  providers: ProviderConfig[];                 // user-added providers only
  extraModels: Record<string, ModelConfig[]>;  // models added to any provider id
}

export interface PublicProvider extends Omit<ProviderConfig, "apiKey"> {
  hasKey: boolean;
}

export interface PublicRegistry {
  defaultProvider: string;
  defaultModel: string;
  providers: PublicProvider[];
  models: { providerId: string; providerName: string; kind: ProviderKind; hasKey: boolean; model: ModelConfig }[];
}

const CONFIG_PATH = path.join(process.cwd(), "model-config.json");

const DEFAULT_FILE: RegistryFile = {
  defaultProvider: "gemini",
  defaultModel: "gemini-3-flash-preview",
  providers: [],
  extraModels: {},
};

// --- Built-in provider catalog -------------------------------------------------

const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    id: "gemini",
    name: "Gemini (Google)",
    kind: "gemini",
    apiKeyEnv: "GEMINI_API_KEY",
    builtin: true,
    models: [
      { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", badge: "Recommended", desc: "Fast, structured output, function calling" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", badge: "Deep", desc: "Deep reasoning for complex financial analysis" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", badge: "Fast", desc: "Low-latency responses at scale" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    builtin: true,
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", badge: "Recommended", desc: "Best for structured output and function calling" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", badge: "Fastest", desc: "Ultra-low latency for quick responses" },
      { id: "gemma2-9b-it", name: "Gemma 2 9B", badge: "Compact", desc: "Lightweight and efficient for simple tasks" },
    ],
  },
  {
    id: "poolside",
    name: "Poolside",
    kind: "openai-compatible",
    baseUrl: "https://inference.poolside.ai/v1",
    apiKeyEnv: "POOLSIDE_API_KEY",
    builtin: true,
    models: [
      { id: "poolside/laguna-s-2.1", name: "Laguna S 2.1", badge: "Stable", desc: "Reliable structured output" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    builtin: true,
    models: [
      { id: "google/gemma-4-26b-a4b-it:free", name: "Gemma 4 26B (free)", badge: "Free", desc: "Free-tier fallback model" },
    ],
  },
];

// --- Config persistence --------------------------------------------------------

function loadFile(): RegistryFile {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
      return {
        ...DEFAULT_FILE,
        ...raw,
        providers: Array.isArray(raw.providers) ? raw.providers : [],
        extraModels: raw.extraModels && typeof raw.extraModels === "object" ? raw.extraModels : {},
      };
    }
  } catch (e: any) {
    console.warn("[providers] Failed to read model-config.json:", e.message?.slice(0, 120));
  }
  return structuredClone(DEFAULT_FILE);
}

function saveFile(file: RegistryFile): void {
  try {
    const tmp = `${CONFIG_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2), "utf-8");
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (e: any) {
    console.error("[providers] Failed to write model-config.json:", e.message);
    throw new Error("Could not persist provider config on the server.");
  }
}

// --- Registry construction ------------------------------------------------------

export function getRegistry(): { defaultProvider: string; defaultModel: string; providers: ProviderConfig[] } {
  const file = loadFile();

  const providerMap = new Map<string, ProviderConfig>();
  for (const bp of BUILTIN_PROVIDERS) {
    providerMap.set(bp.id, {
      ...bp,
      models: bp.models.map((m) => ({ ...m, builtin: true })),
    });
  }
  for (const cp of file.providers) {
    providerMap.set(cp.id, {
      ...cp,
      builtin: false,
      models: [...(cp.models || [])],
    });
  }

  // Merge user-added extra models onto any provider
  for (const [pid, models] of Object.entries(file.extraModels)) {
    const p = providerMap.get(pid);
    if (!p) continue;
    for (const m of models) {
      if (!p.models.some((x) => x.id === m.id)) p.models.push(m);
    }
  }

  return {
    defaultProvider: file.defaultProvider || DEFAULT_FILE.defaultProvider,
    defaultModel: file.defaultModel || DEFAULT_FILE.defaultModel,
    providers: [...providerMap.values()],
  };
}

export function resolveApiKey(p: ProviderConfig): string | undefined {
  if (p.apiKey) return p.apiKey;
  if (p.apiKeyEnv) return process.env[p.apiKeyEnv] || undefined;
  // Gemini SDK also honors GOOGLE_API_KEY
  if (p.id === "gemini") return process.env.GOOGLE_API_KEY || undefined;
  return undefined;
}

export function getPublicRegistry(): PublicRegistry {
  const reg = getRegistry();
  const providers: PublicProvider[] = reg.providers.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    baseUrl: p.baseUrl,
    apiKeyEnv: p.apiKeyEnv,
    builtin: p.builtin,
    models: p.models,
    hasKey: !!resolveApiKey(p),
  }));

  const models: PublicRegistry["models"] = [];
  for (const p of providers) {
    for (const m of p.models) {
      models.push({ providerId: p.id, providerName: p.name, kind: p.kind, hasKey: p.hasKey, model: m });
    }
  }

  return {
    defaultProvider: reg.defaultProvider,
    defaultModel: reg.defaultModel,
    providers,
    models,
  };
}

export function getProvider(id: string): ProviderConfig | undefined {
  return getRegistry().providers.find((p) => p.id === id);
}

// --- Mutations -------------------------------------------------------------------

export function addProvider(input: {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey: string;
  models: ModelConfig[];
}): PublicRegistry {
  const id = input.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  if (!id) throw new Error("Provider id is required.");
  if (!input.name?.trim()) throw new Error("Provider name is required.");
  if (!input.apiKey?.trim()) throw new Error("API key is required.");
  if (!Array.isArray(input.models)) throw new Error("models must be an array.");
  if (input.kind === "openai-compatible") {
    if (!input.baseUrl?.trim() || !/^https?:\/\/.+/.test(input.baseUrl.trim())) {
      throw new Error("A valid http(s) base URL is required for OpenAI-compatible providers.");
    }
  }

  const file = loadFile();
  if (file.providers.some((p) => p.id === id) || BUILTIN_PROVIDERS.some((p) => p.id === id)) {
    throw new Error(`A provider with id "${id}" already exists.`);
  }

  file.providers.push({
    id,
    name: input.name.trim(),
    kind: input.kind,
    baseUrl: input.kind === "openai-compatible" ? input.baseUrl!.trim() : undefined,
    apiKey: input.apiKey.trim(),
    models: input.models,
  });
  saveFile(file);
  return getPublicRegistry();
}

export function addModel(providerId: string, model: ModelConfig): PublicRegistry {
  const reg = getRegistry();
  const p = reg.providers.find((x) => x.id === providerId);
  if (!p) throw new Error(`Unknown provider "${providerId}".`);
  if (!model.id?.trim()) throw new Error("Model id is required.");
  if (p.models.some((m) => m.id === model.id)) throw new Error(`Model "${model.id}" already exists on ${p.name}.`);

  const file = loadFile();
  const name = model.name?.trim() || model.id.trim();
  const entry: ModelConfig = { id: model.id.trim(), name, badge: model.badge, desc: model.desc };
  if (p.builtin) {
    file.extraModels[providerId] = [...(file.extraModels[providerId] || []), entry];
  } else {
    const cp = file.providers.find((x) => x.id === providerId);
    if (cp) cp.models.push(entry);
  }
  saveFile(file);
  return getPublicRegistry();
}

export function deleteProvider(providerId: string): PublicRegistry {
  const file = loadFile();
  const wasBuiltin = BUILTIN_PROVIDERS.some((p) => p.id === providerId);
  if (wasBuiltin) {
    // Built-in providers can't be removed, only their extra models.
    throw new Error(`"${providerId}" is a built-in provider and cannot be deleted.`);
  }
  file.providers = file.providers.filter((p) => p.id !== providerId);
  delete file.extraModels[providerId];
  saveFile(file);
  return getPublicRegistry();
}

export function deleteModel(providerId: string, modelId: string): PublicRegistry {
  const reg = getRegistry();
  const p = reg.providers.find((x) => x.id === providerId);
  if (!p) throw new Error(`Unknown provider "${providerId}".`);
  if (!p.models.some((m) => m.id === modelId)) throw new Error(`Unknown model "${modelId}".`);

  const file = loadFile();
  if (p.builtin) {
    const baseIds = BUILTIN_PROVIDERS.find((x) => x.id === providerId)?.models.map((m) => m.id) || [];
    if (baseIds.includes(modelId)) {
      throw new Error(`"${modelId}" is a built-in model of ${p.name} and cannot be deleted.`);
    }
    file.extraModels[providerId] = (file.extraModels[providerId] || []).filter((m) => m.id !== modelId);
  } else {
    const cp = file.providers.find((x) => x.id === providerId);
    if (cp) cp.models = cp.models.filter((m) => m.id !== modelId);
  }
  saveFile(file);
  return getPublicRegistry();
}

export function setDefault(providerId: string, modelId?: string): PublicRegistry {
  const reg = getRegistry();
  const p = reg.providers.find((x) => x.id === providerId);
  if (!p) throw new Error(`Unknown provider "${providerId}".`);
  if (modelId && !p.models.some((m) => m.id === modelId)) {
    throw new Error(`Model "${modelId}" not found on provider ${p.name}.`);
  }
  const file = loadFile();
  file.defaultProvider = providerId;
  file.defaultModel = modelId || p.models[0]?.id || file.defaultModel;
  saveFile(file);
  return getPublicRegistry();
}

export function updateProvider(
  providerId: string,
  fields: { name?: string; kind?: ProviderKind; baseUrl?: string; apiKey?: string },
): PublicRegistry {
  const reg = getRegistry();
  const p = reg.providers.find((x) => x.id === providerId);
  if (!p) throw new Error(`Unknown provider "${providerId}".`);
  if (p.builtin) throw new Error(`"${providerId}" is a built-in provider and cannot be edited.`);

  const file = loadFile();
  const cp = file.providers.find((x) => x.id === providerId);
  if (!cp) throw new Error(`Unknown provider "${providerId}".`);

  if (fields.name != null) {
    if (!fields.name.trim()) throw new Error("Provider name cannot be empty.");
    cp.name = fields.name.trim();
  }
  if (fields.kind != null) {
    if (fields.kind !== "openai-compatible" && fields.kind !== "gemini") {
      throw new Error(`Invalid provider kind "${fields.kind}".`);
    }
    cp.kind = fields.kind;
  }
  if (fields.baseUrl != null) {
    if (fields.baseUrl.trim() && !/^https?:\/\/.+/.test(fields.baseUrl.trim())) {
      throw new Error("A valid http(s) base URL is required.");
    }
    cp.baseUrl = fields.baseUrl.trim() || undefined;
  }
  if (fields.apiKey != null) {
    if (!fields.apiKey.trim()) throw new Error("API key cannot be empty.");
    cp.apiKey = fields.apiKey.trim();
  }

  saveFile(file);
  return getPublicRegistry();
}

export function updateModel(
  providerId: string,
  modelId: string,
  fields: { name?: string; badge?: string; desc?: string },
): PublicRegistry {
  const reg = getRegistry();
  const p = reg.providers.find((x) => x.id === providerId);
  if (!p) throw new Error(`Unknown provider "${providerId}".`);
  const model = p.models.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown model "${modelId}" on ${p.name}.`);
  if (fields.name != null && !fields.name.trim()) throw new Error("Model name cannot be empty.");

  const file = loadFile();
  let target: ModelConfig | undefined;

  if (p.builtin) {
    const baseIds = BUILTIN_PROVIDERS.find((x) => x.id === providerId)?.models.map((m) => m.id) || [];
    if (baseIds.includes(modelId)) {
      throw new Error(`"${modelId}" is a built-in model of ${p.name} and cannot be edited.`);
    }
    target = (file.extraModels[providerId] || []).find((m) => m.id === modelId);
  } else {
    target = file.providers.find((x) => x.id === providerId)?.models.find((m) => m.id === modelId);
  }
  if (!target) throw new Error(`Model "${modelId}" not found on ${p.name}.`);

  if (fields.name != null) target.name = fields.name.trim();
  if (fields.badge != null) target.badge = fields.badge.trim() || undefined;
  if (fields.desc != null) target.desc = fields.desc.trim() || undefined;

  saveFile(file);
  return getPublicRegistry();
}

// --- Validation / connectivity -----------------------------------------------

export async function testProvider(providerId: string, modelId: string): Promise<{ ok: boolean; message: string }> {
  const reg = getRegistry();
  const p = reg.providers.find((x) => x.id === providerId);
  if (!p) throw new Error(`Unknown provider "${providerId}".`);
  const model = p.models.find((m) => m.id === modelId);
  if (!model) throw new Error(`Unknown model "${modelId}" on ${p.name}.`);
  const key = resolveApiKey(p);
  if (!key) throw new Error(`${p.name} has no API key configured (set ${p.apiKeyEnv || "an API key"}).`);

  try {
    if (p.kind === "gemini") {
      const base = "https://generativelanguage.googleapis.com/v1beta";
      const res = await fetch(`${base}/models/${encodeURIComponent(modelId)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with OK" }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return { ok: false, message: `Gemini ${res.status}: ${err.slice(0, 160)}` };
      }
      const data = await res.json();
      return { ok: true, message: `Gemini connected (model ${modelId})` };
    }

    // OpenAI-compatible
    const url = `${p.baseUrl!.replace(/\/+$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "Reply with OK" }], max_tokens: 10 }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, message: `${p.name} ${res.status}: ${err.slice(0, 160)}` };
    }
    return { ok: true, message: `${p.name} connected (model ${modelId})` };
  } catch (e: any) {
    return { ok: false, message: e.message?.slice(0, 200) || "Connection failed" };
  }
}
