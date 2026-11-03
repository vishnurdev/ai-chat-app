// Vercel Edge Function: POST /api/chat  -> streams the AI reply as plain text
//                       GET  /api/chat  -> returns available models and personas
// Your Groq API key stays on the server (GROQ_API_KEY env var) and is never sent to the browser.

export const config = { runtime: "edge" };

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";

// Fallback list – used only if the live list from Groq can't be loaded.
export const MODELS = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (smart)" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B (fast)" },
];

export const PERSONAS = {
  assistant: {
    label: "General assistant",
    prompt: "You are a helpful, friendly assistant. Give clear, accurate, well-structured answers. Use Markdown when it helps.",
  },
  coder: {
    label: "Code helper",
    prompt: "You are a senior software engineer. Give correct, working code with short explanations. Always use fenced code blocks with a language tag.",
  },
  writer: {
    label: "Writing assistant",
    prompt: "You are a professional editor and copywriter. Help write and improve emails, posts and documents. Keep the user's voice; be concise.",
  },
  eli5: {
    label: "Explain simply",
    prompt: "Explain things in simple words a beginner understands, using short sentences and everyday examples. Avoid jargon.",
  },
};

const LIMITS = { messages: 30, chars: 4000 };

// Models that aren't chat models (speech, safety classifiers, etc.)
const NON_CHAT = /whisper|tts|playai|guard|prompt-guard|safeguard|orpheus|distil|compound/i;

function prettyName(id) {
  return id
    .split("/").pop()
    .replace(/-/g, " ")
    .replace(/\b(\w)/g, (c) => c.toUpperCase())
    .replace(/\bGpt\b/g, "GPT").replace(/\bOss\b/g, "OSS").replace(/(\d+)b\b/gi, "$1B");
}

let modelCache = { at: 0, list: null };

/** Live list of chat models this API key can use (cached 10 min). Falls back to MODELS. */
export async function getModels(apiKey, { force = false } = {}) {
  if (!apiKey) return MODELS;
  if (!force && modelCache.list && Date.now() - modelCache.at < 10 * 60 * 1000) return modelCache.list;
  try {
    const res = await fetch(GROQ_MODELS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) throw new Error(String(res.status));
    const { data = [] } = await res.json();
    const list = data
      .filter((m) => m.active !== false && !NON_CHAT.test(m.id))
      .map((m) => ({ id: m.id, label: prettyName(m.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!list.length) throw new Error("empty");
    modelCache = { at: Date.now(), list };
    return list;
  } catch {
    return MODELS;
  }
}

export function resetModelCache() { modelCache = { at: 0, list: null }; }

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Validate the request body. Returns { error } or { model, persona, messages }. */
export function validate(body, models = MODELS) {
  if (!body || typeof body !== "object") return { error: "Invalid JSON body." };
  const { model, persona = "assistant", messages } = body;

  if (!models.some((m) => m.id === model)) return { error: "Unknown model." };
  if (!PERSONAS[persona]) return { error: "Unknown persona." };
  if (!Array.isArray(messages) || messages.length === 0) return { error: "No messages sent." };
  if (messages.length > LIMITS.messages) return { error: `Too many messages (max ${LIMITS.messages}). Start a new chat.` };

  for (const m of messages) {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string") {
      return { error: "Each message needs a role (user/assistant) and text content." };
    }
    if (m.content.length > LIMITS.chars) return { error: `A message is too long (max ${LIMITS.chars} characters).` };
  }
  if (messages[messages.length - 1].role !== "user") return { error: "The last message must be from the user." };

  return {
    model,
    persona,
    messages: messages.map(({ role, content }) => ({ role, content })),
  };
}

/** Turns Groq's server-sent events into a plain stream of reply text. */
export function sseToText() {
  let buffer = "";
  const handle = (line, controller) => {
    line = line.trim();
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    try {
      const text = JSON.parse(data).choices?.[0]?.delta?.content;
      if (text) controller.enqueue(text);
    } catch {
      /* ignore keep-alive / partial lines */
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) handle(line, controller);
    },
    flush(controller) {
      if (buffer) handle(buffer, controller);
    },
  });
}

export default async function handler(req) {
  if (req.method === "GET") {
    return json({
      models: await getModels(process.env.GROQ_API_KEY),
      personas: Object.entries(PERSONAS).map(([id, p]) => ({ id, label: p.label })),
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return json({ error: "Server is missing GROQ_API_KEY." }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const input = validate(body, await getModels(apiKey));
  if (input.error) return json({ error: input.error }, 400);

  const upstream = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "system", content: PERSONAS[input.persona].prompt }, ...input.messages],
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    let message = `AI service error (${upstream.status}).`;
    try {
      message = (await upstream.json()).error?.message || message;
    } catch {
      /* keep default */
    }
    if (upstream.status === 404 || /does not exist|do not have access/i.test(message)) {
      resetModelCache();
      message = "This model isn't available for your API key. Please pick another model.";
    }
    if (upstream.status === 429) message = "Rate limit reached. Please wait a moment and try again.";
    return json({ error: message }, upstream.status === 429 ? 429 : 502);
  }

  const stream = upstream.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(sseToText())
    .pipeThrough(new TextEncoderStream());

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
