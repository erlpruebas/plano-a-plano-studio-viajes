import { getApiKey } from './apiKeys';

function requireApiKey(key: string | undefined, provider: "OpenRouter" | "Groq" | "Google") {
  if (!key) {
    throw new Error(`Falta la clave de ${provider}. Abre «Claves API» con el botón de llave y guárdala.`);
  }
  return key;
}

export type TextModel = 
  | "gemini-1.5-flash"
  | "gemini-3.8-flash"
  | "qwen/qwen3.8-27b"
  | "gemini-1.5-pro"
  | "gpt-4o"
  | "claude-3.5-sonnet"
  | "llama-3.1-70b"
  | "gpt-5.6-terra"
  | "gpt-5.6-sol"
  | "groq-qwen-reasoner"
  | "groq-llama-3.1-70b";

export const TEXT_MODELS: { id: TextModel; label: string }[] = [
  { id: "gemini-1.5-flash", label: "Google Gemini 1.5 Flash (Recomendado)" },
  { id: "gemini-3.8-flash", label: "Google Gemini 3.8 Flash (OpenRouter / Google)" },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (OpenRouter)" },
  { id: "gemini-1.5-pro", label: "Google Gemini Pro (Contexto largo)" },
  { id: "gpt-4o", label: "OpenAI GPT-4o (Preciso y fiable)" },
  { id: "claude-3.5-sonnet", label: "Anthropic Claude 3.5 Sonnet / Haiku" },
  { id: "llama-3.1-70b", label: "Meta Llama 3.3 70B (OpenRouter)" },
  { id: "gpt-5.6-terra", label: "OpenAI GPT-5.6 Terra (OpenRouter)" },
  { id: "gpt-5.6-sol", label: "OpenAI GPT-5.6 Sol (OpenRouter)" },
  { id: "groq-qwen-reasoner", label: "Qwen Reasoner (vía Groq)" },
  { id: "groq-llama-3.1-70b", label: "Meta Llama 3.3 70B (vía Groq)" },
];

const TEXT_MODEL_MAP: Record<TextModel, string> = {
  "gemini-1.5-flash": "google/gemini-2.5-flash",
  "gemini-3.8-flash": "google/gemini-2.5-flash",
  "qwen/qwen3.8-27b": "qwen/qwen3.8-27b",
  "gemini-1.5-pro": "google/gemini-2.5-pro",
  "gpt-4o": "openai/gpt-4o",
  "gpt-5.6-terra": "openai/gpt-5.6-terra",
  "gpt-5.6-sol": "openai/gpt-5.6-sol",
  "claude-3.5-sonnet": "anthropic/claude-3-haiku",
  "llama-3.1-70b": "meta-llama/llama-3.3-70b-instruct",
  "groq-qwen-reasoner": "qwen/qwen3.8-27b",
  "groq-llama-3.1-70b": "llama-3.3-70b-versatile"
};

const GROQ_OPENROUTER_FALLBACK_MAP: Partial<Record<TextModel, string>> = {
  "groq-qwen-reasoner": "qwen/qwen3.8-27b",
  "groq-llama-3.1-70b": "meta-llama/llama-3.3-70b-instruct",
};

type ChatCompletionBody = {
  messages: Array<{ role: "user"; content: string }>;
  response_format?: { type: "json_object" };
};

