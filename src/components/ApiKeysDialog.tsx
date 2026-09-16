import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { loadApiKeys, saveApiKeys, type ApiKeys, type ApiProvider } from '../services/apiKeys';

const providers: { id: ApiProvider; label: string }[] = [
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'groq', label: 'Groq' },
  { id: 'google', label: 'Google Gemini' },
];

export default function ApiKeysDialog({ onClose }: { onClose: () => void }) {
  const [keys, setKeys] = useState<ApiKeys>(loadApiKeys);
  const [error, setError] = useState('');

  const update = (provider: ApiProvider, value: string) => {
    setKeys(current => ({ ...current, [provider]: value }));
    setError('');
  };

  const save = () => {
    try {
      saveApiKeys(keys);
      onClose();
    } catch {
      setError('El navegador no permite guardar las claves. Revisa el almacenamiento del sitio.');
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="api-keys-title" className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 text-gray-900" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 id="api-keys-title" className="text-lg font-bold flex items-center gap-2"><KeyRound size={20} /> Claves de API</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar configuración" className="p-2 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-600 mb-4">Se guardan solo en el navegador de este dispositivo y no se incluyen en GitHub ni en los archivos del proyecto. Usa un equipo de confianza: quien tenga acceso a este perfil del navegador podría leerlas.</p>
        <div className="space-y-4">
          {providers.map(provider => (
            <label key={provider.id} className="block text-sm font-semibold">
              {provider.label}
              <input type="password" autoComplete="off" value={keys[provider.id]} onChange={event => update(provider.id, event.target.value)} className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Introduce la clave o deja vacío para eliminarla" />
            </label>
          ))}
        </div>
        {error && <p role="alert" className="text-red-700 text-sm mt-4">{error}</p>}
        <div className="flex justify-end gap-2 mt-6">
          <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg">Cancelar</button>
          <button type="button" onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold">Guardar en este navegador</button>
        </div>
      </div>
    </div>
  );
}
