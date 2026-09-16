import { useState, useRef, useEffect } from 'react';
import { useScriptStore } from '../store/useScriptStore';
import { askChatToModify, TEXT_MODELS, type TextModel } from '../services/ai';
import { Send, Loader2, Sparkles } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

export default function Chat() {
  const { exportToTxt, parseAndLoadTxt, textModel, setTextModel } = useScriptStore();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: '¡Hola! Soy el asistente. Escribe aquí cualquier cambio que quieras hacer en los textos de los planos.' }
  ]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userText = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsProcessing(true);

    try {
      // Base64 images can contain megabytes and must never be sent back to a
      // text model. parseAndLoadTxt restores the existing images afterwards.
      const currentContext = exportToTxt(false);
      
      const response = await askChatToModify(userText, currentContext, textModel);
      
      if (!response || !response.documento) {
        throw new Error("El modelo no devolvió la propiedad 'documento'");
      }

      // Update global state with AI's new text
      parseAndLoadTxt(response.documento, true);
      
      setMessages(prev => [...prev, { role: 'assistant', text: response.comentario || '¡Hecho! He aplicado los cambios.' }]);
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', text: `Ha ocurrido un error al intentar modificar el texto. Verifica la consola. Detalles: ${err.message}` }]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      <div className="p-2.5 border-b border-gray-200 bg-gray-50 font-semibold text-gray-700 flex justify-between items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={16} className="text-blue-600" />
          <span className="text-sm">Asistente de Guión</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-gray-400 text-[11px] font-normal hidden sm:inline">Modelo:</span>
          <select
            className="bg-white border border-gray-300 rounded px-2 py-1 text-xs font-semibold text-gray-700 hover:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer max-w-[200px] truncate"
            value={textModel}
            onChange={(e) => setTextModel(e.target.value as TextModel)}
            title="Seleccionar modelo de IA para retocar el guion"
          >
            {TEXT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-3 rounded-lg text-sm ${m.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'}`}>
              {m.text}
            </div>
          </div>
        ))}
        {isProcessing && (
          <div className="flex justify-start">
            <div className="max-w-[85%] p-3 rounded-lg text-sm bg-gray-100 text-gray-800 rounded-bl-none flex items-center gap-2">
              <Loader2 className="animate-spin" size={16} /> Modificando...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSend} className="p-3 border-t border-gray-200 bg-white flex gap-2">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ej: Cambia la chica rubia por morena en el plano 2..."
          className="flex-1 px-4 py-2 bg-gray-100 border-none rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
          disabled={isProcessing}
        />
        <button 
          type="submit" 
          disabled={!input.trim() || isProcessing}
          className="p-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center w-10 h-10"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
