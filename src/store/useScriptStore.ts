import { create } from 'zustand';
import type { ImageModel, TextModel, VideoAspectRatio, VideoModel, VideoResolution } from '../services/ai';

const MAX_HISTORY_ENTRIES = 30;

export interface Shot {
  id: string;
  number: number;
  timeRange: string;
  shortDesc: string;
  originalText?: string;
  description: string;
  prompt: string;
  imageUrl?: string;
  videoUrl?: string;
  videoPrompt?: string;
  mediaType?: 'image' | 'video';
  videoModel?: VideoModel;
  videoDuration?: number;
  videoResolution?: VideoResolution;
  videoAspectRatio?: VideoAspectRatio;
  videoHasAudio?: boolean;
  isGenerating?: boolean;
  generatingStartTime?: number;
  generatingModel?: ImageModel;
  isGeneratingVideo?: boolean;
  generatingVideoStartTime?: number;
  generatingVideoModel?: VideoModel;
  audioUrl?: string;
  audioDuration?: number;
  audioName?: string;
}

export interface AudioTrack {
  id: string;
  name: string;
  url: string;
  duration: number;
}

export interface Reference {
  id: string;
  title: string;
  description: string;
  prompt: string;
  imageUrl?: string;
  isGenerating?: boolean;
  generatingStartTime?: number;
  generatingModel?: ImageModel;
}

export interface ScriptNote {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  isExpanded?: boolean;
}

export interface AppState {
  literalScript: string;
  shots: Shot[];
  references: Reference[];
  notes: ScriptNote[];
  
  // Project Audio Tracks
  audioTracks: AudioTrack[];
  addAudioTracks: (tracks: AudioTrack[]) => void;
  removeAudioTrack: (id: string) => void;
  reorderAudioTracks: (fromIndex: number, toIndex: number) => void;
  clearAudioTracks: () => void;
  updateShotAudio: (shotId: string, audioUrl: string, duration?: number, name?: string) => void;

  textModel: TextModel;
  setTextModel: (model: TextModel) => void;
  
  // History
  history: { literalScript: string; shots: Shot[]; references: Reference[]; notes?: ScriptNote[] }[];
  historyIndex: number;
  
  imageHistory: string[];
  addImageToHistory: (url: string) => void;
  
  generationStats: Record<string, { count: number, totalTime: number }>;
  recordGenerationTime: (model: string, timeSecs: number) => void;

  setLiteralScript: (text: string) => void;
  setShots: (shots: Shot[]) => void;
  addReference: (ref: Reference) => void;
  updateShot: (id: string, data: Partial<Shot>) => void;
  updateReference: (id: string, data: Partial<Reference>) => void;
  
  addNote: (note: ScriptNote) => void;
  updateNote: (id: string, data: Partial<ScriptNote>) => void;
  deleteNote: (id: string) => void;

  activeShotIndex: number;
  setActiveShotIndex: (index: number) => void;

  undo: () => void;
  redo: () => void;
  saveStateToHistory: () => void;
  
  parseAndLoadTxt: (content: string, preserveImages?: boolean) => void;
  exportToTxt: (includeImages?: boolean, includeSessionUrls?: boolean) => string;
}

