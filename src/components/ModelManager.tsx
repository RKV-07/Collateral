import React, { useState } from "react";
import { ModelConfig, PublicProvider, PublicRegistry, ProviderKind } from "../types";
import {
  Plus,
  Trash2,
  Plug,
  Key,
  CheckCircle,
  XCircle,
  Settings2,
  Cpu,
  Loader2,
  Pencil,
} from "lucide-react";

interface ModelManagerProps {
  registry: PublicRegistry;
  onChange: (registry: PublicRegistry) => void;
}

interface TestState {
  providerId: string;
  modelId: string;
  status: "idle" | "testing" | "ok" | "fail";
  message: string;
}

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data as T;
}

export default function ModelManager({ registry, onChange }: ModelManagerProps) {
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddModelFor, setShowAddModelFor] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add-provider form
  const [pid, setPid] = useState("");
  const [pName, setPName] = useState("");
  const [pKind, setPKind] = useState<ProviderKind>("openai-compatible");
  const [pBaseUrl, setPBaseUrl] = useState("");
  const [pApiKey, setPApiKey] = useState("");
  const [pModelId, setPModelId] = useState("");

  // Add-model inline form
  const [newModelId, setNewModelId] = useState("");

  // Edit-provider inline form
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [epName, setEpName] = useState("");
  const [epKind, setEpKind] = useState<ProviderKind>("openai-compatible");
  const [epBaseUrl, setEpBaseUrl] = useState("");
  const [epApiKey, setEpApiKey] = useState("");

  // Edit-model inline form
  const [editingModel, setEditingModel] = useState<{ providerId: string; modelId: string } | null>(null);
  const [emName, setEmName] = useState("");
  const [emBadge, setEmBadge] = useState("");
  const [emDesc, setEmDesc] = useState("");

  const flash = (msg: string | null, ok = false) => {
    setError(ok ? null : msg);
    setSuccess(ok ? msg : null);
    setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 4000);
  };

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("add-provider");
    setError(null);
    setSuccess(null);
    try {
      const models = pModelId.trim()
        ? [{ id: pModelId.trim(), name: pModelId.trim() }]
        : [];
      const next = await api<PublicRegistry>("/api/models/providers", {
        method: "POST",
        body: JSON.stringify({
          id: pid,
          name: pName,
          kind: pKind,
          baseUrl: pBaseUrl,
          apiKey: pApiKey,
          models,
        }),
      });
      onChange(next);
      setPid(""); setPName(""); setPKind("openai-compatible"); setPBaseUrl(""); setPApiKey(""); setPModelId("");
      setShowAddProvider(false);
      flash("Provider added.", true);
    } catch (err: any) {
      flash(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleAddModel = async (providerId: string) => {
    if (!newModelId.trim()) return;
    setBusy(`add-model-${providerId}`);
    try {
      const next = await api<PublicRegistry>(`/api/models/providers/${encodeURIComponent(providerId)}/models`, {
        method: "POST",
        body: JSON.stringify({ id: newModelId.trim(), name: newModelId.trim() }),
      });
      onChange(next);
      setNewModelId("");
      setShowAddModelFor(null);
      flash("Model added.", true);
    } catch (err: any) {
      flash(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    if (!window.confirm(`Delete provider "${providerId}" and all its models?`)) return;
    setBusy(`del-provider-${providerId}`);
    try {
      const next = await api<PublicRegistry>(`/api/models/providers/${encodeURIComponent(providerId)}`, {
        method: "DELETE",
      });
      onChange(next);
      flash("Provider removed.", true);
    } catch (err: any) {
      flash(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteModel = async (providerId: string, modelId: string) => {
    setBusy(`del-model-${modelId}`);
    try {
      const next = await api<PublicRegistry>(
        `/api/models/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
        { method: "DELETE" }
      );
      onChange(next);
      flash("Model removed.", true);
    } catch (err: any) {
      flash(err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (providerId: string, modelId: string) => {
    setTestState({ providerId, modelId, status: "testing", message: "Testing connection..." });
    try {
      const result = await api<{ ok: boolean; message: string }>("/api/models/test", {
        method: "POST",
        body: JSON.stringify({ providerId, modelId }),
      });
      setTestState({
        providerId,
        modelId,
        status: result.ok ? "ok" : "fail",
        message: result.message,
      });
    } catch (err: any) {
      setTestState({ providerId, modelId, status: "fail", message: err.message });
    }
  };

  const handleSetDefault = async (providerId: string, modelId: string) => {
    setBusy(`default-${modelId}`);
    try {
      const next = await api<PublicRegistry>("/api/models/default", {
        method: "POST",
        body: JSON.stringify({ providerId, modelId }),
      });
      onChange(next);
      flash("Default model updated.", true);
    } catch (err: any) {
      flash(err.message);
    } finally {
      setBusy(null);
    }
  };

  const startEditProvider = (provider: PublicProvider) => {
    setEditingProvider(provider.id);
    setEpName(provider.name);
    setEpKind(provider.kind);
    setEpBaseUrl(provider.baseUrl || "");
    setEpApiKey("");
  };

  const handleSaveProviderEdit = async (providerId: string) => {
    setBusy(`edit-provider-${providerId}`);
    try {
      const next = await api<PublicRegistry>(`/api/models/providers/${encodeURIComponent(providerId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: epName,
          kind: epKind,
          baseUrl: epBaseUrl,
          apiKey: epApiKey,
        }),
      });
      onChange(next);
      setEditingProvider(null);
      flash("Provider updated.", true);
    } catch (err: any) {
      flash(err.message);
    } finally {
      setBusy(null);
    }
  };

  const startEditModel = (provider: PublicProvider, model: ModelConfig) => {
    setEditingModel({ providerId: provider.id, modelId: model.id });
    setEmName(model.name);
    setEmBadge(model.badge || "");
    setEmDesc(model.desc || "");
  };

  const handleSaveModelEdit = async (providerId: string, modelId: string) => {
    setBusy(`edit-model-${modelId}`);
    try {
      const next = await api<PublicRegistry>(
        `/api/models/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: emName, badge: emBadge, desc: emDesc }),
        }
      );
      onChange(next);
      setEditingModel(null);
      flash("Model updated.", true);
    } catch (err: any) {
      flash(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div id="model-manager" className="mt-5 border-t border-line pt-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="p-1.5 bg-white/5 border border-line text-white/70 rounded-lg">
            <Settings2 size={14} />
          </span>
          <h3 className="font-sans font-medium text-xs text-white/70 uppercase tracking-widest font-mono">
            Manage AI Providers & Models
          </h3>
        </div>
        <button
          onClick={() => setShowAddProvider(!showAddProvider)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-white/90 text-black rounded-lg text-[11px] font-bold uppercase tracking-wider transition cursor-pointer"
        >
          <Plus size={12} />
          Add Provider
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          <XCircle size={12} /> {error}
        </div>
      )}
      {success && (
        <div className="mb-3 flex items-center gap-2 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <CheckCircle size={12} /> {success}
        </div>
      )}

      {/* Add Provider Form */}
      {showAddProvider && (
        <form onSubmit={handleAddProvider} className="mb-5 border border-line rounded-xl bg-platter/70 p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">Provider ID (slug)</label>
              <input
                value={pid}
                onChange={(e) => setPid(e.target.value)}
                placeholder="e.g. together"
                required
                className="w-full text-xs bg-surface text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
              />
            </div>
            <div>
              <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">Display Name</label>
              <input
                value={pName}
                onChange={(e) => setPName(e.target.value)}
                placeholder="e.g. Together AI"
                required
                className="w-full text-xs bg-surface text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30"
              />
            </div>
            <div>
              <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">Provider Type</label>
              <select
                value={pKind}
                onChange={(e) => setPKind(e.target.value as ProviderKind)}
                className="w-full text-xs bg-surface text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 cursor-pointer"
              >
                <option value="openai-compatible">OpenAI-compatible (custom base URL)</option>
                <option value="gemini">Gemini (Google SDK)</option>
              </select>
            </div>
            {pKind === "openai-compatible" && (
              <div>
                <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">Base URL</label>
                <input
                  value={pBaseUrl}
                  onChange={(e) => setPBaseUrl(e.target.value)}
                  placeholder="https://api.together.xyz/v1"
                  required
                  className="w-full text-xs bg-surface text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
                />
              </div>
            )}
            <div className={pKind === "openai-compatible" ? "" : "sm:col-span-2"}>
              <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">API Key (stored server-side)</label>
              <input
                type="password"
                value={pApiKey}
                onChange={(e) => setPApiKey(e.target.value)}
                placeholder="sk-..."
                required
                className="w-full text-xs bg-surface text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
              />
            </div>
            <div className={pKind === "openai-compatible" ? "sm:col-span-2" : ""}>
              <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">Initial Model ID (optional)</label>
              <input
                value={pModelId}
                onChange={(e) => setPModelId(e.target.value)}
                placeholder="e.g. meta-llama/Llama-3.3-70B-Instruct-Turbo"
                className="w-full text-xs bg-surface text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setShowAddProvider(false)}
              className="px-3 py-1.5 border border-line text-white/50 rounded-lg text-[11px] hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy === "add-provider"}
              className="px-3 py-1.5 bg-white text-black rounded-lg text-[11px] font-bold uppercase tracking-wider hover:bg-white/90 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              {busy === "add-provider" ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
              Save Provider
            </button>
          </div>
        </form>
      )}

      {/* Provider List */}
      <div className="flex flex-col gap-4">
        {registry.providers.map((provider) => {
          const isDefaultProvider = registry.defaultProvider === provider.id;
          return (
            <div key={provider.id} className="border border-line rounded-xl bg-platter/50 p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="p-1 bg-white/5 border border-line text-white/70 rounded-md">
                  <Cpu size={12} />
                </span>
                <span className="text-xs font-medium text-white">{provider.name}</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/40 border border-line uppercase tracking-wider">
                  {provider.kind}
                </span>
                {isDefaultProvider && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25 uppercase tracking-wider">
                    Default
                  </span>
                )}
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 ${
                  provider.hasKey ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}>
                  <Key size={9} />
                  {provider.hasKey ? "Key configured" : "No key"}
                </span>
                {!provider.builtin && (
                  <div className="ml-auto flex items-center gap-3">
                    <button
                      onClick={() => startEditProvider(provider)}
                      disabled={busy === `edit-provider-${provider.id}`}
                      className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white transition cursor-pointer"
                    >
                      <Pencil size={11} />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteProvider(provider.id)}
                      disabled={busy === `del-provider-${provider.id}`}
                      className="flex items-center gap-1 text-[10px] text-white/30 hover:text-rose-400 transition cursor-pointer"
                    >
                      <Trash2 size={11} />
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {provider.baseUrl && (
                <p className="text-[10px] font-mono text-white/30 mb-2 truncate">{provider.baseUrl}</p>
              )}

              {editingProvider === provider.id && (
                <form
                  onSubmit={(e) => { e.preventDefault(); handleSaveProviderEdit(provider.id); }}
                  className="mb-3 border border-line rounded-xl bg-surface/60 p-3 flex flex-col gap-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">Display Name</label>
                      <input
                        value={epName}
                        onChange={(e) => setEpName(e.target.value)}
                        required
                        className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">Provider Type</label>
                      <select
                        value={epKind}
                        onChange={(e) => setEpKind(e.target.value as ProviderKind)}
                        className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 cursor-pointer"
                      >
                        <option value="openai-compatible">OpenAI-compatible (custom base URL)</option>
                        <option value="gemini">Gemini (Google SDK)</option>
                      </select>
                    </div>
                    {epKind === "openai-compatible" && (
                      <div>
                        <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">Base URL</label>
                        <input
                          value={epBaseUrl}
                          onChange={(e) => setEpBaseUrl(e.target.value)}
                          required
                          className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
                        />
                      </div>
                    )}
                    <div className={epKind === "openai-compatible" ? "" : "sm:col-span-2"}>
                      <label className="block text-[9px] uppercase tracking-wider text-white/40 mb-1 font-mono">API Key (blank = keep current)</label>
                      <input
                        type="password"
                        value={epApiKey}
                        onChange={(e) => setEpApiKey(e.target.value)}
                        placeholder="sk-... (leave blank to keep)"
                        className="w-full text-xs bg-platter text-white border border-line rounded-lg p-2 focus:outline-none focus:border-white/30 font-mono"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={() => setEditingProvider(null)}
                      className="px-3 py-1.5 border border-line text-white/50 rounded-lg text-[11px] hover:text-white transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={busy === `edit-provider-${provider.id}`}
                      className="px-3 py-1.5 bg-white text-black rounded-lg text-[11px] font-bold uppercase tracking-wider hover:bg-white/90 disabled:opacity-50 cursor-pointer"
                    >
                      {busy === `edit-provider-${provider.id}` ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
                      Save Changes
                    </button>
                  </div>
                </form>
              )}

              <div className="flex flex-col gap-1.5">
                {provider.models.map((model) => {
                  const isDefaultModel = isDefaultProvider && registry.defaultModel === model.id;
                  return (
                    <div
                      key={model.id}
                      className="flex flex-wrap items-center gap-2 bg-surface/60 border border-white/5 rounded-lg px-3 py-2"
                    >
                      <span className={`text-[11px] font-mono ${isDefaultModel ? "text-amber-300 font-bold" : "text-white/70"}`}>
                        {model.name}
                      </span>
                      <span className="text-[9px] font-mono text-white/30">{model.id}</span>
                      {model.badge && (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 uppercase tracking-wider">
                          {model.badge}
                        </span>
                      )}
                      {isDefaultModel && (
                        <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/70 uppercase tracking-wider">
                          Active
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1.5">
                        <button
                          onClick={() => handleTest(provider.id, model.id)}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 border border-line rounded text-white/50 hover:text-white hover:border-white/30 transition cursor-pointer"
                        >
                          <Plug size={10} />
                          Test
                        </button>
                        {!isDefaultModel && (
                          <button
                            onClick={() => handleSetDefault(provider.id, model.id)}
                            disabled={busy === `default-${model.id}`}
                            className="text-[10px] px-2 py-1 border border-line rounded text-white/50 hover:text-white hover:border-white/30 transition cursor-pointer"
                          >
                            Set default
                          </button>
                        )}
                        {!model.builtin && (
                          <button
                            onClick={() => startEditModel(provider, model)}
                            disabled={busy === `edit-model-${model.id}`}
                            className="text-[10px] px-2 py-1 border border-line rounded text-white/50 hover:text-white hover:border-white/30 transition cursor-pointer"
                          >
                            <Pencil size={10} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteModel(provider.id, model.id)}
                          disabled={busy === `del-model-${model.id}`}
                          className="text-[10px] px-2 py-1 border border-line rounded text-white/30 hover:text-rose-400 hover:border-rose-500/30 transition cursor-pointer"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                      {testState && testState.providerId === provider.id && testState.modelId === model.id && (
                        <div className={`w-full text-[10px] font-mono flex items-center gap-1.5 ${
                          testState.status === "ok" ? "text-emerald-400" : testState.status === "fail" ? "text-rose-400" : "text-white/40"
                        }`}>
                          {testState.status === "testing" ? <Loader2 size={10} className="animate-spin" /> : testState.status === "ok" ? <CheckCircle size={10} /> : <XCircle size={10} />}
                          {testState.message}
                        </div>
                      )}
                      {editingModel && editingModel.providerId === provider.id && editingModel.modelId === model.id && (
                        <form
                          onSubmit={(e) => { e.preventDefault(); handleSaveModelEdit(provider.id, model.id); }}
                          className="w-full mt-2 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center border border-line rounded-lg bg-platter/60 p-2.5"
                        >
                          <input
                            value={emName}
                            onChange={(e) => setEmName(e.target.value)}
                            placeholder="Display name"
                            required
                            className="text-xs bg-surface text-white border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-white/30 font-mono"
                          />
                          <input
                            value={emBadge}
                            onChange={(e) => setEmBadge(e.target.value)}
                            placeholder="Badge (e.g. Recommended)"
                            className="text-xs bg-surface text-white border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-white/30 font-mono"
                          />
                          <input
                            value={emDesc}
                            onChange={(e) => setEmDesc(e.target.value)}
                            placeholder="Description"
                            className="text-xs bg-surface text-white border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-white/30 font-mono"
                          />
                          <div className="flex gap-1.5">
                            <button
                              type="submit"
                              disabled={busy === `edit-model-${model.id}`}
                              className="px-2.5 py-1.5 bg-white text-black rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                            >
                              {busy === `edit-model-${model.id}` ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle size={10} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingModel(null)}
                              className="px-2.5 py-1.5 border border-line text-white/40 rounded-lg text-[10px] cursor-pointer hover:text-white"
                            >
                              <XCircle size={10} />
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add model inline */}
              {showAddModelFor === provider.id ? (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    placeholder="Model id (e.g. gpt-4o-mini)"
                    className="flex-1 text-xs bg-surface text-white border border-line rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-white/30 font-mono"
                  />
                  <button
                    onClick={() => handleAddModel(provider.id)}
                    disabled={busy === `add-model-${provider.id}`}
                    className="px-2.5 py-1.5 bg-white text-black rounded-lg text-[10px] font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => setShowAddModelFor(null)}
                    className="px-2.5 py-1.5 border border-line text-white/40 rounded-lg text-[10px] cursor-pointer hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setShowAddModelFor(provider.id); setNewModelId(""); }}
                  className="mt-2 flex items-center gap-1 text-[10px] text-white/40 hover:text-white transition cursor-pointer"
                >
                  <Plus size={10} />
                  Add model to {provider.name}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
