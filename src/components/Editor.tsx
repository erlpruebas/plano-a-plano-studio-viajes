import { useRef } from 'react';

export default function Editor({ 
  text, 
  onChange, 
  onSelectText 
}: { 
  text: string; 
  onChange: (t: string) => void;
  onSelectText: (t: string) => void;
}) {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const applyFormat = (formatType: 'shot') => {
    if (!editorRef.current) return;
    const { selectionStart, selectionEnd } = editorRef.current;
    
    if (formatType === 'shot') {
      const shotCount = (text.match(/--- PLANO/g) || []).length + 1;
      const injection = `\n--- PLANO ${shotCount} ---\n`;
      const newText = text.slice(0, selectionStart) + injection + text.slice(selectionEnd);
      onChange(newText);
      // Timeout to refocus after state update
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.focus();
          editorRef.current.setSelectionRange(selectionStart + injection.length, selectionStart + injection.length);
        }
      }, 0);
    }
  };

  const handleSelection = () => {
    if (!editorRef.current) return;
    const { selectionStart, selectionEnd, value } = editorRef.current;
    if (selectionStart !== selectionEnd) {
      onSelectText(value.slice(selectionStart, selectionEnd));
    } else {
      onSelectText('');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="toolbar">
        <button className="primary" onClick={() => applyFormat('shot')}>Iniciar Plano</button>
      </div>
      <textarea
        ref={editorRef}
        className="editor-area"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onMouseUp={handleSelection}
        onKeyUp={handleSelection}
        placeholder="Escribe aquí el guion..."
      />
    </div>
  );
}
