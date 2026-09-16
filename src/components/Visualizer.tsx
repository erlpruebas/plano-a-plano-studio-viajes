import { useCallback, useEffect, useRef, useState } from 'react';
import { useScriptStore } from '../store/useScriptStore';
import { Play, Pause, SkipBack, SkipForward, AudioLines } from 'lucide-react';

function getShotDurationMs(timeRange: string) {
  const match = timeRange.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (!match) return 3_000;

  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return Math.max(1_000, (end - start) * 1_000);
}

function getShotStartTimeSec(timeRange: string, shotIndex: number): number {
  const match = timeRange.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  if (match) {
    return Number(match[1]) * 60 + Number(match[2]);
  }
  return shotIndex * 3;
}

export default function Visualizer() {
  const { 
    shots, 
    audioTracks, 
    updateShot, 
    addImageToHistory, 
    saveStateToHistory,
    activeShotIndex,
    setActiveShotIndex
  } = useScriptStore();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioPlaylistRef = useRef<HTMLAudioElement | null>(null);
  const shotAudioRef = useRef<HTMLAudioElement | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const displayedShotIndex = shots.length > 0 ? Math.min(Math.max(0, activeShotIndex), shots.length - 1) : 0;
  const currentShot = shots[displayedShotIndex];
  const isCurrentVideo = currentShot?.mediaType === 'video' && Boolean(currentShot.videoUrl);

  const advanceShot = useCallback(() => {
    setActiveShotIndex(displayedShotIndex + 1);
    if (displayedShotIndex >= shots.length - 1) {
      setIsPlaying(false);
      setActiveShotIndex(0);
    }
  }, [displayedShotIndex, setActiveShotIndex, shots.length]);

  // Video and Shot duration timer
  useEffect(() => {
    if (!isPlaying || !currentShot) {
      videoRef.current?.pause();
      return;
    }

    if (isCurrentVideo) {
      void videoRef.current?.play().catch(() => setIsPlaying(false));
      return;
    }

    const timeout = window.setTimeout(advanceShot, getShotDurationMs(currentShot.timeRange));
    return () => window.clearTimeout(timeout);
  }, [advanceShot, currentShot, isCurrentVideo, isPlaying]);

  // Handle Sequential Project Audio Playback
  useEffect(() => {
    if (!audioPlaylistRef.current) {
      audioPlaylistRef.current = new Audio();
    }
    const audioEl = audioPlaylistRef.current;

    const handleTrackEnded = () => {
      // Play first then second in sequential order
      setCurrentTrackIndex(prev => {
        if (prev + 1 < audioTracks.length) {
          return prev + 1;
        }
        return prev;
      });
    };

    audioEl.addEventListener('ended', handleTrackEnded);
    return () => {
      audioEl.removeEventListener('ended', handleTrackEnded);
    };
  }, [audioTracks.length]);

  // Sync Audio Element source & playback with isPlaying & currentTrackIndex
  useEffect(() => {
    const audioEl = audioPlaylistRef.current;
    if (!audioEl) return;

    if (!isPlaying) {
      audioEl.pause();
      shotAudioRef.current?.pause();
      return;
    }

    if (audioTracks.length > 0) {
      const activeTrack = audioTracks[currentTrackIndex] || audioTracks[0];
      if (activeTrack && audioEl.src !== activeTrack.url) {
        audioEl.src = activeTrack.url;
      }
      void audioEl.play().catch(err => console.log('Audio playback waiting for interaction:', err));
    } else if (currentShot?.audioUrl) {
      // Fallback to cut shot audio
      if (!shotAudioRef.current) {
        shotAudioRef.current = new Audio();
      }
      shotAudioRef.current.src = currentShot.audioUrl;
      void shotAudioRef.current.play().catch(err => console.log('Shot audio playback:', err));
    }
  }, [isPlaying, currentTrackIndex, audioTracks, currentShot?.audioUrl]);

  const selectShot = (index: number, userInteraction = false) => {
    const boundedIndex = Math.max(0, Math.min(shots.length - 1, index));
    videoRef.current?.pause();
    setActiveShotIndex(boundedIndex);

    const targetShot = shots[boundedIndex];
    if (!targetShot) return;

    // 1. If project audio tracks exist: calculate timestamp and seek audio
    if (audioTracks.length > 0) {
      const targetSecond = getShotStartTimeSec(targetShot.timeRange, boundedIndex);
      let accumulated = 0;
      let targetTrackIdx = 0;
      let timeWithinTrack = 0;

      for (let i = 0; i < audioTracks.length; i++) {
        const dur = audioTracks[i].duration || 60;
        if (targetSecond >= accumulated && targetSecond < accumulated + dur) {
          targetTrackIdx = i;
          timeWithinTrack = targetSecond - accumulated;
          break;
        }
        accumulated += dur;
        if (i === audioTracks.length - 1) {
          targetTrackIdx = i;
          timeWithinTrack = Math.min(dur, Math.max(0, targetSecond - (accumulated - dur)));
        }
      }

      setCurrentTrackIndex(targetTrackIdx);
      if (audioPlaylistRef.current) {
        const track = audioTracks[targetTrackIdx];
        if (audioPlaylistRef.current.src !== track.url) {
          audioPlaylistRef.current.src = track.url;
        }
        audioPlaylistRef.current.currentTime = timeWithinTrack;

        if (isPlaying) {
          void audioPlaylistRef.current.play().catch(() => {});
        } else if (userInteraction) {
          // Play a brief snippet when clicking/scrubbing to preview where we are
          void audioPlaylistRef.current.play().then(() => {
            setTimeout(() => {
              if (!isPlaying && audioPlaylistRef.current) {
                audioPlaylistRef.current.pause();
              }
            }, 750);
          }).catch(() => {});
        }
      }
    } else if (targetShot.audioUrl) {
      // 2. If cut shot audio exists: seek and execute audio for this shot
      if (!shotAudioRef.current) {
        shotAudioRef.current = new Audio();
      }
      shotAudioRef.current.src = targetShot.audioUrl;
      shotAudioRef.current.currentTime = 0;
      if (isPlaying || userInteraction) {
        void shotAudioRef.current.play().catch(() => {});
      }
    }
  };

  const togglePlayback = () => {
    if (shots.length === 0 && audioTracks.length === 0) return;
    if (!isPlaying) {
      if (displayedShotIndex >= shots.length - 1) {
        selectShot(0, false);
      }
      if (currentTrackIndex >= audioTracks.length - 1 && audioTracks.length > 0) {
        setCurrentTrackIndex(0);
        if (audioPlaylistRef.current) {
          audioPlaylistRef.current.currentTime = 0;
        }
      }
    }
    setIsPlaying(previous => !previous);
  };

  const handleVisualizerDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (!currentShot) return;

    // 1. Files
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = Array.from(e.dataTransfer.files).find(f => f.type.startsWith('image/'));
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          updateShot(currentShot.id, { imageUrl: result, mediaType: 'image' });
          addImageToHistory(result);
          saveStateToHistory();
        };
        reader.readAsDataURL(file);
        return;
      }
    }

    // 2. URL or URI
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('URL') || e.dataTransfer.getData('text/plain');
    if (uri && (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:image/'))) {
      updateShot(currentShot.id, { imageUrl: uri.trim(), mediaType: 'image' });
      addImageToHistory(uri.trim());
      saveStateToHistory();
    }
  };

  return (
    <div
      className={`flex flex-col h-full bg-black text-white relative transition-colors ${
        isDragOver ? 'ring-4 ring-blue-500 ring-inset bg-blue-950/40' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={handleVisualizerDrop}
    >
      <div className="flex-1 flex items-center justify-center p-4 relative overflow-hidden">
        {shots.length === 0 ? (
          <div className="text-gray-500">No hay planos para previsualizar</div>
        ) : currentShot ? (
          isCurrentVideo ? (
            <video
              key={`${currentShot.id}-${currentShot.videoUrl}`}
              ref={videoRef}
              src={currentShot.videoUrl}
              poster={currentShot.imageUrl}
              className="w-full h-full object-contain"
              playsInline
              preload="auto"
              onEnded={advanceShot}
              aria-label={`Vídeo del plano ${currentShot.number}`}
            />
          ) : currentShot.imageUrl ? (
            <img
              src={currentShot.imageUrl}
              alt={currentShot.shortDesc}
              className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
              draggable={true}
              onDragStart={(e) => {
                if (!currentShot.imageUrl) return;
                e.dataTransfer.effectAllowed = 'copyMove';
                e.dataTransfer.setData('text/plain', currentShot.imageUrl);
                e.dataTransfer.setData('text/uri-list', currentShot.imageUrl);
                e.dataTransfer.setData('text/html', `<img src="${currentShot.imageUrl}" alt="Plano ${currentShot.number}" />`);
                e.dataTransfer.setData('DownloadURL', `image/png:plano-${currentShot.number}.png:${currentShot.imageUrl}`);
                e.dataTransfer.setData('application/x-plano-image', JSON.stringify({ shotId: currentShot.id, imageUrl: currentShot.imageUrl }));
              }}
            />
          ) : (
            <div className="text-3xl font-bold text-gray-400 text-center max-w-lg">
              {currentShot.shortDesc}
            </div>
          )
        ) : null}

        {isDragOver && (
          <div className="absolute inset-0 bg-blue-900/80 border-4 border-dashed border-blue-400 flex flex-col items-center justify-center text-white z-20 pointer-events-none">
            <span className="text-lg font-bold">Soltar imagen para PLANO {currentShot?.number}</span>
          </div>
        )}

        {currentShot && (
          <>
            <div className="absolute top-4 left-4 bg-black/70 px-3 py-1 rounded text-sm font-mono text-gray-300">
              PLANO {currentShot.number} • {currentShot.timeRange}
            </div>
            <div className="absolute top-4 right-4 bg-black/70 px-3 py-1 rounded text-xs font-semibold uppercase tracking-wide text-gray-300">
              {isCurrentVideo ? 'Vídeo' : 'Imagen'}
            </div>
          </>
        )}
      </div>

      <div className="h-16 border-t border-gray-800 bg-gray-900 flex items-center justify-between px-4">
        <div className="w-1/3 flex items-center gap-2">
          {audioTracks.length > 0 && (
            <div 
              className="text-xs font-mono text-indigo-400 flex items-center gap-1.5 bg-gray-800/90 px-2.5 py-1 rounded-full border border-gray-700 truncate max-w-xs"
              title={`Reproduciendo pista ${currentTrackIndex + 1} de ${audioTracks.length}: ${audioTracks[currentTrackIndex]?.name || ''}`}
            >
              <AudioLines size={14} className={isPlaying ? "animate-pulse text-indigo-400" : "text-gray-500"} />
              <span className="truncate">
                {currentTrackIndex + 1}/{audioTracks.length}: {audioTracks[currentTrackIndex]?.name || ''}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => selectShot(Math.max(0, displayedShotIndex - 1), true)}
            className="text-gray-400 hover:text-white disabled:opacity-30 cursor-pointer"
            disabled={shots.length === 0 || displayedShotIndex === 0}
            title="Plano anterior"
            aria-label="Plano anterior"
          >
            <SkipBack size={20} />
          </button>
          <button
            type="button"
            onClick={togglePlayback}
            className="text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 p-2 rounded-full disabled:opacity-30 cursor-pointer transition-colors"
            disabled={shots.length === 0 && audioTracks.length === 0}
            title={isPlaying ? 'Pausar secuencia' : 'Reproducir secuencia'}
            aria-label={isPlaying ? 'Pausar secuencia' : 'Reproducir secuencia'}
          >
            {isPlaying ? <Pause size={24} /> : <Play size={24} fill="currentColor" />}
          </button>
          <button
            type="button"
            onClick={() => selectShot(Math.min(shots.length - 1, displayedShotIndex + 1), true)}
            className="text-gray-400 hover:text-white disabled:opacity-30 cursor-pointer"
            disabled={shots.length === 0 || displayedShotIndex >= shots.length - 1}
            title="Plano siguiente"
            aria-label="Plano siguiente"
          >
            <SkipForward size={20} />
          </button>
        </div>

        <div className="w-1/3 flex justify-end text-xs text-gray-400 font-mono">
          {shots.length > 0 && `Plano ${displayedShotIndex + 1} / ${shots.length}`}
        </div>
      </div>

      {/* Explorador de Planos y Línea de Tiempo interactiva */}
      {shots.length > 0 && (
        <div className="bg-gray-950 border-t border-gray-800 p-2.5 select-none">
          <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono mb-1.5 px-1">
            <span className="flex items-center gap-1.5">
              <span className="font-bold text-white">PLANO {displayedShotIndex + 1}</span>
              <span>•</span>
              <span className="text-gray-300">{currentShot?.timeRange || '00:00 - 00:03'}</span>
              {currentShot?.shortDesc && (
                <>
                  <span>•</span>
                  <span className="text-gray-400 truncate max-w-[200px]" title={currentShot.shortDesc}>
                    {currentShot.shortDesc}
                  </span>
                </>
              )}
            </span>
            <span>
              {displayedShotIndex + 1} / {shots.length} planos
            </span>
          </div>

          {/* Interactive Shot Scrubber Bar */}
          <div 
            ref={timelineRef}
            className="relative h-8 bg-gray-900 rounded-md border border-gray-800 flex overflow-x-auto overflow-y-hidden group"
          >
            {shots.map((s, idx) => {
              const isActive = idx === displayedShotIndex;
              const hasImage = Boolean(s.imageUrl);
              const hasAudio = Boolean(s.audioUrl);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectShot(idx, true)}
                  className={`relative flex-1 min-w-[36px] h-full border-r border-gray-800/80 transition-all flex items-center justify-center text-[10px] font-mono cursor-pointer ${
                    isActive 
                      ? 'bg-blue-600 text-white font-bold shadow-inner ring-1 ring-blue-400' 
                      : 'hover:bg-gray-800 text-gray-400'
                  }`}
                  title={`Plano ${s.number} [${s.timeRange}] - ${s.shortDesc || s.description.slice(0, 30)}`}
                >
                  <span className="truncate px-0.5">P{s.number}</span>
                  {hasAudio && (
                    <span 
                      className={`absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-emerald-400'}`} 
                      title="Tiene audio cortado"
                    />
                  )}
                  {hasImage && (
                    <span 
                      className={`absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-blue-300'}`} 
                      title="Tiene imagen asignada"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
