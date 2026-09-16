import type { Cut } from './LiveDirector';

type PlayerWindowProps = {
  currentTime: number;
  cuts: Cut[];
  // Mapping of cut index to an image URL (simulated from generated storyboards)
  cutImages: Record<number, string>;
};

export default function PlayerWindow({ currentTime, cuts, cutImages }: PlayerWindowProps) {
  // Find which cut corresponds to the currentTime
  let activeCutIndex = -1;
  for (let i = cuts.length - 1; i >= 0; i--) {
    if (currentTime >= cuts[i].timestamp) {
      activeCutIndex = i;
      break;
    }
  }

  const activeCut = activeCutIndex >= 0 ? cuts[activeCutIndex] : null;
  const currentImage = activeCutIndex >= 0 ? cutImages[activeCutIndex] : null;

  return (
    <div 
      className="player-window" 
      style={currentImage ? { backgroundImage: `url(${currentImage})` } : {}}
    >
      {!currentImage && activeCut && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>CAM {activeCut.cameraIndex + 1}</div>
          <div>{activeCut.angleName}</div>
          <div style={{ fontSize: '12px', marginTop: '8px' }}>(Sin imagen de storyboard)</div>
        </div>
      )}
      {!currentImage && !activeCut && (
        <div>Previsualización del Plano</div>
      )}
      
      {/* Overlay status */}
      <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
        {activeCut ? `REC - ${activeCut.angleName}` : 'STANDBY'}
      </div>
    </div>
  );
}
