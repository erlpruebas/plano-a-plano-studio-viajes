import { useState } from 'react';
import type { Cut } from './LiveDirector';

type TimelineProps = {
  cuts: Cut[];
  totalDurationMs: number;
};

export default function Timeline({ cuts, totalDurationMs }: TimelineProps) {
  const [audioFile, setAudioFile] = useState<string | null>(null);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file.name);
    }
  };

  // Convert timestamp to percentage for positioning
  const getPosition = (time: number) => {
    if (totalDurationMs === 0) return 0;
    return (time / totalDurationMs) * 100;
  };

  return (
    <div className="timeline-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Línea de Tiempo</h4>
        <label style={{ cursor: 'pointer', fontSize: '12px', background: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: '4px' }}>
          + Añadir Audio de Plano
          <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={handleAudioUpload} />
        </label>
      </div>

      {/* Audio Track */}
      <div className="timeline-track">
        {audioFile && (
          <div className="timeline-block audio" style={{ left: 0, width: '100%' }}>
            🔊 {audioFile}
          </div>
        )}
        {!audioFile && (
          <div style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
            Pista de audio vacía
          </div>
        )}
      </div>

      {/* Video/Cuts Track */}
      <div className="timeline-track">
        {cuts.map((cut, index) => {
          const nextCut = cuts[index + 1];
          const endTimestamp = nextCut ? nextCut.timestamp : totalDurationMs;
          const duration = endTimestamp - cut.timestamp;
          
          const left = getPosition(cut.timestamp);
          const width = getPosition(duration);

          return (
            <div 
              key={index}
              className="timeline-block"
              style={{ 
                left: `${left}%`, 
                width: `${width}%`,
                borderLeft: index > 0 ? '2px solid white' : 'none'
              }}
              title={`Corte a ${cut.angleName} en ${(cut.timestamp / 1000).toFixed(1)}s`}
            >
              C{cut.cameraIndex + 1}: {cut.angleName}
            </div>
          );
        })}
        {cuts.length === 0 && (
          <div style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '12px' }}>
            Graba una realización para ver los cortes aquí
          </div>
        )}
      </div>
    </div>
  );
}
