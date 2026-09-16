import { useRef, useState, useEffect } from 'react';
import { useScriptStore, type Shot, type Reference, type AudioTrack } from '../store/useScriptStore';
import { convertScriptToShots, estimateVideoCost, generateImageUrl, generateVideoUrl, getVideoModelConfig, IMAGE_MODELS, VIDEO_MODELS, type ImageModel, type VideoAspectRatio, type VideoModel, type VideoResolution, TEXT_MODELS, type TextModel } from '../services/ai';
import { 
  Undo, Redo, Save, FolderOpen, Image as ImageIcon, Loader2, BookmarkPlus, FileText, 
  Eye, Images, X, Copy, Download, Film, Upload, 
  Scissors, AudioLines, Play, Pause, Trash2, ArrowUp, ArrowDown, ChevronDown, ChevronUp, Music, Plus, StickyNote
} from 'lucide-react';
import { sliceAudioTracksForShots, decodeAudioSource, formatSecondsToTime, audioBufferToWavBlob, blobToDataUrl } from '../services/audioEngine';

const extractImageFromDataTransfer = async (dataTransfer: DataTransfer): Promise<string | null> => {
  // 1. Files from OS (e.g. Windows File Explorer)
  if (dataTransfer.files && dataTransfer.files.length > 0) {
    const file = Array.from(dataTransfer.files).find(f => f.type.startsWith('image/'));
    if (file) {
      return new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    }
  }

  // 2. Internal plano drag data
  const internalData = dataTransfer.getData('application/x-plano-image');
  if (internalData) {
    try {
      const parsed = JSON.parse(internalData);
      if (parsed.imageUrl) return parsed.imageUrl;
    } catch {
      // ignore
    }
  }

  // 3. HTML snippet (dragging image from a webpage in Chrome)
  const html = dataTransfer.getData('text/html');
  if (html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const img = doc.querySelector('img');
      if (img?.src) {
        return img.src;
      }
    } catch {
      // ignore
    }
  }

  // 4. URI / URL list
  const uri = dataTransfer.getData('text/uri-list') || dataTransfer.getData('URL');
  if (uri && (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:image/'))) {
    return uri.trim();
  }

  // 5. Plain text (URL or base64 data)
  const text = dataTransfer.getData('text/plain')?.trim();
  if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('data:image/'))) {
    return text;
  }

  return null;
};

const extractImageFromClipboard = async (): Promise<string | null> => {
  try {
    if (!navigator.clipboard?.read) return null;
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(t => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        return new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      }
    }
  } catch (err) {
    console.debug('No se pudo leer imagen del portapapeles:', err);
  }
  return null;
};

const convertUrlToDataUrl = async (url: string): Promise<string> => {
  if (url.startsWith('data:image/')) return url;
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (response.ok) {
      const blob = await response.blob();
      return new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(url);
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    // CORS or network error, fallback to URL directly
  }
  return url;
};



const GenerationTimer = ({ startTime, model }: { startTime: number, model: ImageModel }) => {
  const [elapsed, setElapsed] = useState(0);
  const stats = useScriptStore(state => state.generationStats[model]);
  
  useEffect(() => {
    const updateElapsed = () => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const estimated = stats ? Math.round(stats.totalTime / stats.count) : 30;
  return <span className="text-[10px] text-gray-500 font-medium">{elapsed}/{estimated}s</span>;
};

const VideoGenerationTimer = ({ startTime }: { startTime: number }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const updateElapsed = () => setElapsed(Math.floor((Date.now() - startTime) / 1000));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [startTime]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, '0');
  return <span className="text-[10px] text-gray-400 font-medium">{minutes}:{seconds} · puede tardar varios minutos</span>;
};

const AutoResizeTextarea = ({ value, onChange, className, placeholder }: { value: string, onChange: (val: string) => void, className?: string, placeholder?: string }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      className={`resize-none overflow-hidden block ${className || ''}`}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={1}
    />
  );
};

const convertBlobToPng = async (blob: Blob): Promise<Blob> => {
  if (blob.type === 'image/png') return blob;
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 300;
      canvas.height = img.naturalHeight || img.height || 300;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(blob);
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((pngBlob) => {
        resolve(pngBlob || blob);
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(blob);
    };
    img.src = objectUrl;
  });
};

const handleCopyImage = async (url: string, e: React.MouseEvent) => {
  e.stopPropagation();
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const pngBlob = await convertBlobToPng(blob);
    await navigator.clipboard.write([
      new ClipboardItem({
        'image/png': pngBlob
      })
    ]);
  } catch (err) {
    console.error('Failed to copy image to clipboard as image: ', err);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // ignore
    }
  }
};

const handleDownloadImage = async (url: string, prefix: string, e: React.MouseEvent) => {
  e.stopPropagation();
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `${prefix}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error('Failed to download image: ', err);
  }
};

const handleDownloadVideo = async (url: string, shotNumber: number, e: React.MouseEvent) => {
  e.stopPropagation();
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `plano-${shotNumber}-${Date.now()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error('Failed to download video: ', err);
    alert('No se pudo descargar el vídeo.');
  }
};