async function requestGoogleGeminiDirect(body: ChatCompletionBody) {
  if (!getApiKey('google')) throw new Error('Falta la clave de Google. Abre «Claves API» y guárdala.');
  const prompt = body.messages.map(m => m.content).join("\n\n");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getApiKey('google')}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: body.response_format?.type === "json_object" ? { responseMimeType: "application/json" } : undefined
    })
  });
  if (!response.ok) {
    throw new Error(`Google API ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return {
    choices: [{ message: { content: text } }]
  };
}

async function requestTextCompletion(model: TextModel, body: ChatCompletionBody) {
  const isGroq = model.startsWith("groq-");
  let groqFailure = "";

  if (isGroq && getApiKey('groq')) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${getApiKey('groq')}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: TEXT_MODEL_MAP[model], ...body })
      });

      if (response.ok) return response.json();
      groqFailure = `Groq ${response.status}: ${await response.text()}`;
    } catch (error) {
      groqFailure = `Groq no disponible: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const openRouterModel = isGroq ? GROQ_OPENROUTER_FALLBACK_MAP[model] : TEXT_MODEL_MAP[model];
  if (!openRouterModel) {
    throw new Error(groqFailure || `No hay un modelo configurado para ${model}.`);
  }

  if (groqFailure) console.warn(`${groqFailure}. Reintentando mediante OpenRouter.`);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${requireApiKey(getApiKey('openrouter'), "OpenRouter")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: openRouterModel, ...body })
    });

    if (response.ok) return await response.json();
    const detail = await response.text();
    
    // Si falla OpenRouter y es modelo Gemini, probar con la API oficial de Google si existe clave
    if (model.includes("gemini") && getApiKey('google')) {
      console.warn(`OpenRouter no disponible para Gemini (${detail}). Probando Google Gemini directo.`);
      return await requestGoogleGeminiDirect(body);
    }

    const prefix = groqFailure ? `${groqFailure}. Respaldo ` : "";
    throw new Error(`${prefix}OpenRouter ${response.status}: ${detail}`);
  } catch (err) {
    if (model.includes("gemini") && getApiKey('google')) {
      return await requestGoogleGeminiDirect(body);
    }
    throw err;
  }
}

