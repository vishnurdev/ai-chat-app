// Zeeva – frontend (no framework, no build step)
import { renderMarkdown, escapeHtml } from "./markdown.js";

// ✏️ Change your app name here – it updates the sidebar, page title and placeholder.
const APP_NAME = "Zeeva";

const $ = (id) => document.getElementById(id);
const els = {
  chat: $("chat"), empty: $("empty"), form: $("composer"), input: $("input"),
  send: $("send"), stop: $("stop"), model: $("model"), persona: $("persona"),
  newChat: $("newChat"), history: $("history"), title: $("chatTitle"), theme: $("theme"),
  sidebar: $("sidebar"), backdrop: $("backdrop"), openSide: $("openSide"), closeSide: $("closeSide"),
};

const STORE_KEY = "zeeva:v1";
const THEME_KEY = "zeeva:theme";
const state = { chats: [], activeId: null, controller: null };

// ---------- storage (best effort: private windows may block it) ----------
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      chats: state.chats.slice(0, 50), activeId: state.activeId,
      model: els.model.value, persona: els.persona.value,
    }));
  } catch { /* ignore */ }
}
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}

// ---------- chats ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const active = () => state.chats.find((c) => c.id === state.activeId) || null;
const messages = () => active()?.messages ?? [];

function titleFrom(text) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 40 ? t.slice(0, 40) + "…" : t;
}

function startNewChat() {
  if (state.controller) state.controller.abort();
  state.activeId = null; // created when the first message is sent
  save();
  renderAll();
  closeSidebar();
  els.input.focus();
}

function openChat(id) {
  if (state.controller) return;
  state.activeId = id;
  save();
  renderAll();
  closeSidebar();
}

function deleteChat(id) {
  if (state.controller && id === state.activeId) state.controller.abort();
  state.chats = state.chats.filter((c) => c.id !== id);
  if (state.activeId === id) state.activeId = null;
  save();
  renderAll();
}

// ---------- rendering ----------
function addCopyButtons(bubble) {
  bubble.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".copy-code")) return;
    const btn = document.createElement("button");
    btn.className = "copy-code";
    btn.type = "button";
    btn.textContent = "Copy";
    btn.onclick = () => copy(pre.querySelector("code")?.innerText ?? pre.innerText, btn);
    pre.appendChild(btn);
  });
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = old), 1200);
  } catch { /* clipboard unavailable */ }
}

function messageEl(role, content, { error = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble" + (error ? " error" : "");

  if (role === "user") {
    bubble.textContent = content;
    wrap.appendChild(bubble);
    return { wrap, bubble, body: wrap };
  }

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.innerHTML = '<img src="/logo.png" alt="">';
  const body = document.createElement("div");
  body.className = "assistant-body";
  if (error) bubble.textContent = content;
  else { bubble.innerHTML = renderMarkdown(content); addCopyButtons(bubble); }
  body.appendChild(bubble);
  wrap.append(avatar, body);
  return { wrap, bubble, body };
}

function addActions(body, getText) {
  const bar = document.createElement("div");
  bar.className = "actions";
  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy";
  copyBtn.onclick = () => copy(getText(), copyBtn);
  const regen = document.createElement("button");
  regen.textContent = "Regenerate";
  regen.onclick = regenerate;
  bar.append(copyBtn, regen);
  body.appendChild(bar);
}

function thread() {
  let t = els.chat.querySelector(".thread");
  if (!t) {
    t = document.createElement("div");
    t.className = "thread";
    els.chat.appendChild(t);
  }
  return t;
}

function renderHistory() {
  els.history.innerHTML = "";
  if (!state.chats.length) return;
  const label = document.createElement("div");
  label.className = "history-label";
  label.textContent = "Recent";
  els.history.appendChild(label);

  for (const c of state.chats) {
    const item = document.createElement("div");
    item.className = "conv" + (c.id === state.activeId ? " active" : "");
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    item.innerHTML = `<span class="conv-title">${escapeHtml(c.title)}</span>`;
    const del = document.createElement("button");
    del.className = "conv-del";
    del.title = "Delete chat";
    del.setAttribute("aria-label", "Delete chat");
    del.textContent = "🗑";
    del.onclick = (e) => { e.stopPropagation(); deleteChat(c.id); };
    item.appendChild(del);
    item.onclick = () => openChat(c.id);
    item.onkeydown = (e) => { if (e.key === "Enter") openChat(c.id); };
    els.history.appendChild(item);
  }
}

function renderAll() {
  const msgs = messages();
  thread().innerHTML = "";
  els.empty.hidden = msgs.length > 0;
  els.title.textContent = active()?.title || "New chat";

  msgs.forEach((m, i) => {
    const { wrap, body } = messageEl(m.role, m.content);
    if (m.role === "assistant" && i === msgs.length - 1) addActions(body, () => m.content);
    thread().appendChild(wrap);
  });
  renderHistory();
  scrollDown();
}

function scrollDown() { els.chat.scrollTop = els.chat.scrollHeight; }

function setBusy(busy) {
  els.send.hidden = busy;
  els.stop.hidden = !busy;
  els.input.disabled = busy;
  els.model.disabled = busy;
  els.persona.disabled = busy;
}

function autoGrow() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 200) + "px";
}