export const useScriptStore = create<AppState>((set, get) => ({
  literalScript: '',
  shots: [],
  references: [],
  notes: [],
  audioTracks: [],
  imageHistory: [],
  activeShotIndex: 0,
  setActiveShotIndex: (index) => set({ activeShotIndex: index }),
  history: [{ literalScript: '', shots: [], references: [], notes: [] }],
  historyIndex: 0,

  addAudioTracks: (newTracks) => set((state) => ({
    audioTracks: [...state.audioTracks, ...newTracks]
  })),

  removeAudioTrack: (id) => set((state) => ({
    audioTracks: state.audioTracks.filter((t) => t.id !== id)
  })),

  reorderAudioTracks: (fromIndex, toIndex) => set((state) => {
    const copy = [...state.audioTracks];
    const [moved] = copy.splice(fromIndex, 1);
    if (moved) {
      copy.splice(toIndex, 0, moved);
    }
    return { audioTracks: copy };
  }),

  clearAudioTracks: () => set({ audioTracks: [] }),

  updateShotAudio: (shotId, audioUrl, duration, name) => {
    const { shots } = get();
    const newShots = shots.map((s) => 
      s.id === shotId ? { ...s, audioUrl, audioDuration: duration, audioName: name } : s
    );
    set({ shots: newShots });
  },
  
  textModel: 'gemini-1.5-flash',
  setTextModel: (model) => set({ textModel: model }),

  generationStats: {
    "gemini-flash": { count: 1, totalTime: 12 },
    "gemini-pro": { count: 1, totalTime: 22 },
    "meta-muse": { count: 1, totalTime: 20 },
    "gpt-5.4": { count: 1, totalTime: 120 }
  },

  recordGenerationTime: (model, timeSecs) => set((state) => {
    const current = state.generationStats[model] || { count: 0, totalTime: 0 };
    return {
      generationStats: {
        ...state.generationStats,
        [model]: {
          count: current.count + 1,
          totalTime: current.totalTime + timeSecs
        }
      }
    };
  }),

  addImageToHistory: (url) => {
    const { imageHistory } = get();
    if (!imageHistory.includes(url)) {
      set({ imageHistory: [url, ...imageHistory] });
    }
  },

  saveStateToHistory: () => {
    const { literalScript, shots, references, notes, history, historyIndex } = get();
    const currentState = { 
      literalScript, 
      shots: JSON.parse(JSON.stringify(shots)),
      references: JSON.parse(JSON.stringify(references)),
      notes: JSON.parse(JSON.stringify(notes || []))
    };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(currentState);
    // Preserve a bounded undo window. Dropping the oldest snapshot also keeps
    // the current index valid, avoiding unbounded memory growth while typing.
    const boundedHistory = newHistory.slice(-MAX_HISTORY_ENTRIES);
    set({ history: boundedHistory, historyIndex: boundedHistory.length - 1 });
  },

  setLiteralScript: (text) => {
    set({ literalScript: text });
    get().saveStateToHistory();
  },

  setShots: (shots) => {
    set({ shots });
    get().saveStateToHistory();
  },

  addReference: (ref) => {
    const { references } = get();
    set({ references: [...references, ref] });
    get().saveStateToHistory();
  },

  updateShot: (id, data) => {
    const { shots } = get();
    const newShots = shots.map((s) => (s.id === id ? { ...s, ...data } : s));
    set({ shots: newShots });
  },

  updateReference: (id, data) => {
    const { references } = get();
    const newRefs = references.map((r) => (r.id === id ? { ...r, ...data } : r));
    set({ references: newRefs });
  },

  addNote: (note) => {
    const { notes } = get();
    set({ notes: [note, ...(notes || [])] });
    get().saveStateToHistory();
  },

  updateNote: (id, data) => {
    const { notes } = get();
    const newNotes = (notes || []).map((n) => (n.id === id ? { ...n, ...data } : n));
    set({ notes: newNotes });
    get().saveStateToHistory();
  },

  deleteNote: (id) => {
    const { notes } = get();
    set({ notes: (notes || []).filter((n) => n.id !== id) });
    get().saveStateToHistory();
  },

  undo: () => {
    const { historyIndex, history } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const state = history[newIndex];
      set({ 
        literalScript: state.literalScript, 
        shots: state.shots, 
        references: state.references, 
        notes: state.notes || [],
        historyIndex: newIndex 
      });
    }
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const state = history[newIndex];
      set({ 
        literalScript: state.literalScript, 
        shots: state.shots, 
        references: state.references, 
        notes: state.notes || [],
        historyIndex: newIndex 
      });
    }
  },

  exportToTxt: (includeImages = true, includeSessionUrls = false) => {
    const { literalScript, shots, references, notes } = get();
    let txt = `[LITERAL]\n${literalScript}\n\n`;
    
    if (notes && notes.length > 0) {
      notes.forEach(n => {
        txt += `[NOTE]\n`;
        txt += `[TITLE] ${n.title}\n`;
        txt += `[CONTENT]\n${n.content}\n`;
        txt += `[/NOTE]\n\n`;
      });
    }

    references.forEach(r => {
      txt += `[REF]\n`;
      txt += `[TITLE] ${r.title}\n`;
      txt += `[DESC]\n${r.description}\n`;
      txt += `[PROMPT]\n${r.prompt}\n`;
      if (includeImages && r.imageUrl) {
        txt += `[IMAGE_URL]\n${r.imageUrl}\n`;
      }
      txt += `[/REF]\n\n`;
    });

    shots.forEach(s => {
      txt += `[PLANO ${s.number}]\n`;
      txt += `[TIME ${s.timeRange}]\n`;
      txt += `[SHORT_DESC ${s.shortDesc}]\n`;
      if (s.originalText) {
        txt += `[ORIGINAL_TEXT]\n${s.originalText}\n`;
      }
      txt += `[DESC]\n${s.description}\n`;
      txt += `[PROMPT]\n${s.prompt}\n`;
      if (includeImages && s.imageUrl) {
        txt += `[IMAGE_URL]\n${s.imageUrl}\n`;
      }
      if (s.videoPrompt) {
        txt += `[VIDEO_PROMPT]\n${s.videoPrompt}\n`;
      }
      if (includeImages && s.videoUrl && (includeSessionUrls || !s.videoUrl.startsWith('blob:'))) {
        txt += `[VIDEO_URL]\n${s.videoUrl}\n`;
      }
      if (s.audioUrl) {
        txt += `[AUDIO_URL]\n${s.audioUrl}\n`;
      }
      if (s.audioDuration) {
        txt += `[AUDIO_DURATION] ${s.audioDuration}\n`;
      }
      txt += `[MEDIA] ${s.mediaType || 'image'}\n`;
      txt += `\n`;
    });
    return txt;
  },

  parseAndLoadTxt: (rawContent: string, preserveImages = false) => {
    try {
      const previousState = get();
      // Clean markdown blocks in case ChatGPT wraps the response
      let content = rawContent.replace(/^```[\w]*\n?/g, '').replace(/\n?```$/g, '');
      content = content.trim();

      // Extract explicit [LITERAL] block if present
      const literalMatch = content.match(/\[LITERAL\]([\s\S]*?)(?=\n\s*\[(?:REF|NOTE|PLANO\s+\d+)\]|$)/i);

      // Extract all text that is outside tagged blocks:
      // Remove [REF]...[/REF], [NOTE]...[/NOTE], [PLANO X]...[MEDIA] (or up to next PLANO/end)
      const untaggedContent = content
        .replace(/\[REF\][\s\S]*?\[\/REF\]/gi, '')
        .replace(/\[NOTE\][\s\S]*?\[\/NOTE\]/gi, '')
        .replace(/\[PLANO\s+\d+\][\s\S]*?(?=\n\s*\[PLANO\s+\d+\]|$)/gi, '')
        .replace(/\[\/?LITERAL\]/gi, '')
        .trim();

      let literalScript = '';
      if (literalMatch && literalMatch[1].trim()) {
        literalScript = literalMatch[1].trim();
      } else if (untaggedContent) {
        literalScript = untaggedContent;
      } else if (preserveImages || (previousState.literalScript && previousState.literalScript.trim())) {
        literalScript = previousState.literalScript;
      }

      // Extract NOTES
      const notes: ScriptNote[] = [];
      const noteMatches = content.matchAll(/\[NOTE\]([\s\S]*?)\[\/NOTE\]/gi);
      let noteCount = 0;
      for (const match of noteMatches) {
        const noteContent = match[1];
        const titleMatch = noteContent.match(/\[TITLE\] (.*)/i);
        const contentMatch = noteContent.match(/\[CONTENT\]([\s\S]*?)$/i);
        notes.push({
          id: `note-${Date.now()}-${noteCount++}`,
          title: titleMatch ? titleMatch[1].trim() : 'Nota',
          content: contentMatch ? contentMatch[1].trim() : noteContent.trim(),
          createdAt: Date.now(),
          isExpanded: true,
        });
      }

      // Extract REFERENCES
      const references: Reference[] = [];
      const refMatches = content.matchAll(/\[REF\]([\s\S]*?)\[\/REF\]/gi);
      let refCount = 0;
      for (const match of refMatches) {
        const refContent = match[1];
        const titleMatch = refContent.match(/\[TITLE\] (.*)/i);
        const descMatch = refContent.match(/\[DESC\]([\s\S]*?)\[PROMPT\]/i);
        const promptMatch = refContent.match(/\[PROMPT\]([\s\S]*?)(?=\[IMAGE_URL\]|$)/i);
        const imgMatch = refContent.match(/\[IMAGE_URL\]([\s\S]*?)$/i);

        const title = titleMatch ? titleMatch[1].trim() : '';
        const previousReference = preserveImages
          ? previousState.references.find(r => r.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase())
          : undefined;

        references.push({
          id: `ref-${Date.now()}-${refCount++}`,
          title,
          description: descMatch ? descMatch[1].trim() : '',
          prompt: promptMatch ? promptMatch[1].trim() : '',
          imageUrl: imgMatch ? imgMatch[1].trim() : previousReference?.imageUrl,
        });
      }

      // Extract SHOTS
      const shots: Shot[] = [];
      const parts = content.split(/\[PLANO \d+\]/i);
      // parts[0] is everything before the first [PLANO X], which includes LITERAL and REFs.
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        
        const timeMatch = part.match(/\[TIME (.*?)\]/i);
        // Accept both supported LLM variants:
        // [SHORT_DESC Description] and [SHORT_DESC]\nDescription
        const inlineShortDescMatch = part.match(/\[SHORT_DESC\s+([^\]]+)\]/i);
        const blockShortDescMatch = part.match(/\[SHORT_DESC\]\s*\r?\n([^\r\n[]+)/i);
        const originalTextMatch = part.match(/\[ORIGINAL_TEXT\]([\s\S]*?)(?=\[(?:DESC|PROMPT|IMAGE_URL|VIDEO_PROMPT|VIDEO_URL|AUDIO_URL|AUDIO_DURATION|MEDIA)\]|$)/i);
        const descMatch = part.match(/\[DESC\]([\s\S]*?)\[PROMPT\]/i);
        const promptMatch = part.match(/\[PROMPT\]([\s\S]*?)(?=\[(?:IMAGE_URL|VIDEO_PROMPT|VIDEO_URL|MEDIA)\]|$)/i);
        const imageUrlMatch = part.match(/\[IMAGE_URL\]([\s\S]*?)(?=\n\[(?:VIDEO_PROMPT|VIDEO_URL|AUDIO_URL|AUDIO_DURATION|MEDIA)\]|\n\n|$)/i);
        const videoPromptMatch = part.match(/\[VIDEO_PROMPT\]([\s\S]*?)(?=\[(?:VIDEO_URL|AUDIO_URL|AUDIO_DURATION|MEDIA)\]|$)/i);
        const videoUrlMatch = part.match(/\[VIDEO_URL\]([\s\S]*?)(?=\n\[(?:AUDIO_URL|AUDIO_DURATION|MEDIA)\]|\n\n|$)/i);
        const audioUrlMatch = part.match(/\[AUDIO_URL\]([\s\S]*?)(?=\n\[(?:AUDIO_DURATION|MEDIA)\]|\n\n|$)/i);
        const audioDurationMatch = part.match(/\[AUDIO_DURATION\]\s*([\d.]+)/i);
        const mediaTypeMatch = part.match(/\[MEDIA\]\s*(image|video)/i);

        const previousShot = preserveImages
          ? previousState.shots.find(s => s.number === i)
          : undefined;

        shots.push({
          id: `shot-${Date.now()}-${i}`,
          number: i,
          timeRange: timeMatch ? timeMatch[1].trim() : '',
          shortDesc: (inlineShortDescMatch?.[1] || blockShortDescMatch?.[1] || '').trim(),
          originalText: (originalTextMatch?.[1] || previousShot?.originalText || '').trim(),
          description: descMatch ? descMatch[1].trim() : '',
          prompt: promptMatch ? promptMatch[1].trim() : '',
          imageUrl: imageUrlMatch ? imageUrlMatch[1].trim() : previousShot?.imageUrl,
          videoUrl: videoUrlMatch ? videoUrlMatch[1].trim() : previousShot?.videoUrl,
          videoPrompt: videoPromptMatch ? videoPromptMatch[1].trim() : previousShot?.videoPrompt,
          audioUrl: audioUrlMatch ? audioUrlMatch[1].trim() : previousShot?.audioUrl,
          audioDuration: audioDurationMatch ? Number(audioDurationMatch[1]) : previousShot?.audioDuration,
          audioName: previousShot?.audioName,
          mediaType: mediaTypeMatch?.[1].toLowerCase() === 'video'
            ? 'video'
            : previousShot?.mediaType || 'image',
          videoModel: previousShot?.videoModel,
          videoDuration: previousShot?.videoDuration,
          videoResolution: previousShot?.videoResolution,
          videoAspectRatio: previousShot?.videoAspectRatio,
          videoHasAudio: previousShot?.videoHasAudio,
        });
      }

      // If shots lack originalText but literalScript exists, distribute literalScript among shots
      const anyHasOriginalText = shots.some(s => s.originalText && s.originalText.trim().length > 0);
      if (!anyHasOriginalText && literalScript && shots.length > 0) {
        const sentences = literalScript
          .split(/(?<=[.?!¿?¡!;\n])\s+/)
          .map(s => s.trim())
          .filter(Boolean);
        if (sentences.length > 0) {
          const perShot = Math.max(1, Math.ceil(sentences.length / shots.length));
          shots.forEach((s, idx) => {
            const startIdx = idx * perShot;
            if (startIdx < sentences.length) {
              s.originalText = sentences.slice(startIdx, startIdx + perShot).join(' ');
            }
          });
        } else {
          shots[0].originalText = literalScript;
        }
      }

      set({ literalScript, shots, references, notes });
      get().saveStateToHistory();
      
      // Auto-populate imageHistory with existing images
      const allImages = [...references.map(r => r.imageUrl), ...shots.map(s => s.imageUrl)].filter(Boolean) as string[];
      allImages.forEach(url => get().addImageToHistory(url));
      
    } catch (e) {
      console.error("Error parsing txt", e);
    }
  }
}));
