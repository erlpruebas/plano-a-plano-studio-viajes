import { useState, useEffect } from 'react';

export type Cut = {
  timestamp: number;
  cameraIndex: number;
  angleName: string;
};

export default function LiveDirector({ 
  angles, 
  onAddCut 
}: { 
  angles: string[];
  onAddCut: (cut: Cut) => void;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    let interval: number;
    if (isRecording && startTime) {
      interval = window.setInterval(() => {
        setCurrentTime(Date.now() - startTime);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isRecording, startTime]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isRecording || !startTime) return;
      
      const keyMap: Record<string, number> = {
        '1': 0,
        '2': 1,
        '3': 2,
        '4': 3
      };

      if (e.key in keyMap) {
        const cameraIndex = keyMap[e.key];
        onAddCut({
          timestamp: Date.now() - startTime,
          cameraIndex,
          angleName: angles[cameraIndex] || `Cámara ${cameraIndex + 1}`
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRecording, startTime, angles, onAddCut]);

  const toggleRecord = () => {
    if (isRecording) {
      setIsRecording(false);
      setStartTime(null);
      setCurrentTime(0);
    } else {
      setIsRecording(true);
      setStartTime(Date.now());
    }
  };

  return (
    <div style={{ padding: '16px', display: 'flex', gap: '16px', alignItems: 'center' }}>
      <button 
        onClick={toggleRecord}
        style={{ 
          background: isRecording ? 'var(--danger)' : 'var(--bg-tertiary)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        <div style={{ 
          width: '12px', 
          height: '12px', 
          borderRadius: '50%', 
          background: isRecording ? 'white' : 'var(--danger)' 
        }} />
        {isRecording ? 'Detener Realización' : 'Grabar Realización en Directo'}
      </button>

      {isRecording && (
        <div style={{ fontFamily: 'monospace', fontSize: '18px', color: 'var(--danger)' }}>
          REC {(currentTime / 1000).toFixed(1)}s (Pulsa 1-4 para cortar)
        </div>
      )}
    </div>
  );
}
