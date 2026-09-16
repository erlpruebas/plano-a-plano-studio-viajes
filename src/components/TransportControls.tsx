export default function TransportControls({
  isPlaying,
  onTogglePlay,
  onRewind,
  onForward,
  currentTime,
  totalDuration
}: {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onRewind: () => void;
  onForward: () => void;
  currentTime: number;
  totalDuration: number;
}) {
  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="transport-controls">
      <div style={{ fontFamily: 'monospace', fontSize: '14px', width: '60px' }}>
        {formatTime(currentTime)}
      </div>
      <button className="transport-btn" onClick={onRewind}>⏮</button>
      <button className="transport-btn" onClick={onTogglePlay} style={{ background: isPlaying ? 'var(--accent-primary)' : 'var(--bg-tertiary)' }}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button className="transport-btn" onClick={onForward}>⏭</button>
      <div style={{ fontFamily: 'monospace', fontSize: '14px', width: '60px', textAlign: 'right', color: 'var(--text-muted)' }}>
        {formatTime(totalDuration)}
      </div>
    </div>
  );
}