export async function convertScriptToShots(literalScript: string, model: TextModel = "gemini-1.5-flash") {
  const prompt = `Convierte el siguiente guión literal en un guión técnico desglosado por planos. 

INSTRUCCIONES CLAVE Y OBLIGATORIAS:
1. DIVIDIR Y MANTENER EL TEXTO ORIGINAL: Divide TODO el guión literal continuo entre los planos según vayan ocurriendo. Cada plano DEBE contener la etiqueta [ORIGINAL_TEXT] con la frase, diálogo o fragmento exacto del guion original correspondiente a ese plano (lo que se narra, ocurre o se dice). No inventes ni omitas texto original.
2. CÓMO DEBERÍA DIBUJARSE EL PLANO: En la etiqueta [DESC] describe detalladamente cómo debería dibujarse visualmente la toma, movimientos de cámara, encuadres, composición e iluminación.
3. TIEMPO: Asigna una duración aproximada para cada plano en formato [TIME 00:00-00:05].
4. RESUMEN: Genera una descripción muy corta (3-7 palabras) en [SHORT_DESC ...].
5. PROMPT: Genera un prompt en inglés para generar la imagen de este plano en [PROMPT].
6. REFERENCIAS VISUALES: Antes de empezar los planos, extrae los espacios, personajes y objetos clave en bloques [REF]...[/REF].

Formato requerido de respuesta (devuelve solo texto en este formato, sin bloques de markdown \`\`\` ni explicaciones):

[LITERAL]
${literalScript}

[REF]
[TITLE] Nombre del lugar o personaje
[DESC] Descripción física muy detallada
[PROMPT] English prompt for image generation of this reference
[/REF]

[PLANO 1]
[TIME 00:00-00:05]
[SHORT_DESC Descripción corta]
[ORIGINAL_TEXT]
Fragmento exacto del texto original del guion correspondiente a este plano 1...
[DESC]
Descripción de cómo debería dibujarse visualmente el plano, cámara, ángulos y acción...
[PROMPT]
english prompt for image generation...

[PLANO 2]
[TIME 00:05-00:10]
[SHORT_DESC Descripción corta]
[ORIGINAL_TEXT]
Fragmento exacto del texto original del guion correspondiente al plano 2...
[DESC]
Descripción visual de cómo debería dibujarse este plano 2...
[PROMPT]
english prompt for image generation...

Guión literal a convertir:
${literalScript}`;

  try {
    const data = await requestTextCompletion(model, {
      messages: [{ role: "user", content: prompt }]
    });
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("El modelo no devolvió un guion técnico válido.");
    }

    // Some models ignore the requested [LITERAL] block. Never let conversion
    // erase the source script when the generated document is parsed.
    return /\[LITERAL\]/i.test(content)
      ? content
      : `[LITERAL]\n${literalScript}\n\n${content}`;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export async function askChatToModify(userMessage: string, currentContext: string, model: TextModel = "gemini-1.5-flash") {
  const prompt = `Eres el "cerebro" de una aplicación de guión técnico. El usuario quiere modificar el guión. 
Revisa el texto actual y modifícalo según las instrucciones del usuario.

Instrucción del usuario: "${userMessage}"

Contexto actual (en el formato especial):
${currentContext}

Devuelve SÓLO un objeto JSON válido con la siguiente estructura (no incluyas markdown \`\`\`json ni nada más, sólo el objeto parseable):
{
  "comentario": "Un breve mensaje amigable como asistente respondiendo a lo que has hecho.",
  "documento": "El texto COMPLETO modificado con todos los bloques [REF] y [PLANO X]. No omitas ninguna parte. Debe ser una cadena de texto (string) en el formato especial plano, NO un objeto ni array."
}`;

  try {
    const data = await requestTextCompletion(model, {
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }]
    });
    let content = data.choices[0].message.content;
    
    // Fallback safe JSON parse
    try {
      // Intenta limpiar markdown si existe
      content = content.replace(/```json/gi, '').replace(/```/g, '').trim();
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        // Fallback agresivo: buscar desde primer { o [ hasta último } o ]
        const match = content.match(/(?:\[|\{)[\s\S]*(?:\]|\})/);
        if (match) {
          parsed = JSON.parse(match[0]);
        } else {
          throw err;
        }
      }
      
      // Si el LLM devuelve un array por error, tomamos el primer elemento
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsed = parsed[0];
      }

      // Normalizar nombres de propiedades comunes entre diferentes LLMs
      if (parsed && typeof parsed === "object") {
        if (!parsed.documento && parsed.document) {
          parsed.documento = typeof parsed.document === "string" ? parsed.document : JSON.stringify(parsed.document);
        }
        if (!parsed.comentario && parsed.comment) {
          parsed.comentario = parsed.comment;
        }
      }

      return parsed;
    } catch (e) {
      console.error("Error parsing JSON:", content);
      throw e;
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export type ImageModel = "gpt-5.4" | "gemini-pro" | "gemini-flash" | "meta-muse";

export const IMAGE_MODELS: { id: ImageModel; label: string }[] = [
  { id: "gpt-5.4", label: "OpenAI GPT-5.4 Image (Máx calidad)" },
  { id: "gemini-pro", label: "Google Gemini 3 Pro Image" },
  { id: "gemini-flash", label: "Google Gemini 3.1 Flash Image (Rápido)" },
  { id: "meta-muse", label: "Meta Muse Image (Agéntico)" },
];

export async function generateImageUrl(prompt: string, model: ImageModel = "gpt-5.4") {
  const truncatedPrompt = prompt.length > 3500 ? prompt.substring(0, 3500) + "..." : prompt;
  
  const modelMap: Record<ImageModel, string> = {
    "gpt-5.4": "openai/gpt-5.4-image-2",
    "gemini-pro": "google/gemini-3-pro-image",
    "gemini-flash": "google/gemini-3.1-flash-image",
    "meta-muse": "meta/muse-image",
  };

  try {
    // Image models use OpenRouter's dedicated Images API. Its successful
    // response contains data[].b64_json (rather than chat.message.images).
    const response = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${requireApiKey(getApiKey('openrouter'), "OpenRouter")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: modelMap[model],
        prompt: `Generate a photorealistic cinematic image in 16:9 wide format (landscape orientation). The image should look like a film still from a movie. Scene description: ${truncatedPrompt}`,
        aspect_ratio: "16:9"
      })
    });
    
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`OpenRouter no pudo generar la imagen (${response.status}): ${detail}`);
    }
    
    const data: { data?: Array<{ b64_json?: string; media_type?: string; url?: string }> } = await response.json();
    const image = data.data?.[0];
    
    // The documented response is b64_json. Accept a URL too for forward
    // compatibility with providers that may return one.
    if (image?.url) {
      return image.url;
    }
    if (image?.b64_json) {
      return `data:${image.media_type || "image/png"};base64,${image.b64_json}`;
    }
    
    throw new Error("OpenRouter respondió correctamente, pero no incluyó datos de imagen.");
  } catch (error) {
    console.error(`Error al generar con ${model}:`, error);
    throw error;
  }
}

export type VideoModel = "grok-imagine" | "wan-3" | "hailuo-3-max" | "seedance-2-fast" | "minimax-h3";
export type VideoResolution = "480p" | "720p" | "768p" | "1080p" | "2K";
export type VideoAspectRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16" | "9:21" | "3:2" | "2:3";

