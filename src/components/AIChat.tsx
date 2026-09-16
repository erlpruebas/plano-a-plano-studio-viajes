import { useState, useRef, useEffect } from 'react';
import { getApiKey } from '../services/apiKeys';

type Role = 'system' | 'user' | 'assistant';

type Message = {
  role: Role;
  content: string;
};

export default function AIChat({ 
  editorText, 
  onEditorTextChange 
}: { 
  editorText: string; 
  onEditorTextChange: (text: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'Eres un asistente experto en guiones audiovisuales. Tu objetivo es ayudar al usuario a escribir, corregir y formatear su guion. Puedes usar la herramienta actualizar_guion para modificar el texto completo del editor cuando sea necesario.' },
    { role: 'assistant', content: 'Hola, soy tu asistente de IA conectado a GPT-4. Dime qué cambios quieres hacer en el guion.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const apiKey = getApiKey('openrouter');
      if (!apiKey) throw new Error('Falta la clave de OpenRouter. Abre «Claves API» y guárdala.');

      // Inject current editor text into the system prompt context
      const messagesForApi = newMessages.map(m => {
        if (m.role === 'system') {
          return { ...m, content: m.content + `\n\n--- TEXTO ACTUAL DEL GUION ---\n${editorText}` };
        }
        return m;
      });

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:5173',
          'X-Title': 'Plano a Plano Studio'
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          messages: messagesForApi,
          tools: [
            {
              type: 'function',
              function: {
                name: 'actualizar_guion',
                description: 'Sobrescribe todo el texto del editor con un nuevo contenido. Úsalo para aplicar los cambios que el usuario te pide.',
                parameters: {
                  type: 'object',
                  properties: {
                    nuevoTexto: {
                      type: 'string',
                      description: 'El nuevo texto completo del guion.'
                    }
                  },
                  required: ['nuevoTexto']
                }
              }
            }
          ],
          tool_choice: 'auto'
        })
      });

      const data = await response.json();
      
      if (data.error) {
        throw new Error(data.error.message || 'Error en la API');
      }

      const responseMessage = data.choices[0].message;

      // Handle tool calls
      if (responseMessage.tool_calls) {
        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.function.name === 'actualizar_guion') {
            const args = JSON.parse(toolCall.function.arguments);
            onEditorTextChange(args.nuevoTexto);
            setMessages(prev => [...prev, { role: 'assistant', content: 'He actualizado el guion según tus instrucciones.' }]);
          }
        }
      } else if (responseMessage.content) {
        setMessages(prev => [...prev, { role: 'assistant', content: responseMessage.content }]);
      }

    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="chat-messages">
        {messages.filter(m => m.role !== 'system').map((msg, idx) => (
          <div key={idx} className={`chat-message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {isLoading && <div className="chat-message assistant">Pensando...</div>}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-area">
        <input 
          type="text" 
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Habla con la IA o pídele cambios..."
          disabled={isLoading}
        />
        <button className="primary" onClick={handleSend} disabled={isLoading}>Enviar</button>
      </div>
    </div>
  );
}