export default function LeftPanel() {
  const { 
    literalScript, setLiteralScript, 
    shots, updateShot, 
    references, addReference, updateReference,
    notes, addNote, updateNote, deleteNote,
    undo, redo, exportToTxt, parseAndLoadTxt,
    imageHistory, addImageToHistory,
    textModel, setTextModel,
    recordGenerationTime, saveStateToHistory,
    audioTracks, addAudioTracks, removeAudioTrack, reorderAudioTracks, clearAudioTracks, updateShotAudio,
    activeShotIndex, setActiveShotIndex
  } = useScriptStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const shotAudioFileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const notepadRef = useRef<HTMLTextAreaElement>(null);

  const [shotAudioTargetId, setShotAudioTargetId] = useState<string | null>(null);
  const [isCuttingAudio, setIsCuttingAudio] = useState(false);
  const [cuttingProgress, setCuttingProgress] = useState('');
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [isAudioSectionOpen, setIsAudioSectionOpen] = useState(true);
  const [isAudioZoneDragOver, setIsAudioZoneDragOver] = useState(false);

  useEffect(() => {
    return () => {
      audioPreviewRef.current?.pause();
      audioPreviewRef.current = null;
    };
  }, []);

  const handleToggleAudioPreview = (id: string, url: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (playingAudioId === id) {
      audioPreviewRef.current?.pause();
      setPlayingAudioId(null);
      return;
    }

    if (!audioPreviewRef.current) {
      audioPreviewRef.current = new Audio();
      audioPreviewRef.current.onended = () => setPlayingAudioId(null);
      audioPreviewRef.current.onerror = () => setPlayingAudioId(null);
    }
    audioPreviewRef.current.src = url;
    audioPreviewRef.current.play().then(() => {
      setPlayingAudioId(id);
    }).catch(err => {
      console.error('Error playing audio preview:', err);
      setPlayingAudioId(null);
    });
  };

  const handleAddAudioFiles = async (files: FileList | File[]) => {
    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac|webm)$/i.test(f.name));
    if (audioFiles.length === 0) {
      alert('Por favor selecciona archivos de audio válidos (.mp3, .wav, .m4a, etc.).');
      return;
    }

    const newTracks: AudioTrack[] = [];
    for (const file of audioFiles) {
      try {
        const objectUrl = URL.createObjectURL(file);
        let duration = 0;
        try {
          const buffer = await decodeAudioSource(file);
          duration = buffer.duration;
        } catch {
          duration = 0;
        }
        newTracks.push({
          id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          url: objectUrl,
          duration,
        });
      } catch (err) {
        console.error('Error adding audio file:', file.name, err);
      }
    }

    if (newTracks.length > 0) {
      addAudioTracks(newTracks);
    }
  };

  const handleCutAudios = async () => {
    if (audioTracks.length === 0) {
      alert('Añade al menos un archivo de audio al proyecto antes de cortar.');
      return;
    }
    if (shots.length === 0) {
      alert('No hay planos en el guión para realizar el corte de audio.');
      return;
    }

    setIsCuttingAudio(true);
    setCuttingProgress('Iniciando corte de audio...');
    try {
      const results = await sliceAudioTracksForShots(
        audioTracks,
        shots,
        (_current, _total, message) => setCuttingProgress(message)
      );

      for (const res of results) {
        updateShotAudio(res.shotId, res.audioUrl, res.duration, `plano-${res.shotNumber}-audio.wav`);
      }
      saveStateToHistory();
    } catch (err) {
      console.error('Error cutting audio:', err);
      alert(`Error al cortar audios: ${err instanceof Error ? err.message : 'Error desconocido'}`);
    } finally {
      setIsCuttingAudio(false);
      setCuttingProgress('');
    }
  };

  const handleAudioDragStart = (e: React.DragEvent, shot: Shot) => {
    if (!shot.audioUrl) return;
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', shot.audioUrl);
    e.dataTransfer.setData('text/uri-list', shot.audioUrl);
    e.dataTransfer.setData('DownloadURL', `audio/wav:plano-${shot.number}-audio.wav:${shot.audioUrl}`);
    e.dataTransfer.setData('application/x-plano-audio', JSON.stringify({ shotId: shot.id, audioUrl: shot.audioUrl, duration: shot.audioDuration }));
    e.dataTransfer.setData('text/html', `<audio controls src="${shot.audioUrl}"></audio>`);
  };

  const handleDropAudioOnShot = async (shotId: string, dataTransfer: DataTransfer) => {
    if (dataTransfer.files && dataTransfer.files.length > 0) {
      const file = Array.from(dataTransfer.files).find(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)$/i.test(f.name));
      if (file) {
        try {
          const buffer = await decodeAudioSource(file);
          const wavBlob = audioBufferToWavBlob(buffer);
          const audioUrl = await blobToDataUrl(wavBlob);
          updateShotAudio(shotId, audioUrl, buffer.duration, file.name);
          saveStateToHistory();
          return;
        } catch (err) {
          console.error('Error processing dropped audio file on shot:', err);
        }
      }
    }

    const planoAudioData = dataTransfer.getData('application/x-plano-audio');
    if (planoAudioData) {
      try {
        const parsed = JSON.parse(planoAudioData);
        if (parsed.audioUrl) {
          updateShotAudio(shotId, parsed.audioUrl, parsed.duration);
          saveStateToHistory();
          return;
        }
      } catch {
        // ignore
      }
    }

    const uri = dataTransfer.getData('text/uri-list') || dataTransfer.getData('text/plain');
    if (uri && (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:audio/') || uri.startsWith('blob:'))) {
      updateShotAudio(shotId, uri.trim(), 3);
      saveStateToHistory();
    }
  };

  const handleDownloadAudio = (url: string, filename: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const [isConverting, setIsConverting] = useState(false);
  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);
  const [selectedRef, setSelectedRef] = useState<Reference | null>(null);
  const [promptEdit, setPromptEdit] = useState('');
  const [selectedRefIds, setSelectedRefIds] = useState<string[]>([]);
  
  const [selection, setSelection] = useState('');
  const [isNotepadMode, setIsNotepadMode] = useState(false);
  const [notepadText, setNotepadText] = useState('');
  const [isUntaggedExpanded, setIsUntaggedExpanded] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ImageModel>('gpt-5.4');
  const [selectedVideoShot, setSelectedVideoShot] = useState<Shot | null>(null);
  const [videoPromptEdit, setVideoPromptEdit] = useState('');
  const [selectedVideoRefIds, setSelectedVideoRefIds] = useState<string[]>([]);
  const [selectedVideoModel, setSelectedVideoModel] = useState<VideoModel>('grok-imagine');
  const [selectedVideoDuration, setSelectedVideoDuration] = useState(1);
  const [selectedVideoResolution, setSelectedVideoResolution] = useState<VideoResolution>('480p');
  const [selectedVideoAspectRatio, setSelectedVideoAspectRatio] = useState<VideoAspectRatio>('16:9');
  const [selectedVideoAudio, setSelectedVideoAudio] = useState(false);

  const [fullScreenImage, setFullScreenImage] = useState<string | null>(null);
  const [galleryTarget, setGalleryTarget] = useState<{ type: 'shot' | 'ref' | 'global', id?: string } | null>(null);
  const [selectedGalleryImage, setSelectedGalleryImage] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDropOnShot = async (shotId: string, dataTransfer: DataTransfer) => {
    setDragOverId(null);

    // Check if audio was dropped
    const isAudioFile = dataTransfer.files && Array.from(dataTransfer.files).some(f => f.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)$/i.test(f.name));
    const hasPlanoAudio = Boolean(dataTransfer.getData('application/x-plano-audio'));
    if (isAudioFile || hasPlanoAudio) {
      handleDropAudioOnShot(shotId, dataTransfer);
      return;
    }

    const rawUrl = await extractImageFromDataTransfer(dataTransfer);
    if (!rawUrl) return;
    const finalUrl = await convertUrlToDataUrl(rawUrl);
    updateShot(shotId, { imageUrl: finalUrl, mediaType: 'image' });
    addImageToHistory(finalUrl);
    saveStateToHistory();
  };

  const handleDropOnReference = async (refId: string, dataTransfer: DataTransfer) => {
    setDragOverId(null);
    const rawUrl = await extractImageFromDataTransfer(dataTransfer);
    if (!rawUrl) return;
    const finalUrl = await convertUrlToDataUrl(rawUrl);
    updateReference(refId, { imageUrl: finalUrl });
    addImageToHistory(finalUrl);
    saveStateToHistory();
  };

  const handleDoubleClickShot = async (shotId: string) => {
    const clipboardImg = await extractImageFromClipboard();
    if (clipboardImg) {
      updateShot(shotId, { imageUrl: clipboardImg, mediaType: 'image' });
      addImageToHistory(clipboardImg);
      saveStateToHistory();
    } else {
      setGalleryTarget({ type: 'shot', id: shotId });
    }
  };

  const handleDoubleClickReference = async (refId: string) => {
    const clipboardImg = await extractImageFromClipboard();
    if (clipboardImg) {
      updateReference(refId, { imageUrl: clipboardImg });
      addImageToHistory(clipboardImg);
      saveStateToHistory();
    } else {
      setGalleryTarget({ type: 'ref', id: refId });
    }
  };

  const handleShotDragStart = (e: React.DragEvent, shot: Shot) => {
    if (!shot.imageUrl) return;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', shot.imageUrl);
    e.dataTransfer.setData('text/uri-list', shot.imageUrl);
    e.dataTransfer.setData('text/html', `<img src="${shot.imageUrl}" alt="Plano ${shot.number}" />`);
    e.dataTransfer.setData('DownloadURL', `image/png:plano-${shot.number}.png:${shot.imageUrl}`);
    e.dataTransfer.setData('application/x-plano-image', JSON.stringify({ shotId: shot.id, imageUrl: shot.imageUrl }));
  };

  const handleReferenceDragStart = (e: React.DragEvent, ref: Reference) => {
    if (!ref.imageUrl) return;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', ref.imageUrl);
    e.dataTransfer.setData('text/uri-list', ref.imageUrl);
    e.dataTransfer.setData('text/html', `<img src="${ref.imageUrl}" alt="${ref.title}" />`);
    e.dataTransfer.setData('DownloadURL', `image/png:ref-${ref.id}.png:${ref.imageUrl}`);
    e.dataTransfer.setData('application/x-plano-image', JSON.stringify({ refId: ref.id, imageUrl: ref.imageUrl }));
  };

  const handleMouseUp = (e?: React.SyntheticEvent) => {
    // If clicking inside floating toolbar, do not reset selection
    if (e && (e.target as HTMLElement)?.closest?.('[data-floating-toolbar="true"]')) {
      return;
    }

    let selected = '';
    // Primero probar si la selección está en un textarea
    if (document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement) {
      const el = document.activeElement;
      selected = el.value.substring(el.selectionStart || 0, el.selectionEnd || 0);
    }
    
    // Si no hay selección en input, probar selección global
    if (!selected) {
      selected = window.getSelection()?.toString() || '';
    }

    if (selected && selected.trim().length > 0) {
      setSelection(selected.trim());
    } else {
      setSelection('');
    }
  };

  const handleCreateReference = () => {
    if (!selection) return;
    const title = selection.split(' ').slice(0, 4).join(' ') + (selection.split(' ').length > 4 ? '...' : '');
    addReference({ id: `ref-${Date.now()}`, title, prompt: selection, description: selection });
    setSelection('');
  };

  const handleCreateNote = () => {
    if (!selection) return;
    const words = selection.trim().split(/\s+/);
    const title = words.slice(0, 5).join(' ') + (words.length > 5 ? '...' : '');
    addNote({
      id: `note-${Date.now()}`,
      title,
      content: selection.trim(),
      createdAt: Date.now(),
      isExpanded: true,
    });
    setSelection('');
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        parseAndLoadTxt(text);
      };
      reader.onerror = () => {
        alert('No se pudo abrir el archivo. Comprueba que sea un archivo de texto o Markdown válido.');
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  const handleSave = () => {
    const text = exportToTxt();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'guion_tecnico.txt';
    a.click();
  };

  const handleConvert = async () => {
    if (!literalScript.trim()) return;
    setIsConverting(true);
    try {
      const resultTxt = await convertScriptToShots(literalScript, textModel);
      parseAndLoadTxt(resultTxt);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Error desconocido";
      alert(`Error al convertir el guion: ${message}`);
    } finally {
      setIsConverting(false);
    }
  };

  const [titleEdit, setTitleEdit] = useState('');

  const openImageModal = (item: Shot | Reference, isRef: boolean = false) => {
    setSelectedRefIds([]);
    if (isRef) {
      setSelectedRef(item as Reference);
      setSelectedShot(null);
      setTitleEdit((item as Reference).title || '');
    } else {
      setSelectedShot(item as Shot);
      setSelectedRef(null);
      setTitleEdit('');
    }
    setPromptEdit(item.description || item.prompt || '');
  };

  const handleGenerateImage = async () => {
    if (!selectedShot && !selectedRef) return;
    
    const id = selectedShot ? selectedShot.id : selectedRef!.id;
    const isRef = !!selectedRef;

    let finalPrompt = promptEdit;
    if (selectedRefIds.length > 0) {
      const allItems = [...references, ...shots];
      const activeRefs = allItems.filter(item => selectedRefIds.includes(item.id));
      const refPrompts = activeRefs.map(item => item.description || item.prompt).join(" | ");
      finalPrompt += `\n\nCon las siguientes referencias visuales: ${refPrompts}`;
    }

    const startTime = Date.now();
    const activeModel = selectedModel;

    if (isRef) {
      updateReference(id, { prompt: promptEdit, description: promptEdit, title: titleEdit, isGenerating: true, generatingStartTime: startTime, generatingModel: activeModel });
    } else {
      updateShot(id, { prompt: promptEdit, description: promptEdit, isGenerating: true, generatingStartTime: startTime, generatingModel: activeModel });
    }
    
    setSelectedShot(null);
    setSelectedRef(null);
    setSelectedRefIds([]);
    
    try {
      const url = await generateImageUrl(finalPrompt, activeModel);
      
      const elapsedSecs = Math.round((Date.now() - startTime) / 1000);
      recordGenerationTime(activeModel, elapsedSecs);

      addImageToHistory(url);

      if (isRef) {
        updateReference(id, { imageUrl: url, isGenerating: false });
      } else {
        updateShot(id, { imageUrl: url, isGenerating: false });
      }
      // Make the completed image the baseline for subsequent undo operations.
      // Otherwise undoing a later chat edit would also discard the image.
      saveStateToHistory();
    } catch (e) {
      if (isRef) {
        updateReference(id, { isGenerating: false });
      } else {
        updateShot(id, { isGenerating: false });
      }
      const message = e instanceof Error ? e.message : "Error desconocido";
      alert(`Error al generar la imagen: ${message}`);
    }
  };

  const openVideoModal = (shot: Shot) => {
    const model = shot.videoModel || selectedVideoModel;
    const config = getVideoModelConfig(model);
    setSelectedVideoShot(shot);
    setSelectedVideoModel(model);
    setSelectedVideoDuration(shot.videoDuration && config.durations.includes(shot.videoDuration) ? shot.videoDuration : config.defaultDuration);
    setSelectedVideoResolution(shot.videoResolution && config.resolutions.includes(shot.videoResolution) ? shot.videoResolution : config.defaultResolution);
    setSelectedVideoAspectRatio(shot.videoAspectRatio && config.aspectRatios.includes(shot.videoAspectRatio) ? shot.videoAspectRatio : config.defaultAspectRatio);
    setSelectedVideoAudio(config.supportsAudio && (shot.videoHasAudio ?? true));
    setVideoPromptEdit(
      shot.videoPrompt
      || `Animate this cinematic shot with natural subject motion and deliberate camera movement. Preserve the exact characters, setting, wardrobe and visual style. ${shot.prompt || shot.description}`
    );
    setSelectedVideoRefIds(references.filter(reference => reference.imageUrl).slice(0, 4).map(reference => reference.id));
  };

  const closeVideoModal = () => {
    setSelectedVideoShot(null);
    setSelectedVideoRefIds([]);
  };

  const handleVideoModelChange = (model: VideoModel) => {
    const config = getVideoModelConfig(model);
    setSelectedVideoModel(model);
    setSelectedVideoDuration(config.defaultDuration);
    setSelectedVideoResolution(config.defaultResolution);
    setSelectedVideoAspectRatio(config.defaultAspectRatio);
    setSelectedVideoAudio(config.supportsAudio);
  };

  const handleGenerateVideo = async () => {
    if (!selectedVideoShot || !videoPromptEdit.trim()) return;

    const shotId = selectedVideoShot.id;
    const shotImageUrl = selectedVideoShot.imageUrl;
    const previousVideoUrl = selectedVideoShot.videoUrl;
    const activeModel = selectedVideoModel;
    const allItems = [...references, ...shots];
    const selectedItems = allItems.filter(item => selectedVideoRefIds.includes(item.id));
    const textualReferences = selectedItems
      .map(item => `${'title' in item ? item.title : `Plano ${item.number}`}: ${item.description || item.prompt}`)
      .filter(Boolean)
      .join('\n');
    const finalPrompt = textualReferences
      ? `${videoPromptEdit.trim()}\n\nContinuity references to preserve:\n${textualReferences}`
      : videoPromptEdit.trim();
    const referenceImageUrls = [shotImageUrl, ...selectedItems.map(item => item.imageUrl)]
      .filter((url): url is string => Boolean(url));
    const startTime = Date.now();

    updateShot(shotId, {
      videoPrompt: videoPromptEdit.trim(),
      isGeneratingVideo: true,
      generatingVideoStartTime: startTime,
      generatingVideoModel: activeModel,
      videoModel: activeModel,
      videoDuration: selectedVideoDuration,
      videoResolution: selectedVideoResolution,
      videoAspectRatio: selectedVideoAspectRatio,
      videoHasAudio: selectedVideoAudio,
    });
    closeVideoModal();

    try {
      const videoUrl = await generateVideoUrl({
        prompt: finalPrompt,
        sourceImageUrl: shotImageUrl,
        referenceImageUrls: referenceImageUrls.filter(url => url !== shotImageUrl),
        model: activeModel,
        duration: selectedVideoDuration,
        resolution: selectedVideoResolution,
        aspectRatio: selectedVideoAspectRatio,
        generateAudio: selectedVideoAudio,
      });
      if (previousVideoUrl?.startsWith('blob:') && previousVideoUrl !== videoUrl) {
        URL.revokeObjectURL(previousVideoUrl);
      }
      updateShot(shotId, {
        videoUrl,
        mediaType: 'video',
        isGeneratingVideo: false,
        generatingVideoStartTime: undefined,
      });
      saveStateToHistory();
    } catch (error) {
      updateShot(shotId, {
        isGeneratingVideo: false,
        generatingVideoStartTime: undefined,
      });
      const message = error instanceof Error ? error.message : 'Error desconocido';
      alert(`Error al generar el vídeo: ${message}`);
    }
  };

  const toggleNotepadMode = () => {
    if (isNotepadMode) {
      // Saliendo del modo bloc de notas: parsear y guardar
      parseAndLoadTxt(notepadText);
    } else {
      // Entrando al modo bloc de notas: cargar texto exportado
      // Keep temporary blob: video URLs while editing inside the current
      // session. Regular file export still omits them because they cannot be
      // reopened after the browser session ends.
      setNotepadText(exportToTxt(true, true));
    }
    setIsNotepadMode(!isNotepadMode);
  };

  const activeVideoConfig = getVideoModelConfig(selectedVideoModel);
  const estimatedVideoCost = estimateVideoCost({
    model: selectedVideoModel,
    duration: selectedVideoDuration,
    resolution: selectedVideoResolution,
    generateAudio: selectedVideoAudio,
    imageCount: selectedVideoRefIds.length + (selectedVideoShot?.imageUrl ? 1 : 0),
  });

  return (
    <div className="flex flex-col h-full bg-white relative" onMouseUp={handleMouseUp} onKeyUp={handleMouseUp}>
      {/* Floating Toolbar for text selection: Reference & Note creation */}
      {selection && !isNotepadMode && (
        <div 
          data-floating-toolbar="true"
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed sm:absolute top-16 right-6 z-50 flex items-center gap-2 bg-white/95 backdrop-blur-md p-1.5 rounded-xl shadow-2xl border border-gray-200 animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <span className="text-[11px] font-semibold text-gray-500 px-2 max-w-[120px] truncate" title={selection}>
            "{selection.slice(0, 18)}..."
          </span>
          <button 
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCreateReference}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
            title="Crear nueva referencia con el texto seleccionado"
          >
            <BookmarkPlus size={14} /> Crear Referencia
          </button>
          <button 
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCreateNote}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors"
            title="Crear nota visible a partir del texto seleccionado"
          >
            <StickyNote size={14} /> Nota
          </button>
          <button 
            type="button"
            onClick={() => setSelection('')}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-md transition-colors"
            title="Cerrar barra"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between p-3 border-b border-gray-200 bg-gray-50">
        <div className="flex gap-2">
          <button onClick={() => fileInputRef.current?.click()} className="p-2 bg-gray-200 rounded hover:bg-gray-300" title="Abrir archivo (.txt o .md)" aria-label="Abrir archivo">
            <FolderOpen size={18} />
          </button>
          <input type="file" accept=".txt,.md,text/plain,text/markdown" ref={fileInputRef} className="hidden" onChange={handleLoad} />
          <input 
            type="file" 
            accept="audio/*" 
            multiple 
            ref={audioFileInputRef} 
            className="hidden" 
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleAddAudioFiles(e.target.files);
                e.target.value = '';
              }
            }} 
          />
          <input 
            type="file" 
            accept="audio/*" 
            ref={shotAudioFileInputRef} 
            className="hidden" 
            onChange={async (e) => {
              if (e.target.files && e.target.files[0] && shotAudioTargetId) {
                const file = e.target.files[0];
                try {
                  const buffer = await decodeAudioSource(file);
                  const wavBlob = audioBufferToWavBlob(buffer);
                  const audioUrl = await blobToDataUrl(wavBlob);
                  updateShotAudio(shotAudioTargetId, audioUrl, buffer.duration, file.name);
                  saveStateToHistory();
                } catch (err) {
                  console.error('Error loading shot audio:', err);
                }
                e.target.value = '';
              }
            }} 
          />
          <button onClick={handleSave} className="p-2 bg-gray-200 rounded hover:bg-gray-300" title="Guardar">
            <Save size={18} />
          </button>
          
          <button 
            onClick={toggleNotepadMode} 
            className={`p-2 rounded flex items-center gap-1 ${isNotepadMode ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 hover:bg-gray-300'}`} 
            title="Modo Bloc de Notas"
          >
            <FileText size={18} />
            <span className="text-xs font-bold hidden xl:inline">Bloc de notas</span>
          </button>

          <button 
            onClick={() => setGalleryTarget({ type: 'global' })}
            className="p-2 bg-gray-200 rounded hover:bg-gray-300 flex items-center gap-1"
            title="Abrir Galería Completa"
          >
            <Images size={18} />
            <span className="text-xs font-bold hidden xl:inline">Galería</span>
          </button>

          <div className="relative">
            <select
              className="p-2 bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold cursor-pointer appearance-none outline-none pr-6 max-w-[150px] truncate"
              value={textModel}
              onChange={(e) => setTextModel(e.target.value as TextModel)}
              title="Seleccionar motor de IA para texto/chat"
            >
              {TEXT_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="relative">
            <select
              className="p-2 bg-gray-200 hover:bg-gray-300 rounded text-xs font-bold cursor-pointer appearance-none outline-none pr-6 max-w-[150px] truncate"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as ImageModel)}
              title="Seleccionar motor de IA para imágenes"
            >
              {IMAGE_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-700">
              <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={undo} className="p-2 bg-gray-200 rounded hover:bg-gray-300" title="Deshacer">
            <Undo size={18} />
          </button>
          <button onClick={redo} className="p-2 bg-gray-200 rounded hover:bg-gray-300" title="Rehacer">
            <Redo size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isNotepadMode ? (
          <div className="flex flex-col h-full gap-2">
            <div className="bg-blue-50 text-blue-800 text-xs p-2 rounded border border-blue-200">
              Estás en Modo Bloc de notas. Edita el texto libremente. Al salir de este modo, se actualizarán tus planos visuales.
            </div>
            <textarea
              ref={notepadRef}
              className="flex-1 w-full p-4 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm leading-relaxed whitespace-pre-wrap"
              value={notepadText}
              onChange={(e) => setNotepadText(e.target.value)}
            />
          </div>
        ) : shots.length === 0 ? (
          <div className="flex flex-col h-full gap-4 relative">
            <textarea 
              ref={textareaRef}
              className="flex-1 w-full p-4 border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Escribe aquí tu guión literal... (Selecciona texto para crear referencias antes de convertir)"
              value={literalScript}
              onChange={(e) => {
                setLiteralScript(e.target.value);
                setSelection(''); // Reset selection when text changes
              }}
            />
            {notes.length > 0 && (
              <div className="flex flex-col gap-2 p-3 bg-amber-50/80 border border-amber-200 rounded-lg">
                <div className="flex items-center justify-between text-xs font-bold text-amber-900">
                  <div className="flex items-center gap-1.5">
                    <StickyNote size={14} className="text-amber-600" />
                    <span>Notas ({notes.length})</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {notes.map(note => (
                    <div key={note.id} className="bg-white border border-amber-200/90 rounded-md p-2.5 flex flex-col justify-between shadow-xs">
                      <div>
                        <div className="flex items-start justify-between gap-1 mb-1">
                          <input
                            type="text"
                            value={note.title}
                            onChange={(e) => updateNote(note.id, { title: e.target.value })}
                            className="font-bold text-xs text-amber-950 bg-transparent border-b border-transparent hover:border-amber-300 focus:outline-none flex-1 truncate"
                            title="Editar título de la nota"
                          />
                          <button
                            type="button"
                            onClick={() => deleteNote(note.id)}
                            className="text-amber-500 hover:text-red-600 p-0.5 transition-colors"
                            title="Eliminar nota"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <p className="text-xs text-amber-900 select-text whitespace-pre-wrap leading-relaxed line-clamp-3">
                          {note.content}
                        </p>
                      </div>
                      <span className="text-[9px] text-amber-600/70 text-right mt-1 font-mono">
                        {new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {references.length > 0 && (
              <div className="flex gap-2 overflow-x-auto p-2 bg-gray-50 border border-gray-200 rounded">
                {references.map(ref => (
                  <div key={ref.id} className="flex-shrink-0 w-32 bg-white border border-gray-300 rounded p-2 flex flex-col cursor-pointer hover:border-blue-500" onClick={() => openImageModal(ref, true)}>
                    <div className="text-xs font-bold truncate mb-1 text-center">{ref.title}</div>
                    <div
                      className={`w-full aspect-video bg-black flex items-center justify-center rounded overflow-hidden relative group cursor-pointer transition-colors ${
                        dragOverId === ref.id ? 'border-2 border-dashed border-blue-400 bg-blue-950/80 ring-2 ring-blue-400' : ''
                      }`}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleDoubleClickReference(ref.id);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'copy';
                        if (dragOverId !== ref.id) setDragOverId(ref.id);
                      }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragOverId !== ref.id) setDragOverId(ref.id);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (dragOverId === ref.id) setDragOverId(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleDropOnReference(ref.id, e.dataTransfer);
                      }}
                      onPaste={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const img = await extractImageFromDataTransfer(e.clipboardData);
                        if (img) {
                          const finalUrl = await convertUrlToDataUrl(img);
                          updateReference(ref.id, { imageUrl: finalUrl });
                          addImageToHistory(finalUrl);
                          saveStateToHistory();
                        }
                      }}
                    >
                      {dragOverId === ref.id && (
                        <div className="absolute inset-0 bg-blue-900/90 border-2 border-dashed border-blue-400 flex flex-col items-center justify-center text-white z-30 pointer-events-none">
                          <Upload size={16} className="mb-1 animate-bounce" />
                          <span className="text-[10px] font-bold">Soltar imagen</span>
                        </div>
                      )}
                      {ref.isGenerating ? (
                         <div className="flex flex-col items-center">
                           <Loader2 className="animate-spin text-blue-500 mb-1" size={16} />
                           {ref.generatingStartTime && ref.generatingModel && (
                             <GenerationTimer startTime={ref.generatingStartTime} model={ref.generatingModel} />
                           )}
                         </div>
                      ) : ref.imageUrl ? (
                         <img
                           src={ref.imageUrl}
                           className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
                           draggable={true}
                           onDragStart={(e) => handleReferenceDragStart(e, ref)}
                         />
                      ) : (
                         <div className="flex flex-col items-center justify-center text-center p-1">
                           <ImageIcon className="text-gray-400 mb-1" size={18} />
                           <span className="text-[10px] text-gray-400">Añadir imagen</span>
                         </div>
                      )}
                    </div>

                    {/* 4 small action buttons below reference image */}
                    <div className="flex items-center justify-between gap-1 bg-gray-100 p-0.5 rounded border border-gray-200 mt-1" role="toolbar" aria-label={`Acciones de ${ref.title}`}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); if (ref.imageUrl) setFullScreenImage(ref.imageUrl); }}
                        disabled={!ref.imageUrl}
                        className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors disabled:opacity-30 flex-1 flex items-center justify-center"
                        title="Ver imagen"
                        aria-label="Ver imagen"
                      >
                        <Eye size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setGalleryTarget({ type: 'ref', id: ref.id }); }}
                        className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors flex-1 flex items-center justify-center"
                        title="Abrir galería"
                        aria-label="Abrir galería"
                      >
                        <Images size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { if (ref.imageUrl) handleCopyImage(ref.imageUrl, e); }}
                        disabled={!ref.imageUrl}
                        className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors disabled:opacity-30 flex-1 flex items-center justify-center"
                        title="Copiar imagen"
                        aria-label="Copiar imagen"
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { if (ref.imageUrl) handleDownloadImage(ref.imageUrl, 'ref', e); }}
                        disabled={!ref.imageUrl}
                        className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors disabled:opacity-30 flex-1 flex items-center justify-center"
                        title="Descargar imagen"
                        aria-label="Descargar imagen"
                      >
                        <Download size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button 
              onClick={handleConvert}
              disabled={isConverting}
              className="py-3 px-4 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 disabled:opacity-50 flex justify-center items-center gap-2"
            >
              {isConverting ? <Loader2 className="animate-spin" /> : null}
              {isConverting ? "Convirtiendo..." : "Convertir a planos"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Caja Compactada de Texto sin Etiquetas (Guion Original) */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 shadow-xs transition-all">
              <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-200/80">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-slate-600" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Texto sin etiquetas / Guion original
                  </span>
                  <span className="text-[10px] text-slate-500 bg-slate-200/70 px-1.5 py-0.5 rounded font-mono">
                    {literalScript.length} caracteres
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsUntaggedExpanded(!isUntaggedExpanded)}
                  className="flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-blue-600 hover:bg-slate-200/60 px-2 py-1 rounded transition-colors"
                  title={isUntaggedExpanded ? "Contraer caja" : "Ampliar caja"}
                >
                  {isUntaggedExpanded ? (
                    <>
                      <ChevronUp size={14} /> Contraer
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} /> Ampliar
                    </>
                  )}
                </button>
              </div>
              <div 
                className={`text-xs text-slate-800 leading-relaxed font-sans whitespace-pre-wrap select-text transition-all ${
                  isUntaggedExpanded ? 'max-h-96 overflow-y-auto' : 'max-h-24 overflow-hidden relative'
                }`}
              >
                {literalScript.trim() ? (
                  literalScript
                ) : (
                  <span className="text-gray-400 italic">
                    (No hay texto sin etiquetas detectado en el archivo. Puedes escribir o pegar texto aquí, o seleccionar cualquier texto del proyecto para crear notas o referencias).
                  </span>
                )}
                {!isUntaggedExpanded && literalScript.trim().length > 100 && (
                  <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-slate-50 to-transparent pointer-events-none" />
                )}
              </div>
              {!isUntaggedExpanded && literalScript.trim().length > 100 && (
                <div className="mt-1 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setIsUntaggedExpanded(true)}
                    className="text-[11px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5"
                  >
                    <ChevronDown size={12} /> Mostrar texto completo ({literalScript.length} caracteres)
                  </button>
                </div>
              )}
            </div>

            {/* Sección de Notas Visibles */}
            {notes.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <StickyNote size={16} className="text-amber-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                      Notas ({notes.length})
                    </h3>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {notes.map(note => (
                    <div 
                      key={note.id} 
                      className="bg-amber-50/90 border border-amber-200/90 rounded-lg p-3 shadow-sm hover:shadow transition-shadow relative flex flex-col justify-between group"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <input
                            type="text"
                            value={note.title}
                            onChange={(e) => updateNote(note.id, { title: e.target.value })}
                            className="font-bold text-xs text-amber-950 bg-transparent border-b border-transparent hover:border-amber-300 focus:border-amber-500 focus:outline-none flex-1 truncate py-0.5"
                            title="Editar título de la nota"
                          />
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => updateNote(note.id, { isExpanded: !note.isExpanded })}
                              className="p-1 text-amber-700 hover:bg-amber-100 rounded transition-colors"
                              title={note.isExpanded ? "Contraer nota" : "Ampliar nota"}
                            >
                              {note.isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteNote(note.id)}
                              className="p-1 text-amber-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                              title="Eliminar nota"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        <div className={`text-xs text-amber-900 leading-relaxed font-sans whitespace-pre-wrap select-text ${
                          note.isExpanded ? 'max-h-48 overflow-y-auto' : 'line-clamp-2'
                        }`}>
                          {note.content}
                        </div>
                      </div>
                      <div className="text-[10px] text-amber-700/60 font-mono mt-2 text-right">
                        {new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {references.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Referencias</h3>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {references.map(ref => (
                    <div key={ref.id} className="flex-shrink-0 w-48 bg-white border border-gray-200 rounded p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer" onClick={() => openImageModal(ref, true)}>
                      <div className="text-sm font-bold truncate mb-2">{ref.title}</div>
                      <div
                        className={`w-full aspect-video bg-black flex items-center justify-center rounded overflow-hidden mb-2 relative group cursor-pointer transition-colors ${
                          dragOverId === ref.id ? 'border-2 border-dashed border-blue-400 bg-blue-950/80 ring-2 ring-blue-400' : ''
                        }`}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleDoubleClickReference(ref.id);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = 'copy';
                          if (dragOverId !== ref.id) setDragOverId(ref.id);
                        }}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (dragOverId !== ref.id) setDragOverId(ref.id);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (dragOverId === ref.id) setDragOverId(null);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDropOnReference(ref.id, e.dataTransfer);
                        }}
                        onPaste={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const img = await extractImageFromDataTransfer(e.clipboardData);
                          if (img) {
                            const finalUrl = await convertUrlToDataUrl(img);
                            updateReference(ref.id, { imageUrl: finalUrl });
                            addImageToHistory(finalUrl);
                            saveStateToHistory();
                          }
                        }}
                      >
                        {dragOverId === ref.id && (
                          <div className="absolute inset-0 bg-blue-900/90 border-2 border-dashed border-blue-400 flex flex-col items-center justify-center text-white z-30 pointer-events-none">
                            <Upload size={20} className="mb-1 animate-bounce" />
                            <span className="text-xs font-bold">Soltar imagen</span>
                          </div>
                        )}
                        {ref.isGenerating ? (
                           <div className="flex flex-col items-center">
                             <Loader2 className="animate-spin text-blue-500 mb-1" size={20} />
                             {ref.generatingStartTime && ref.generatingModel ? (
                               <GenerationTimer startTime={ref.generatingStartTime} model={ref.generatingModel} />
                             ) : (
                               <span className="text-[10px] text-gray-500">Generando</span>
                             )}
                           </div>
                        ) : ref.imageUrl ? (
                           <img
                             src={ref.imageUrl}
                             className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
                             draggable={true}
                             onDragStart={(e) => handleReferenceDragStart(e, ref)}
                           />
                        ) : (
                           <div className="flex flex-col items-center justify-center text-center p-2">
                             <ImageIcon className="text-gray-400 mb-1" size={24} />
                             <span className="text-xs text-gray-400">Añadir imagen</span>
                           </div>
                        )}
                      </div>

                      {/* 4 small action buttons below reference image */}
                      <div className="flex items-center justify-between gap-1 bg-gray-100 p-1 rounded border border-gray-200 mb-2" role="toolbar" aria-label={`Acciones de ${ref.title}`}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); if (ref.imageUrl) setFullScreenImage(ref.imageUrl); }}
                          disabled={!ref.imageUrl}
                          className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors disabled:opacity-30 flex-1 flex items-center justify-center"
                          title="Ver imagen"
                          aria-label="Ver imagen"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setGalleryTarget({ type: 'ref', id: ref.id }); }}
                          className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors flex-1 flex items-center justify-center"
                          title="Abrir galería"
                          aria-label="Abrir galería"
                        >
                          <Images size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { if (ref.imageUrl) handleCopyImage(ref.imageUrl, e); }}
                          disabled={!ref.imageUrl}
                          className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors disabled:opacity-30 flex-1 flex items-center justify-center"
                          title="Copiar imagen"
                          aria-label="Copiar imagen"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { if (ref.imageUrl) handleDownloadImage(ref.imageUrl, 'ref', e); }}
                          disabled={!ref.imageUrl}
                          className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors disabled:opacity-30 flex-1 flex items-center justify-center"
                          title="Descargar imagen"
                          aria-label="Descargar imagen"
                        >
                          <Download size={14} />
                        </button>
                      </div>
                      <div className="text-xs text-gray-600 line-clamp-3">{ref.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Project Audios Section */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 shadow-xs">
              <div className="flex items-center justify-between mb-2">
                <div 
                  className="flex items-center gap-2 cursor-pointer select-none"
                  onClick={() => setIsAudioSectionOpen(!isAudioSectionOpen)}
                >
                  <Music className="text-indigo-600" size={18} />
                  <span className="font-bold text-sm text-slate-800 uppercase tracking-wider">
                    Audios del Proyecto ({audioTracks.length})
                  </span>
                  {isAudioSectionOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => audioFileInputRef.current?.click()}
                    className="px-2.5 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Añadir uno o varios archivos de audio (.mp3, .wav, etc.)"
                  >
                    <Plus size={14} />
                    <span>Añadir audio(s)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCutAudios}
                    disabled={isCuttingAudio || audioTracks.length === 0 || shots.length === 0}
                    className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 transition-all shadow-xs ${
                      isCuttingAudio
                        ? 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
                        : audioTracks.length > 0 && shots.length > 0
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-amber-200 cursor-pointer'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                    title="Cortar audios originales y dividirlos en pequeños trozos según los planos"
                  >
                    {isCuttingAudio ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Cortando...</span>
                      </>
                    ) : (
                      <>
                        <Scissors size={14} />
                        <AudioLines size={14} />
                        <span>Cortar audios</span>
                      </>
                    )}
                  </button>

                  {audioTracks.length > 0 && (
                    <button
                      type="button"
                      onClick={clearAudioTracks}
                      className="px-2 py-1 text-[11px] text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                      title="Eliminar todas las pistas de audio"
                    >
                      Limpiar
                    </button>
                  )}
                </div>
              </div>

              {isCuttingAudio && (
                <div className="mb-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-amber-600" />
                  <span className="font-medium">{cuttingProgress}</span>
                </div>
              )}

              {isAudioSectionOpen && (
                <div 
                  className={`transition-colors rounded-md p-2 ${
                    isAudioZoneDragOver ? 'bg-indigo-100/70 border-2 border-dashed border-indigo-400 ring-2 ring-indigo-300' : ''
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'copy';
                    setIsAudioZoneDragOver(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsAudioZoneDragOver(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsAudioZoneDragOver(false);
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      handleAddAudioFiles(e.dataTransfer.files);
                    }
                  }}
                >
                  {audioTracks.length === 0 ? (
                    <div 
                      onClick={() => audioFileInputRef.current?.click()}
                      className="border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-lg p-3 text-center cursor-pointer transition-colors bg-white"
                    >
                      <AudioLines className="mx-auto text-gray-400 mb-1" size={24} />
                      <p className="text-xs text-gray-600 font-medium">
                        Arrastra archivos de audio (.mp3, .wav, .m4a) o haz clic en <span className="text-indigo-600 font-bold">Añadir audio(s)</span>
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        Se reproducirán secuencialmente (primero el 1º, luego el 2º) al dar a Play, o podrás cortarlos para cada plano con las tijeras.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {audioTracks.map((track, idx) => (
                        <div 
                          key={track.id}
                          className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded border border-gray-200 text-xs hover:border-gray-300 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-bold text-[10px] flex items-center justify-center flex-shrink-0">
                              {idx + 1}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => handleToggleAudioPreview(track.id, track.url, e)}
                              className={`p-1 rounded-full flex-shrink-0 transition-colors ${
                                playingAudioId === track.id ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                              }`}
                              title={playingAudioId === track.id ? "Pausar" : "Escuchar audio"}
                            >
                              {playingAudioId === track.id ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
                            </button>
                            <span className="font-medium text-gray-800 truncate" title={track.name}>
                              {track.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {track.duration > 0 && (
                              <span className="text-[10px] font-mono text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                                {formatSecondsToTime(track.duration)}
                              </span>
                            )}
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => reorderAudioTracks(idx, idx - 1)}
                              className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20"
                              title="Subir en orden"
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              type="button"
                              disabled={idx === audioTracks.length - 1}
                              onClick={() => reorderAudioTracks(idx, idx + 1)}
                              className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-20"
                              title="Bajar en orden"
                            >
                              <ArrowDown size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeAudioTrack(track.id)}
                              className="p-1 text-gray-400 hover:text-red-600"
                              title="Eliminar audio"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Planos ({shots.length})</h3>
            {shots.map((shot, shotIdx) => {
              const isActive = shotIdx === activeShotIndex;
              return (
                <div 
                  key={shot.id} 
                  onClick={() => setActiveShotIndex(shotIdx)}
                  className={`flex gap-4 border-b pb-6 relative rounded-lg p-3 transition-all ${
                    isActive 
                      ? 'border-blue-500 bg-blue-50/20 ring-2 ring-blue-400/70 shadow-sm' 
                      : 'border-gray-200 hover:bg-gray-50/40'
                  }`}
                >
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className={`font-bold text-lg ${isActive ? 'text-blue-600' : 'text-gray-900'}`}>
                          PLANO {shot.number}
                        </div>
                        <div className="text-sm text-gray-500 font-mono">[{shot.timeRange}]</div>
                        {isActive && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded uppercase">
                            Activo
                          </span>
                        )}
                      </div>

                      {/* Draggable sound wave icon for cut audio */}
                      {shot.audioUrl ? (
                        <div 
                          className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-300 hover:border-emerald-500 text-emerald-800 px-2 py-1 rounded-md text-xs cursor-grab active:cursor-grabbing transition-all shadow-xs select-none group"
                          draggable={true}
                          onDragStart={(e) => handleAudioDragStart(e, shot)}
                          title="Audio cortado de este plano. Arrástralo a otra ventana, a Chrome o a otro plano. Clic en Play para escuchar."
                        >
                          <button
                            type="button"
                            onClick={(e) => handleToggleAudioPreview(shot.id, shot.audioUrl!, e)}
                            className="p-0.5 text-emerald-700 hover:text-emerald-900 rounded-full hover:bg-emerald-100 cursor-pointer"
                            title={playingAudioId === shot.id ? "Pausar audio" : "Escuchar audio cortado"}
                          >
                            {playingAudioId === shot.id ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
                          </button>
                          
                          <div className="flex items-center gap-1">
                            <AudioLines size={14} className="text-emerald-600 group-hover:animate-pulse" />
                            <span className="font-mono text-[11px] font-semibold">
                              {shot.audioDuration ? `${shot.audioDuration.toFixed(1)}s` : 'Audio'}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => handleDownloadAudio(shot.audioUrl!, `plano-${shot.number}-audio.wav`, e)}
                            className="p-0.5 text-emerald-600 hover:text-emerald-900 rounded hover:bg-emerald-100 ml-0.5 cursor-pointer"
                            title="Descargar archivo WAV de este plano"
                          >
                            <Download size={11} />
                          </button>
                        </div>
                      ) : (
                        <div
                          className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 px-2 py-0.5 rounded border border-gray-200 text-[11px] cursor-pointer transition-colors"
                          title="Sin audio cortado. Corta los audios del proyecto con las tijeras o haz clic/suelta un archivo de audio aquí."
                          onClick={(e) => {
                            e.stopPropagation();
                            setShotAudioTargetId(shot.id);
                            shotAudioFileInputRef.current?.click();
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'copy';
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDropAudioOnShot(shot.id, e.dataTransfer);
                          }}
                        >
                          <AudioLines size={13} />
                          <span>+ Audio</span>
                        </div>
                      )}
                    </div>

                    {/* Texto Original del Guion (dividido en este plano) */}
                    <div className="mb-2.5">
                      <div className="flex items-center justify-between text-[11px] font-bold text-amber-900 uppercase tracking-wider mb-1">
                        <span className="flex items-center gap-1">
                          <FileText size={12} className="text-amber-600" />
                          Texto original (Guion)
                        </span>
                      </div>
                      <AutoResizeTextarea
                        className="w-full text-xs text-gray-900 bg-amber-50/40 border border-amber-200/80 hover:border-amber-300 focus:border-amber-500 focus:bg-white rounded-md p-2 transition-colors font-sans leading-relaxed"
                        placeholder="Fragmento del texto original del guion correspondiente a este plano..."
                        value={shot.originalText || ''}
                        onChange={(val) => updateShot(shot.id, { originalText: val })}
                      />
                    </div>

                    {/* Realización Visual / Cómo Debería Dibujarse */}
                    <div>
                      <div className="flex items-center justify-between text-[11px] font-bold text-gray-600 uppercase tracking-wider mb-1">
                        <span>Realización visual (Cómo dibujarse)</span>
                      </div>
                      <AutoResizeTextarea
                        className="w-full text-xs text-gray-800 bg-gray-50/80 border border-gray-200 hover:border-gray-300 focus:border-blue-400 focus:bg-white rounded-md p-2 transition-colors font-sans leading-relaxed"
                        placeholder="Descripción visual de la escena, movimientos de cámara, ángulos..."
                        value={shot.description}
                        onChange={(val) => updateShot(shot.id, { description: val })}
                      />
                    </div>
                  </div>
                
                <div className="w-48 flex-shrink-0 flex flex-col gap-2">
                  <div
                    className={`w-full aspect-video bg-black border rounded flex flex-col items-center justify-center transition-colors overflow-hidden group relative cursor-pointer ${
                      dragOverId === shot.id
                        ? 'border-2 border-dashed border-blue-400 bg-blue-950/80 ring-2 ring-blue-400'
                        : 'border-gray-300 hover:bg-gray-800'
                    }`}
                    onClick={() => {
                      if (shot.mediaType !== 'video' || !shot.videoUrl) openImageModal(shot, false);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleDoubleClickShot(shot.id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'copy';
                      if (dragOverId !== shot.id) setDragOverId(shot.id);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragOverId !== shot.id) setDragOverId(shot.id);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (dragOverId === shot.id) setDragOverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDropOnShot(shot.id, e.dataTransfer);
                    }}
                    onPaste={async (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const img = await extractImageFromDataTransfer(e.clipboardData);
                      if (img) {
                        const finalUrl = await convertUrlToDataUrl(img);
                        updateShot(shot.id, { imageUrl: finalUrl, mediaType: 'image' });
                        addImageToHistory(finalUrl);
                        saveStateToHistory();
                      }
                    }}
                    tabIndex={0}
                  >
                    {dragOverId === shot.id && (
                      <div className="absolute inset-0 bg-blue-900/90 border-2 border-dashed border-blue-400 flex flex-col items-center justify-center text-white z-30 pointer-events-none">
                        <Upload size={24} className="mb-1 animate-bounce" />
                        <span className="text-xs font-bold">Soltar imagen aquí</span>
                      </div>
                    )}
                    {shot.isGeneratingVideo ? (
                      <div className="flex flex-col items-center text-violet-400 px-2 text-center">
                        <Loader2 className="animate-spin mb-2" />
                        <span className="text-xs font-semibold">Generando vídeo</span>
                        {shot.generatingVideoModel && (
                          <span className="text-[10px] text-gray-400">{getVideoModelConfig(shot.generatingVideoModel).label}</span>
                        )}
                        {shot.generatingVideoStartTime && <VideoGenerationTimer startTime={shot.generatingVideoStartTime} />}
                      </div>
                    ) : shot.mediaType === 'video' && shot.videoUrl ? (
                      <>
                        <video
                          src={shot.videoUrl}
                          poster={shot.imageUrl}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-contain"
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Vídeo del plano ${shot.number}`}
                        />
                        <button
                          type="button"
                          onClick={(event) => handleDownloadVideo(shot.videoUrl!, shot.number, event)}
                          className="absolute top-1 right-1 p-1.5 bg-black/70 text-white rounded-full hover:bg-black"
                          title="Descargar vídeo"
                          aria-label={`Descargar vídeo del plano ${shot.number}`}
                        >
                          <Download size={14} />
                        </button>
                      </>
                    ) : shot.isGenerating ? (
                      <div className="flex flex-col items-center text-blue-500">
                        <Loader2 className="animate-spin mb-2" />
                        {shot.generatingStartTime && shot.generatingModel ? (
                          <GenerationTimer startTime={shot.generatingStartTime} model={shot.generatingModel} />
                        ) : (
                          <span className="text-xs font-semibold">Generando...</span>
                        )}
                      </div>
                    ) : shot.imageUrl ? (
                      <img
                        src={shot.imageUrl}
                        alt={shot.shortDesc}
                        className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
                        draggable={true}
                        onDragStart={(e) => handleShotDragStart(e, shot)}
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-center p-2">
                        <ImageIcon className="text-gray-400 mb-1" size={28} />
                        <span className="text-xs text-gray-400">Añadir imagen</span>
                      </div>
                    )}
                  </div>

                  {/* 4 small action buttons below the shot image */}
                  <div className="flex items-center justify-between gap-1 bg-gray-100 p-1 rounded border border-gray-200" role="toolbar" aria-label={`Acciones visuales del plano ${shot.number}`}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); if (shot.imageUrl) setFullScreenImage(shot.imageUrl); }}
                      disabled={!shot.imageUrl}
                      className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors disabled:opacity-30 flex-1 flex items-center justify-center"
                      title="Ver imagen"
                      aria-label={`Ver imagen del plano ${shot.number}`}
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setGalleryTarget({ type: 'shot', id: shot.id }); }}
                      className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors flex-1 flex items-center justify-center"
                      title="Abrir galería"
                      aria-label={`Abrir galería para el plano ${shot.number}`}
                    >
                      <Images size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { if (shot.imageUrl) handleCopyImage(shot.imageUrl, e); }}
                      disabled={!shot.imageUrl}
                      className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors disabled:opacity-30 flex-1 flex items-center justify-center"
                      title="Copiar imagen"
                      aria-label={`Copiar imagen del plano ${shot.number}`}
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { if (shot.imageUrl) handleDownloadImage(shot.imageUrl, 'plano', e); }}
                      disabled={!shot.imageUrl}
                      className="p-1 text-gray-600 hover:text-blue-600 hover:bg-white rounded transition-colors disabled:opacity-30 flex-1 flex items-center justify-center"
                      title="Descargar imagen"
                      aria-label={`Descargar imagen del plano ${shot.number}`}
                    >
                      <Download size={14} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-1" role="group" aria-label={`Medio activo del plano ${shot.number}`}>
                    <button
                      type="button"
                      onClick={() => updateShot(shot.id, { mediaType: 'image' })}
                      disabled={!shot.imageUrl}
                      className={`px-2 py-1 rounded text-[11px] font-semibold border disabled:opacity-40 ${shot.mediaType !== 'video' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                      title="Mostrar imagen en el visualizador"
                    >
                      Imagen
                    </button>
                    <button
                      type="button"
                      onClick={() => updateShot(shot.id, { mediaType: 'video' })}
                      disabled={!shot.videoUrl}
                      className={`px-2 py-1 rounded text-[11px] font-semibold border disabled:opacity-40 ${shot.mediaType === 'video' && shot.videoUrl ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                      title="Mostrar vídeo en el visualizador"
                    >
                      Vídeo
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => openVideoModal(shot)}
                    disabled={!shot.imageUrl || shot.isGeneratingVideo}
                    className="w-full px-2 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold flex items-center justify-center gap-1.5"
                    title={shot.imageUrl ? 'Configurar y generar vídeo' : 'Genera o asigna primero una imagen al plano'}
                  >
                    <Film size={14} /> {shot.videoUrl ? 'Regenerar vídeo' : 'Generar vídeo'}
                  </button>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Video Generation Modal */}
      {selectedVideoShot && (
        <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
              <div>
                <h2 className="text-lg font-bold">Generar vídeo para PLANO {selectedVideoShot.number}</h2>
                <p className="text-xs text-gray-500 mt-1">
                  {activeVideoConfig.label} · {selectedVideoDuration} s · {selectedVideoResolution} · {selectedVideoAspectRatio}
                  {activeVideoConfig.audioManagedByProvider
                    ? ' · audio según proveedor'
                    : activeVideoConfig.supportsAudio
                      ? (selectedVideoAudio ? ' · con audio' : ' · sin audio')
                      : ' · sin audio'}
                  {estimatedVideoCost !== null ? ` · coste estimado ${estimatedVideoCost.toFixed(3).replace('.', ',')} USD` : ''}
                </p>
              </div>
              <button type="button" onClick={closeVideoModal} className="text-gray-500 hover:text-gray-800" title="Cerrar">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto max-h-[72vh] flex flex-col gap-5">
              <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-5">
                <div>
                  <div className="text-sm text-gray-700 font-semibold mb-2">Imagen inicial del plano</div>
                  <div className="w-full aspect-video bg-black rounded overflow-hidden border border-gray-300">
                    {selectedVideoShot.imageUrl ? (
                      <img src={selectedVideoShot.imageUrl} alt={selectedVideoShot.shortDesc} className="w-full h-full object-contain" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">Sin imagen</div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="video-model" className="text-sm text-gray-700 font-semibold">Modelo de vídeo</label>
                  <select
                    id="video-model"
                    value={selectedVideoModel}
                    onChange={event => handleVideoModelChange(event.target.value as VideoModel)}
                    className="w-full p-2 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {VIDEO_MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                  </select>
                  <p className="text-xs text-gray-600">{activeVideoConfig.description}</p>
                  <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    La generación es asíncrona. Puedes seguir editando el guion mientras OpenRouter trabaja.
                    {activeVideoConfig.pricingNote && <span className="block mt-1">{activeVideoConfig.pricingNote}</span>}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded border border-gray-200 bg-gray-50 p-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor="video-duration" className="text-xs font-semibold text-gray-700">Duración</label>
                  <select
                    id="video-duration"
                    value={selectedVideoDuration}
                    onChange={event => setSelectedVideoDuration(Number(event.target.value))}
                    className="p-2 border border-gray-300 rounded bg-white text-sm"
                  >
                    {activeVideoConfig.durations.map(duration => <option key={duration} value={duration}>{duration} s</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="video-resolution" className="text-xs font-semibold text-gray-700">Resolución</label>
                  <select
                    id="video-resolution"
                    value={selectedVideoResolution}
                    onChange={event => setSelectedVideoResolution(event.target.value as VideoResolution)}
                    className="p-2 border border-gray-300 rounded bg-white text-sm"
                  >
                    {activeVideoConfig.resolutions.map(resolution => <option key={resolution} value={resolution}>{resolution}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="video-aspect" className="text-xs font-semibold text-gray-700">Formato</label>
                  <select
                    id="video-aspect"
                    value={selectedVideoAspectRatio}
                    onChange={event => setSelectedVideoAspectRatio(event.target.value as VideoAspectRatio)}
                    className="p-2 border border-gray-300 rounded bg-white text-sm"
                  >
                    {activeVideoConfig.aspectRatios.map(aspect => <option key={aspect} value={aspect}>{aspect}</option>)}
                  </select>
                </div>
                <label className={`flex items-center gap-2 rounded border border-gray-300 bg-white px-3 text-sm ${activeVideoConfig.supportsAudio ? 'cursor-pointer' : 'opacity-50'}`}>
                  <input
                    type="checkbox"
                    checked={activeVideoConfig.supportsAudio && selectedVideoAudio}
                    onChange={event => setSelectedVideoAudio(event.target.checked)}
                    disabled={!activeVideoConfig.supportsAudio}
                  />
                  {activeVideoConfig.audioManagedByProvider ? 'Audio según proveedor' : 'Generar audio'}
                </label>
              </div>

              {(() => {
                const availableItems = [
                  ...references.map(reference => ({ ...reference, displayTitle: reference.title })),
                  ...shots
                    .filter(shot => shot.id !== selectedVideoShot.id)
                    .map(shot => ({ ...shot, displayTitle: `Plano ${shot.number}` })),
                ].filter(item => item.imageUrl);

                if (availableItems.length === 0) return null;

                return (
                  <div className="flex flex-col gap-2">
                    <label className="text-sm text-gray-700 font-semibold">
                      Referencias visuales y de continuidad (opcional, máximo 4)
                    </label>
                    <div className="flex gap-3 overflow-x-auto p-2 bg-gray-50 border border-gray-200 rounded">
                      {availableItems.map(item => {
                        const isSelected = selectedVideoRefIds.includes(item.id);
                        return (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedVideoRefIds(selectedVideoRefIds.filter(id => id !== item.id));
                              } else if (selectedVideoRefIds.length < 4) {
                                setSelectedVideoRefIds([...selectedVideoRefIds, item.id]);
                              }
                            }}
                            className={`flex-shrink-0 w-28 rounded border-2 p-1 transition-colors ${isSelected ? 'border-violet-500 bg-violet-50' : 'border-transparent hover:border-gray-300'}`}
                            aria-pressed={isSelected}
                            title={isSelected ? 'Quitar referencia' : 'Usar referencia'}
                          >
                            <div className="text-[10px] font-bold truncate text-center mb-1">{item.displayTitle}</div>
                            <div className="w-full aspect-video bg-black flex items-center justify-center rounded overflow-hidden">
                              <img src={item.imageUrl} alt="" className="w-full h-full object-contain" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              <div className="flex flex-col gap-2">
                <label htmlFor="video-prompt" className="text-sm text-gray-700 font-semibold">Texto de movimiento, acción y cámara</label>
                <textarea
                  id="video-prompt"
                  className="w-full h-36 p-3 border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
                  value={videoPromptEdit}
                  onChange={event => setVideoPromptEdit(event.target.value)}
                  placeholder="Describe cómo se mueve el sujeto, la cámara y el ambiente..."
                />
                <p className="text-xs text-gray-500">La descripción de cada referencia seleccionada se añade automáticamente al prompt para conservar personajes y estilo.</p>
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50 rounded-b-lg">
              <button type="button" onClick={closeVideoModal} className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100 font-semibold">
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGenerateVideo}
                disabled={!videoPromptEdit.trim() || !selectedVideoShot.imageUrl}
                className="px-4 py-2 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed font-bold flex items-center gap-2"
              >
                <Film size={18} /> Generar vídeo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Generation Modal */}
      {(selectedShot || selectedRef) && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-lg">
              <h2 className="text-lg font-bold">Generar imagen para {selectedShot ? `PLANO ${selectedShot.number}` : 'Referencia'}</h2>
              <button onClick={() => { setSelectedShot(null); setSelectedRef(null); setSelectedRefIds([]); }} className="text-gray-500 hover:text-gray-800">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[70vh]">
              {selectedRef && (
                <div className="flex flex-col gap-2 mb-4">
                  <label className="text-sm text-gray-600 font-semibold">Nombre de la referencia:</label>
                  <input 
                    type="text"
                    className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={titleEdit}
                    onChange={(e) => setTitleEdit(e.target.value)}
                  />
                </div>
              )}
              
              {(() => {
                const availableItems = [
                  ...references.map(r => ({ ...r, displayTitle: r.title, isRef: true })),
                  ...shots.map(s => ({ ...s, displayTitle: `Plano ${s.number}`, isRef: false }))
                ].filter(item => {
                  if (selectedShot && item.id === selectedShot.id) return false;
                  if (selectedRef && item.id === selectedRef.id) return false;
                  return true;
                });

                if (availableItems.length === 0) return null;

                return (
                  <div className="flex flex-col gap-2 mb-6">
                    <label className="text-sm text-gray-600 font-semibold">
                      ¿Usar referencias de estilo para esta generación? (opcional)
                    </label>
                    <div className="flex gap-3 overflow-x-auto p-2 bg-gray-50 border border-gray-200 rounded">
                      {availableItems.map(item => {
                        const isSelected = selectedRefIds.includes(item.id);
                        return (
                          <div 
                            key={item.id} 
                            onClick={() => {
                              if (isSelected) setSelectedRefIds(selectedRefIds.filter(id => id !== item.id));
                              else setSelectedRefIds([...selectedRefIds, item.id]);
                            }}
                            className={`flex-shrink-0 w-24 cursor-pointer rounded border-2 p-1 transition-colors ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-transparent hover:border-gray-300'}`}
                          >
                            <div className="text-[10px] font-bold truncate text-center mb-1">{item.displayTitle}</div>
                            <div className="w-full aspect-video bg-black flex items-center justify-center rounded overflow-hidden">
                              {item.imageUrl ? (
                                <img src={item.imageUrl} className="w-full h-full object-contain" />
                              ) : (
                                <ImageIcon className="text-gray-400" size={12} />
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                );
              })()}

              <div className="flex flex-col gap-2">
                <label className="text-sm text-gray-600 font-semibold">Texto para generar imagen (Descripción):</label>
                <textarea 
                  className="w-full h-32 p-3 border border-gray-300 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={promptEdit}
                  onChange={(e) => setPromptEdit(e.target.value)}
                />
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50 rounded-b-lg">
              <button 
                onClick={() => {
                  const targetId = selectedShot ? selectedShot.id : selectedRef!.id;
                  const targetType = selectedShot ? 'shot' : 'ref';
                  setGalleryTarget({ type: targetType, id: targetId });
                  // Don't close generation modal until they select or cancel
                }}
                className="px-4 py-2 border border-blue-200 text-blue-700 rounded hover:bg-blue-50 font-semibold flex items-center gap-2 mr-auto"
              >
                <Images size={18} /> Elegir de Galería
              </button>
              <button 
                onClick={() => { setSelectedShot(null); setSelectedRef(null); setSelectedRefIds([]); }}
                className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100 font-semibold"
              >
                Cancelar
              </button>
              <button 
                onClick={handleGenerateImage}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 font-bold flex items-center gap-2"
              >
                <ImageIcon size={18} /> Generar Imagen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Modal */}
      {fullScreenImage && (
        <div className="fixed inset-0 bg-black/95 z-[200] flex items-center justify-center p-8" onClick={() => setFullScreenImage(null)}>
          <div className="absolute top-4 right-4 flex gap-4">
            <button onClick={(e) => handleCopyImage(fullScreenImage, e)} className="text-white hover:text-gray-300 bg-gray-800/50 p-2 rounded-full" title="Copiar imagen">
              <Copy size={24}/>
            </button>
            <button onClick={(e) => handleDownloadImage(fullScreenImage, 'imagen', e)} className="text-white hover:text-gray-300 bg-gray-800/50 p-2 rounded-full" title="Descargar imagen">
              <Download size={24}/>
            </button>
            <button className="text-white hover:text-gray-300 bg-gray-800/50 p-2 rounded-full" title="Cerrar">
              <X size={24}/>
            </button>
          </div>
          <img src={fullScreenImage} className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* Gallery Modal */}
      {galleryTarget && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-xl font-bold">Galería del Proyecto</h2>
              <button onClick={() => { setGalleryTarget(null); setSelectedGalleryImage(null); }} className="text-gray-500 hover:text-gray-800">
                <X size={24}/>
              </button>
            </div>
            <div
              className={`flex-1 overflow-y-auto p-4 grid grid-cols-2 md:grid-cols-3 gap-4 bg-gray-100 transition-colors ${
                dragOverId === 'gallery-modal' ? 'bg-blue-50 border-2 border-dashed border-blue-400' : ''
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                if (dragOverId !== 'gallery-modal') setDragOverId('gallery-modal');
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragOverId !== 'gallery-modal') setDragOverId('gallery-modal');
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (dragOverId === 'gallery-modal') setDragOverId(null);
              }}
              onDrop={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverId(null);
                const rawUrl = await extractImageFromDataTransfer(e.dataTransfer);
                if (rawUrl) {
                  const finalUrl = await convertUrlToDataUrl(rawUrl);
                  addImageToHistory(finalUrl);
                  if (galleryTarget.type === 'shot' && galleryTarget.id) {
                    updateShot(galleryTarget.id, { imageUrl: finalUrl, mediaType: 'image' });
                    saveStateToHistory();
                  } else if (galleryTarget.type === 'ref' && galleryTarget.id) {
                    updateReference(galleryTarget.id, { imageUrl: finalUrl });
                    saveStateToHistory();
                  }
                }
              }}
            >
              {imageHistory.length > 0 ? imageHistory.map((img, i) => (
                <div 
                  key={i} 
                  className={`relative aspect-video bg-black rounded cursor-pointer border-4 transition-all group ${selectedGalleryImage === img ? 'border-blue-500 scale-[0.98]' : 'border-transparent hover:border-gray-400'}`}
                  onClick={() => setSelectedGalleryImage(img)}
                  onDoubleClick={() => {
                    if (galleryTarget.type === 'shot' && galleryTarget.id) {
                      updateShot(galleryTarget.id, { imageUrl: img, mediaType: 'image' });
                      saveStateToHistory();
                    } else if (galleryTarget.type === 'ref' && galleryTarget.id) {
                      updateReference(galleryTarget.id, { imageUrl: img });
                      saveStateToHistory();
                    }
                    setGalleryTarget(null);
                    setSelectedGalleryImage(null);
                    setSelectedShot(null);
                    setSelectedRef(null);
                    setSelectedRefIds([]);
                  }}
                  title={galleryTarget.type !== 'global' ? "Doble clic para asignar directamente" : undefined}
                >
                  <img
                    src={img}
                    className="w-full h-full object-cover cursor-grab active:cursor-grabbing"
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'copyMove';
                      e.dataTransfer.setData('text/plain', img);
                      e.dataTransfer.setData('text/uri-list', img);
                      e.dataTransfer.setData('text/html', `<img src="${img}" alt="Galería ${i + 1}" />`);
                      e.dataTransfer.setData('DownloadURL', `image/png:galeria-${i + 1}.png:${img}`);
                      e.dataTransfer.setData('application/x-plano-image', JSON.stringify({ imageUrl: img }));
                    }}
                  />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                    <button onClick={(e) => { e.stopPropagation(); setFullScreenImage(img); }} className="p-2 bg-white rounded-full hover:bg-gray-200 text-gray-800" title="Ver imagen">
                      <Eye size={18} />
                    </button>
                    <button onClick={(e) => handleCopyImage(img, e)} className="p-2 bg-white rounded-full hover:bg-gray-200 text-gray-800" title="Copiar imagen">
                      <Copy size={18} />
                    </button>
                    <button onClick={(e) => handleDownloadImage(img, 'galeria', e)} className="p-2 bg-white rounded-full hover:bg-gray-200 text-gray-800" title="Descargar imagen">
                      <Download size={18} />
                    </button>
                  </div>
                </div>
              )) : (
                <div className="col-span-full flex flex-col items-center justify-center h-full text-gray-500 gap-4 mt-20">
                  <Images size={48} className="opacity-50" />
                  <p>No hay imágenes en la galería. Puedes arrastrar imágenes aquí para añadirlas.</p>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-between items-center bg-gray-50">
              <span className="text-xs text-gray-500">
                {galleryTarget.type !== 'global' ? 'Consejo: Haz doble clic en una imagen para asignarla rápidamente' : 'Arrastra imágenes desde el explorador o Chrome para añadirlas a la galería'}
              </span>
              <div className="flex gap-3">
                <button 
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100 font-semibold" 
                  onClick={() => { setGalleryTarget(null); setSelectedGalleryImage(null); }}
                >
                  {galleryTarget.type === 'global' ? 'Cerrar' : 'Cancelar'}
                </button>
                {galleryTarget.type !== 'global' && (
                  <button 
                    className="px-4 py-2 bg-blue-600 text-white rounded font-bold disabled:opacity-50 hover:bg-blue-700"
                    disabled={!selectedGalleryImage}
                    onClick={() => {
                      if (galleryTarget.type === 'shot' && galleryTarget.id) {
                        updateShot(galleryTarget.id, { imageUrl: selectedGalleryImage!, mediaType: 'image' });
                        saveStateToHistory();
                      } else if (galleryTarget.type === 'ref' && galleryTarget.id) {
                        updateReference(galleryTarget.id, { imageUrl: selectedGalleryImage! });
                        saveStateToHistory();
                      }
                      setGalleryTarget(null);
                      setSelectedGalleryImage(null);
                      setSelectedShot(null);
                      setSelectedRef(null);
                      setSelectedRefIds([]);
                    }}
                  >
                    Aceptar
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
