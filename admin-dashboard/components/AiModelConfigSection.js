'use client';

// Shared "AI Model Configuration" block used by both the campaign create
// page and the campaign edit modal: a required Primary Model dropdown, an
// unbounded list of Fallback Model dropdowns (add/remove), a prompt
// textarea, and a live failover-chain preview.
//
// One physical key (ApiKey) can have several candidate models
// (ApiKeyModel) — a campaign's chain picks a specific (key, model) pair, so
// `aiKeys` is flattened one row per model, not one row per key:
//   { id, apiKeyId, providerName, model, keyIdentifier }[]
// `id` here is the ApiKeyModel id — that's what keyChain entries are.
// keyChain is passed/controlled as an ordered array of those ids where
// keyChain[0] is the primary and the rest are fallbacks, in order.

export function keyLabel(key) {
  if (!key) return '';
  return `${capitalize(key.providerName)} - ${key.model} - ${key.keyIdentifier}`;
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function flattenProviderKeys(providers) {
  const flat = [];
  for (const p of providers || []) {
    for (const k of p.apiKeys || []) {
      for (const m of k.models || []) {
        flat.push({ id: m.id, apiKeyId: k.id, providerName: p.name, model: m.model, keyIdentifier: k.keyIdentifier });
      }
    }
  }
  return flat;
}

export default function AiModelConfigSection({
  aiKeys,
  keysLoading,
  keyChain,
  onKeyChainChange,
  prompt,
  onPromptChange,
  required,
}) {
  const primaryKeyId = keyChain[0] || '';
  const fallbackKeyIds = keyChain.slice(1);

  const setPrimary = (value) => {
    onKeyChainChange([value, ...fallbackKeyIds]);
  };

  const setFallback = (index, value) => {
    const next = [...fallbackKeyIds];
    next[index] = value;
    onKeyChainChange([primaryKeyId, ...next]);
  };

  const addFallback = () => {
    onKeyChainChange([primaryKeyId, ...fallbackKeyIds, '']);
  };

  const removeFallback = (index) => {
    const next = fallbackKeyIds.filter((_, i) => i !== index);
    onKeyChainChange([primaryKeyId, ...next]);
  };

  const keyById = (id) => aiKeys.find((k) => k.id === id);

  // Each dropdown hides keys already chosen in another slot of the chain so
  // the same exact key can't be selected twice (a key retrying itself on
  // failure is never useful, even though the same provider+different-model
  // combo is explicitly fine).
  const optionsExcluding = (currentValue) => {
    const used = new Set([primaryKeyId, ...fallbackKeyIds].filter((id) => id && id !== currentValue));
    return aiKeys.filter((k) => !used.has(k.id));
  };

  const chain = [primaryKeyId, ...fallbackKeyIds].filter(Boolean);
  const previewText = chain
    .map((id, i) => {
      const k = keyById(id);
      if (!k) return null;
      return `${i + 1}. ${capitalize(k.providerName)} (${k.model || 'no model'})`;
    })
    .filter(Boolean)
    .join(' → ');

  return (
    <div className="bg-[#111111] border border-white/10 rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white uppercase tracking-wide">AI Model Configuration</h3>

      {keysLoading ? (
        <div className="text-sm text-gray-500">Loading available keys…</div>
      ) : aiKeys.length === 0 ? (
        <div className="text-sm text-amber-400">
          No API keys configured yet — add one on the AI Providers page first.
        </div>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">
              Primary Model {required && <span className="text-red-400">*</span>}
            </label>
            <select
              required={required}
              value={primaryKeyId}
              onChange={(e) => setPrimary(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
            >
              <option value="">Select a key…</option>
              {optionsExcluding(primaryKeyId).map((k) => (
                <option key={k.id} value={k.id}>
                  {keyLabel(k)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-300">Fallback Models</label>
              <button
                type="button"
                onClick={addFallback}
                className="text-xs text-[#2563eb] hover:underline"
              >
                + Add Fallback
              </button>
            </div>

            {fallbackKeyIds.length === 0 ? (
              <p className="text-xs text-gray-500">No fallbacks configured — the primary model is the only attempt.</p>
            ) : (
              <div className="space-y-2">
                {fallbackKeyIds.map((value, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <select
                      value={value}
                      onChange={(e) => setFallback(index, e.target.value)}
                      className="flex-1 bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                    >
                      <option value="">Select a key…</option>
                      {optionsExcluding(value).map((k) => (
                        <option key={k.id} value={k.id}>
                          {keyLabel(k)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeFallback(index)}
                      title="Remove fallback"
                      className="shrink-0 text-red-400 hover:text-red-300 border border-red-500/30 hover:bg-red-500/10 rounded-lg w-9 h-9 flex items-center justify-center transition-colors"
                    >
                      
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {chain.length > 0 && (
            <div className="text-xs text-gray-400 bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2 font-mono break-all">
              {previewText}
            </div>
          )}
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1.5">AI Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          rows={3}
          placeholder="Describe how the photo should be transformed…"
          className="w-full bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
        />
      </div>
    </div>
  );
}
