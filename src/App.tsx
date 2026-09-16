import { useState, useCallback, useEffect, useRef } from 'react';
import LeftPanel from './components/LeftPanel';
import Visualizer from './components/Visualizer';
import Chat from './components/Chat';
import ApiKeysDialog from './components/ApiKeysDialog';
import { useScriptStore } from './store/useScriptStore';
import { FileText, KeyRound } from 'lucide-react';

function App() {
  const [leftWidth, setLeftWidth] = useState(65);
  const [isDragging, setIsDragging] = useState(false);
  
  const parseAndLoadTxt = useScriptStore(state => state.parseAndLoadTxt);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [pendingScriptFile, setPendingScriptFile] = useState<{ name: string; content: string } | null>(null);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const dragCounter = useRef(0);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const newWidth = (e.clientX / window.innerWidth) * 100;
    if (newWidth > 20 && newWidth < 80) {
      setLeftWidth(newWidth);
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Global Drag & Drop for .txt and .md files
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      if (e.dataTransfer?.types?.includes('Files')) {
        setIsDraggingFile(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setIsDraggingFile(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDraggingFile(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const file = Array.from(files).find(f => 
        /\.(txt|md)$/i.test(f.name) || f.type === 'text/plain' || f.type === 'text/markdown'
      );

      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target?.result as string;
          if (content !== undefined) {
            setPendingScriptFile({ name: file.name, content });
          }
        };
        reader.readAsText(file);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, []);

  // Escape key to dismiss dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pendingScriptFile) {
        setPendingScriptFile(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pendingScriptFile]);

  return (
    <div className={`flex w-full h-screen bg-gray-100 overflow-hidden text-sm relative ${isDragging ? 'select-none' : ''}`}>
      <button type="button" onClick={() => setShowApiKeys(true)} title="Configurar claves de API" aria-label="Configurar claves de API" className="fixed top-3 right-3 z-[900] flex items-center gap-2 bg-white text-gray-800 border border-gray-300 rounded-lg shadow px-3 py-2 hover:bg-blue-50">
        <KeyRound size={17} /><span className="hidden sm:inline">Claves API</span>
      </button>
      {showApiKeys && <ApiKeysDialog onClose={() => setShowApiKeys(false)} />}
      {/* Visual drag & drop overlay for .txt/.md files */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 pointer-events-none bg-blue-600/10 border-4 border-dashed border-blue-500/80 flex items-center justify-center animate-in fade-in duration-150 backdrop-blur-[1px]">
          <div className="bg-white/95 backdrop-blur-md px-6 py-4 rounded-xl shadow-2xl border border-blue-200 flex items-center gap-3 text-blue-600">
            <FileText size={32} className="animate-bounce text-blue-600" />
            <div>
              <p className="font-bold text-sm text-gray-900">Suelta tu archivo .txt o .md aquí</p>
              <p className="text-xs text-gray-500">Se te pedirá confirmación antes de cargarlo como guion</p>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for loading script with explicit OK / Cancelar */}
      {pendingScriptFile && (
        <div 
          className="fixed inset-0 z-[999] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setPendingScriptFile(null)}
        >
          <div 
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 border border-gray-200 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-blue-600 mb-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-lg">
                <FileText size={26} />
              </div>
              <div>
                <h3 className="text-base font-bold text-gray-900">¿Cargar guion desde archivo?</h3>
                <p className="text-xs text-gray-500 font-mono truncate max-w-[280px]">
                  {pendingScriptFile.name}
                </p>
              </div>
            </div>
            
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">
              ¿Deseas cargar este archivo como guion del proyecto?
            </p>
            
            <div className="bg-amber-50 text-amber-800 text-xs p-2.5 rounded-lg border border-amber-200 mb-5 leading-relaxed">
              Al cargarlo se actualizará el texto del guion y se cargarán los planos, referencias y notas contenidos.
            </div>

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setPendingScriptFile(null)}
                className="px-4 py-2 border border-gray-300 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  parseAndLoadTxt(pendingScriptFile.content);
                  setPendingScriptFile(null);
                }}
                className="px-5 py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 shadow-sm transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ width: `${leftWidth}%` }} className="h-full flex flex-col bg-white">
        <LeftPanel />
      </div>
      
      <div 
        className="w-2 cursor-col-resize bg-gray-200 hover:bg-blue-400 transition-colors z-40 flex items-center justify-center border-l border-r border-gray-300 flex-shrink-0"
        onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
      >
        <div className="w-0.5 h-8 bg-gray-400 rounded-full"></div>
      </div>

      <div style={{ width: `calc(${100 - leftWidth}% - 8px)` }} className="h-full flex flex-col">
        <div className="flex-1 border-b border-gray-300 bg-black text-white relative flex flex-col items-center justify-center overflow-hidden">
          <Visualizer />
        </div>
        <div className="flex-1 bg-white flex flex-col overflow-hidden">
          <Chat />
        </div>
      </div>
    </div>
  );
}

export default App;