// ---------- theme ----------
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
}

// ---------- mobile sidebar ----------
function openSidebar() { els.sidebar.classList.add("open"); els.backdrop.hidden = false; }
function closeSidebar() { els.sidebar.classList.remove("open"); els.backdrop.hidden = true; }

// ---------- talking to the API ----------
async function streamReply() {
  const chat = active();
  if (!chat) return;
  els.empty.hidden = true;
  const { wrap, bubble } = messageEl("assistant", "");
  bubble.classList.add("typing");
  thread().appendChild(wrap);
  scrollDown();

  state.controller = new AbortController();
  setBusy(true);
  let reply = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: els.model.value,
        persona: els.persona.value,
        messages: chat.messages.slice(-30),
      }),
      signal: state.controller.signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      reply += decoder.decode(value, { stream: true });
      bubble.innerHTML = renderMarkdown(reply);
      scrollDown();
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      // drop the unanswered message so retries don't stack duplicates
      if (chat.messages.at(-1)?.role === "user") els.input.value = chat.messages.pop().content;
      if (!chat.messages.length) state.chats = state.chats.filter((c) => c !== chat);
      save();
      renderAll();
      els.empty.hidden = true;
      thread().appendChild(messageEl("assistant", `⚠️ ${err.message}`, { error: true }).wrap);
      autoGrow();
      scrollDown();
    }
  } finally {
    bubble.classList.remove("typing");
    setBusy(false);
    state.controller = null;
    if (reply.trim()) {
      chat.messages.push({ role: "assistant", content: reply });
      save();
      renderAll();
    }
    els.input.focus();
  }
}

function sendMessage(text) {
  text = text.trim();
  if (!text || state.controller) return;
  let chat = active();
  if (!chat) {
    chat = { id: uid(), title: titleFrom(text), messages: [] };
    state.chats.unshift(chat);
    state.activeId = chat.id;
  } else {
    // move the chat to the top of the history
    state.chats = [chat, ...state.chats.filter((c) => c !== chat)];
  }
  chat.messages.push({ role: "user", content: text });
  els.input.value = "";
  autoGrow();
  save();
  renderAll();
  streamReply();
}

function regenerate() {
  const chat = active();
  if (state.controller || !chat) return;
  if (chat.messages.at(-1)?.role === "assistant") chat.messages.pop();
  if (!chat.messages.length) return;
  renderAll();
  streamReply();
}

// ---------- setup ----------
async function loadOptions() {
  const fallback = {
    models: [{ id: "openai/gpt-oss-120b", label: "GPT-OSS 120B (smart)" }],
    personas: [{ id: "assistant", label: "General assistant" }],
  };
  const opts = await fetch("/api/chat").then((r) => (r.ok ? r.json() : fallback)).catch(() => fallback);
  els.model.innerHTML = opts.models.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.label)}</option>`).join("");
  els.persona.innerHTML = opts.personas.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join("");
}

async function init() {
  document.title = APP_NAME;
  document.querySelector(".brand-name").textContent = APP_NAME;
  els.input.placeholder = `Message ${APP_NAME}…`;

  await loadOptions();
  const saved = load();
  if (saved.model && [...els.model.options].some((o) => o.value === saved.model)) els.model.value = saved.model;
  if (saved.persona && [...els.persona.options].some((o) => o.value === saved.persona)) els.persona.value = saved.persona;
  state.chats = Array.isArray(saved.chats) ? saved.chats.filter((c) => c && Array.isArray(c.messages)) : [];
  state.activeId = state.chats.some((c) => c.id === saved.activeId) ? saved.activeId : null;
  renderAll();

  els.form.addEventListener("submit", (e) => { e.preventDefault(); sendMessage(els.input.value); });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(els.input.value); }
  });
  els.input.addEventListener("input", autoGrow);
  els.stop.addEventListener("click", () => state.controller?.abort());
  els.newChat.addEventListener("click", startNewChat);
  els.model.addEventListener("change", save);
  els.persona.addEventListener("change", save);
  els.theme.addEventListener("click", () =>
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  els.openSide.addEventListener("click", openSidebar);
  els.closeSide.addEventListener("click", closeSidebar);
  els.backdrop.addEventListener("click", closeSidebar);
  document.querySelectorAll(".chip").forEach((chip) =>
    chip.addEventListener("click", () => sendMessage(`${chip.querySelector("b").textContent}: ${chip.querySelector("span").textContent}`)));
  els.input.focus();
}

init();
