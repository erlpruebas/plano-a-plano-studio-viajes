export type ApiProvider = 'openrouter' | 'groq' | 'google';

const STORAGE_KEY = 'plano-a-plano-studio-v4:api-keys';
const PROVIDERS: ApiProvider[] = ['openrouter', 'groq', 'google'];

export type ApiKeys = Record<ApiProvider, string>;

export function loadApiKeys(): ApiKeys {
  const empty: ApiKeys = { openrouter: '', groq: '', google: '' };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<ApiKeys>;
    for (const provider of PROVIDERS) {
      if (typeof stored[provider] === 'string') empty[provider] = stored[provider].trim();
    }
  } catch {
    // Private browsing or disabled storage: the UI can still accept new keys.
  }
  return empty;
}

export function getApiKey(provider: ApiProvider): string {
  return loadApiKeys()[provider];
}

export function saveApiKeys(keys: ApiKeys): void {
  const normalized: ApiKeys = { openrouter: '', groq: '', google: '' };
  for (const provider of PROVIDERS) normalized[provider] = keys[provider].trim();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
}