export type VideoModelConfig = {
  id: VideoModel;
  apiModel: string;
  label: string;
  description: string;
  durations: readonly number[];
  resolutions: readonly VideoResolution[];
  aspectRatios: readonly VideoAspectRatio[];
  supportsAudio: boolean;
  audioManagedByProvider?: boolean;
  defaultDuration: number;
  defaultResolution: VideoResolution;
  defaultAspectRatio: VideoAspectRatio;
  pricePerSecond?: Partial<Record<VideoResolution, number>>;
  audioPricePerSecond?: Partial<Record<VideoResolution, number>>;
  imageInputPrice?: number;
  pricingNote?: string;
};

const secondsRange = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => start + index);

export const VIDEO_MODELS: readonly VideoModelConfig[] = [
  {
    id: "grok-imagine",
    apiModel: "x-ai/grok-imagine-video",
    label: "Grok Imagine Video (ultrarrápido)",
    description: "Desde 1 s y 480p. La opción más pequeña para bocetos y pruebas.",
    durations: secondsRange(1, 15),
    resolutions: ["480p", "720p"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"],
    supportsAudio: false,
    audioManagedByProvider: true,
    defaultDuration: 1,
    defaultResolution: "480p",
    defaultAspectRatio: "16:9",
    pricePerSecond: { "480p": 0.05, "720p": 0.07 },
    imageInputPrice: 0.002,
  },
  {
    id: "wan-3",
    apiModel: "alibaba/wan-3.0",
    label: "Wan 3.0 (económico + audio)",
    description: "Desde 2 s y 480p, con audio opcional y buena flexibilidad.",
    durations: secondsRange(2, 30),
    resolutions: ["480p", "720p", "1080p"],
    aspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16"],
    supportsAudio: true,
    defaultDuration: 2,
    defaultResolution: "480p",
    defaultAspectRatio: "16:9",
    pricePerSecond: { "480p": 0.05, "720p": 0.10, "1080p": 0.20 },
  },
  {
    id: "hailuo-3-max",
    apiModel: "minimax/hailuo-3-max",
    label: "MiniMax H3 Max (480p sin audio)",
    description: "Versión Hailuo ligera a 480p o 768p, desde 5 segundos.",
    durations: secondsRange(5, 15),
    resolutions: ["480p", "768p"],
    aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    supportsAudio: false,
    defaultDuration: 5,
    defaultResolution: "480p",
    defaultAspectRatio: "16:9",
    pricePerSecond: { "480p": 0.05, "768p": 0.08 },
  },
  {
    id: "seedance-2-fast",
    apiModel: "bytedance/seedance-2.0-fast",
    label: "Seedance 2.0 Fast (480p + audio)",
    description: "Modelo rápido multimodal, desde 4 s, 480p o 720p.",
    durations: secondsRange(4, 15),
    resolutions: ["480p", "720p"],
    aspectRatios: ["1:1", "3:4", "9:16", "4:3", "16:9", "21:9", "9:21"],
    supportsAudio: true,
    defaultDuration: 4,
    defaultResolution: "480p",
    defaultAspectRatio: "16:9",
    pricingNote: "OpenRouter factura este modelo por tokens de vídeo.",
  },
  {
    id: "minimax-h3",
    apiModel: "minimax/hailuo-3",
    label: "MiniMax H3 (máxima calidad)",
    description: "2K con audio, desde 5 segundos. Más lento y costoso.",
    durations: secondsRange(5, 15),
    resolutions: ["2K"],
    aspectRatios: ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"],
    supportsAudio: true,
    defaultDuration: 5,
    defaultResolution: "2K",
    defaultAspectRatio: "16:9",
    pricePerSecond: { "2K": 0.13 },
  },
];

export function getVideoModelConfig(model: VideoModel) {
  const config = VIDEO_MODELS.find(candidate => candidate.id === model);
  if (!config) throw new Error(`No hay configuración para el modelo de vídeo ${model}.`);
  return config;
}

export function estimateVideoCost({
  model,
  duration,
  resolution,
  generateAudio,
  imageCount,
}: {
  model: VideoModel;
  duration: number;
  resolution: VideoResolution;
  generateAudio: boolean;
  imageCount: number;
}) {
  const config = getVideoModelConfig(model);
  const rate = generateAudio
    ? config.audioPricePerSecond?.[resolution] ?? config.pricePerSecond?.[resolution]
    : config.pricePerSecond?.[resolution];
  if (rate === undefined) return null;
  return duration * rate + imageCount * (config.imageInputPrice || 0);
}

type VideoJob = {
  id: string;
  polling_url?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled" | "expired";
  unsigned_urls?: string[];
  error?: string;
};

const OPENROUTER_ORIGIN = "https://openrouter.ai";

async function readVideoJob(response: Response) {
  if (!response.ok) {
    throw new Error(`OpenRouter no pudo procesar el vídeo (${response.status}): ${await response.text()}`);
  }
  return response.json() as Promise<VideoJob>;
}

export async function generateVideoUrl({
  prompt,
  sourceImageUrl,
  referenceImageUrls,
  model = "grok-imagine",
  duration,
  resolution,
  aspectRatio,
  generateAudio = false,
}: {
  prompt: string;
  sourceImageUrl?: string;
  referenceImageUrls: string[];
  model?: VideoModel;
  duration?: number;
  resolution?: VideoResolution;
  aspectRatio?: VideoAspectRatio;
  generateAudio?: boolean;
}) {
  const apiKey = requireApiKey(getApiKey('openrouter'), "OpenRouter");
  const config = getVideoModelConfig(model);
  const activeDuration = duration ?? config.defaultDuration;
  const activeResolution = resolution ?? config.defaultResolution;
  const activeAspectRatio = aspectRatio ?? config.defaultAspectRatio;
  if (!config.durations.includes(activeDuration)) {
    throw new Error(`${config.label} no admite una duración de ${activeDuration} segundos.`);
  }
  if (!config.resolutions.includes(activeResolution)) {
    throw new Error(`${config.label} no admite la resolución ${activeResolution}.`);
  }
  if (!config.aspectRatios.includes(activeAspectRatio)) {
    throw new Error(`${config.label} no admite el formato ${activeAspectRatio}.`);
  }

  const references = [...new Set(referenceImageUrls.filter(url => url && url !== sourceImageUrl))].slice(0, 4);
  const body: Record<string, unknown> = {
    model: config.apiModel,
    prompt: prompt.slice(0, 5000),
    duration: activeDuration,
    resolution: activeResolution,
    aspect_ratio: activeAspectRatio,
  };

  if (!config.audioManagedByProvider) {
    body.generate_audio = config.supportsAudio && generateAudio;
  }

  if (sourceImageUrl) {
    body.frame_images = [{
      type: "image_url",
      image_url: { url: sourceImageUrl },
      frame_type: "first_frame",
    }];
  }
  if (references.length > 0) {
    body.input_references = references.map(url => ({
      type: "image_url",
      image_url: { url },
    }));
  }

  let job = await readVideoJob(await fetch(`${OPENROUTER_ORIGIN}/api/v1/videos`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (job.status === "completed") break;
    if (["failed", "cancelled", "expired"].includes(job.status)) {
      throw new Error(job.error || `La generación de vídeo terminó con estado ${job.status}.`);
    }

    await new Promise(resolve => setTimeout(resolve, 15_000));
    const pollingUrl = new URL(job.polling_url || `/api/v1/videos/${job.id}`, OPENROUTER_ORIGIN);
    if (pollingUrl.origin !== OPENROUTER_ORIGIN) {
      throw new Error("OpenRouter devolvió una URL de seguimiento no válida.");
    }
    job = await readVideoJob(await fetch(pollingUrl, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    }));
  }

  if (job.status !== "completed") {
    throw new Error("La generación de vídeo superó el tiempo máximo de espera.");
  }

  const resultUrl = job.unsigned_urls?.[0]
    || `${OPENROUTER_ORIGIN}/api/v1/videos/${job.id}/content?index=0`;
  const parsedResultUrl = new URL(resultUrl, OPENROUTER_ORIGIN);

  if (parsedResultUrl.origin !== OPENROUTER_ORIGIN) return parsedResultUrl.toString();

  const videoResponse = await fetch(parsedResultUrl, {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (!videoResponse.ok) {
    throw new Error(`No se pudo descargar el vídeo terminado (${videoResponse.status}).`);
  }
  return URL.createObjectURL(await videoResponse.blob());
}
