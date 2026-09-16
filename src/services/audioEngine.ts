/**
 * Audio Engine for Plano a Plano Studio
 * Handles decoding, concatenation, slicing and WAV encoding using the browser Web Audio API.
 */

export interface ParsedTimeRange {
  start: number; // in seconds
  end: number;   // in seconds
  duration: number; // in seconds
}

/**
 * Parses timeRange strings such as "00:00 - 00:03", "01:15 - 01:22", "00:00.0 - 00:04.5".
 */
export function parseTimeRange(timeRange: string, defaultStart = 0, defaultDuration = 3): ParsedTimeRange {
  if (!timeRange || typeof timeRange !== 'string') {
    return {
      start: defaultStart,
      end: defaultStart + defaultDuration,
      duration: defaultDuration,
    };
  }

  // Matches mm:ss(.ms)? - mm:ss(.ms)? or hh:mm:ss - hh:mm:ss
  const match = timeRange.match(/(\d{1,2}):(\d{2}(?:\.\d+)?)(?:\s*-\s*(\d{1,2}):(\d{2}(?:\.\d+)?))?/);
  if (match && match[3] !== undefined && match[4] !== undefined) {
    const startSec = Number(match[1]) * 60 + Number(match[2]);
    const endSec = Number(match[3]) * 60 + Number(match[4]);
    const duration = Math.max(0.1, endSec - startSec);
    return {
      start: startSec,
      end: endSec,
      duration,
    };
  }

  return {
    start: defaultStart,
    end: defaultStart + defaultDuration,
    duration: defaultDuration,
  };
}

/**
 * Format seconds into mm:ss format (or mm:ss.s)
 */
export function formatSecondsToTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  if (ms > 0) {
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Creates or gets an AudioContext instance
 */
let sharedAudioContext: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioContext = new AudioCtx();
  }
  if (sharedAudioContext.state === 'suspended') {
    void sharedAudioContext.resume();
  }
  return sharedAudioContext;
}

/**
 * Decodes an audio ArrayBuffer / Blob / URL into an AudioBuffer
 */
export async function decodeAudioSource(source: Blob | string | ArrayBuffer): Promise<AudioBuffer> {
  const ctx = getAudioContext();
  let arrayBuffer: ArrayBuffer;

  if (typeof source === 'string') {
    const response = await fetch(source);
    arrayBuffer = await response.arrayBuffer();
  } else if (source instanceof Blob) {
    arrayBuffer = await source.arrayBuffer();
  } else {
    arrayBuffer = source;
  }

  // decodeAudioData consumes the arrayBuffer, so we slice a copy
  return await ctx.decodeAudioData(arrayBuffer.slice(0));
}

/**
 * Concatenates multiple AudioBuffers in sequence into one master AudioBuffer using OfflineAudioContext.
 * Automatically handles sample rate conversions and stereo/mono channels.
 */
export async function concatenateAudioBuffers(
  buffers: AudioBuffer[],
  targetSampleRate = 44100
): Promise<AudioBuffer> {
  if (buffers.length === 0) {
    throw new Error('No se han proporcionado pistas de audio para concatenar.');
  }

  if (buffers.length === 1 && buffers[0].sampleRate === targetSampleRate) {
    return buffers[0];
  }

  const totalDuration = buffers.reduce((acc, buf) => acc + buf.duration, 0);
  const totalLength = Math.max(1, Math.ceil(totalDuration * targetSampleRate));
  const numberOfChannels = 2; // Output clean stereo

  const offlineCtx = new OfflineAudioContext(numberOfChannels, totalLength, targetSampleRate);
  let currentTime = 0;

  for (const buffer of buffers) {
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(currentTime);
    currentTime += buffer.duration;
  }

  return await offlineCtx.startRendering();
}

/**
 * Slices an AudioBuffer from startTime to endTime (in seconds).
 */
export function sliceAudioBuffer(
  buffer: AudioBuffer,
  startTime: number,
  endTime: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const totalDuration = buffer.duration;

  // Clamp start and end
  const safeStart = Math.max(0, Math.min(startTime, totalDuration));
  const safeEnd = Math.max(safeStart + 0.05, Math.min(endTime, totalDuration));

  const startOffset = Math.floor(safeStart * sampleRate);
  const endOffset = Math.min(buffer.length, Math.ceil(safeEnd * sampleRate));
  const frameCount = Math.max(1, endOffset - startOffset);

  const ctx = getAudioContext();
  const slicedBuffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const channelData = buffer.getChannelData(c);
    const slicedData = slicedBuffer.getChannelData(c);
    for (let i = 0; i < frameCount; i++) {
      slicedData[i] = channelData[startOffset + i] || 0;
    }
  }

  return slicedBuffer;
}

/**
 * Converts an AudioBuffer to a standard 16-bit PCM WAV Blob
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numSamples = buffer.length;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF chunk
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // SubChunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat (1)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Write PCM 16-bit interleaved audio samples
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      // Clamp between -1.0 and 1.0
      if (sample < -1) sample = -1;
      else if (sample > 1) sample = 1;
      // Convert float to 16-bit signed integer
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

/**
 * Converts a Blob to a permanent Base64 Data URL so it can be reliably dragged or saved
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export interface ShotSliceResult {
  shotId: string;
  shotNumber: number;
  audioUrl: string;
  duration: number;
}

/**
 * Pipeline to slice project audio tracks for shots
 */
export async function sliceAudioTracksForShots(
  tracks: { id: string; url: string; name: string }[],
  shots: { id: string; number: number; timeRange: string }[],
  onProgress?: (current: number, total: number, message: string) => void
): Promise<ShotSliceResult[]> {
  if (tracks.length === 0) {
    throw new Error('No hay pistas de audio en el proyecto para cortar.');
  }
  if (shots.length === 0) {
    throw new Error('No hay planos en el guión para realizar el corte de audio.');
  }

  onProgress?.(0, shots.length, 'Decodificando pistas de audio...');

  // 1. Decode all tracks
  const decodedBuffers: AudioBuffer[] = [];
  for (let i = 0; i < tracks.length; i++) {
    onProgress?.(0, shots.length, `Decodificando pista ${i + 1} de ${tracks.length}: ${tracks[i].name}...`);
    const buffer = await decodeAudioSource(tracks[i].url);
    decodedBuffers.push(buffer);
  }

  // 2. Concatenate into master buffer
  onProgress?.(0, shots.length, 'Concatenando secuencia de audios...');
  const masterBuffer = await concatenateAudioBuffers(decodedBuffers);

  // 3. Slice for each shot
  const results: ShotSliceResult[] = [];
  let cumulativeTime = 0;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    onProgress?.(i + 1, shots.length, `Cortando audio para Plano ${shot.number}...`);

    let range = parseTimeRange(shot.timeRange, cumulativeTime, 3);
    if (range.start === cumulativeTime && range.end === cumulativeTime + 3 && !shot.timeRange) {
      cumulativeTime += 3;
    } else {
      cumulativeTime = range.end;
    }

    const slicedBuf = sliceAudioBuffer(masterBuffer, range.start, range.end);
    const wavBlob = audioBufferToWavBlob(slicedBuf);
    const audioUrl = await blobToDataUrl(wavBlob);

    results.push({
      shotId: shot.id,
      shotNumber: shot.number,
      audioUrl,
      duration: slicedBuf.duration,
    });
  }

  onProgress?.(shots.length, shots.length, '¡Corte de audios completado!');
  return results;
}
