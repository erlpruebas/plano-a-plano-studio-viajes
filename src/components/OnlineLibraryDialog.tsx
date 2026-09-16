import { useEffect, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { useScriptStore } from '../store/useScriptStore';

type Library = { guiones: string[]; audios: string[] };
const base = import.meta.env.BASE_URL;
const fileUrl = (folder: 'guiones' | 'audios', filename: string) => `${base}${folder}/${encodeURIComponent(filename)}`;

export default function OnlineLibraryDialog({ onClose }: { onClose: () => void }) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [script, setScript] = useState('');
  const [audio, setAudio] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parseAndLoadTxt = useScriptStore(state => state.parseAndLoadTxt);
  const addAudioTracks = useScriptStore(state => state.addAudioTracks);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}library.json`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`No se pudo cargar la biblioteca (${response.status}).`);
        return response.json() as Promise<Library>;
      })
      .then(data => {
        setLibrary(data);
        setScript(data.guiones[0] || '');
        setAudio(data.audios[0] || '');
      })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo cargar la biblioteca.');
      });
    return () => controller.abort();
  }, []);

  const loadScript = async () => {
    if (!script) return;
    if (useScriptStore.getState().literalScript && !window.confirm('¿Sustituir el guion actual por el seleccionado? Exporta antes cualquier cambio que quieras conservar.')) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(fileUrl('guiones', script));
      if (!response.ok) throw new Error(`No se pudo descargar el guion (${response.status}).`);
      parseAndLoadTxt(await response.text());
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo abrir el guion.');
    } finally {
      setBusy(false);
    }
  };

  const addAudio = () => {
    if (!audio) return;
    addAudioTracks([{ id: `online-audio-${Date.now()}`, name: audio, url: fileUrl('audios', audio), duration: 0 }]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="online-library-title" className="bg-white rounded-xl shadow-2xl w-full max-w-xl p-6 text-gray-900" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 id="online-library-title" className="text-lg font-bold flex items-center gap-2"><BookOpen size={20} /> Biblioteca en línea</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar biblioteca" className="p-2 rounded hover:bg-gray-100"><X size={18} /></button>
        </div>
        <p className="text-sm text-gray-600 mb-4">Selecciona un guion o añade un MP3 público al proyecto. El audio se descarga solo cuando lo reproduces o lo procesas.</p>
        {library && <div className="space-y-5">
          <div>
            <label htmlFor="online-script" className="block text-sm font-semibold mb-1">Guion ({library.guiones.length})</label>
            <select id="online-script" value={script} onChange={event => setScript(event.target.value)} className="w-full border rounded-lg px-3 py-2">
              {library.guiones.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button" disabled={busy || !script} onClick={loadScript} className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50">{busy ? 'Cargando...' : 'Abrir guion'}</button>
          </div>
          <div>
            <label htmlFor="online-audio" className="block text-sm font-semibold mb-1">Audio MP3 ({library.audios.length})</label>
            <select id="online-audio" value={audio} onChange={event => setAudio(event.target.value)} className="w-full border rounded-lg px-3 py-2">
              {library.audios.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            <div className="flex items-center gap-3 mt-2">
              <button type="button" disabled={!audio} onClick={addAudio} className="px-4 py-2 bg-indigo-600 text-white rounded-lg disabled:opacity-50">Añadir audio</button>
              {audio && <a href={fileUrl('audios', audio)} download={audio} className="text-blue-700 underline">Descargar MP3</a>}
            </div>
          </div>
        </div>}
        {!library && !error && <p className="text-sm text-gray-500">Cargando biblioteca...</p>}
        {error && <p role="alert" className="text-red-700 text-sm mt-4">{error}</p>}
      </div>
    </div>
  );
}
