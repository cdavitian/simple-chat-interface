import React, { useEffect, useState, useRef, useCallback } from "react";

/** ============ helpers ============ */

function normalizeMessage(m) {
  if (!m) return null;
  const text =
    m.text ??
    (Array.isArray(m.content) && m.content.find(x => x?.type === "text")?.text) ??
    (typeof m.content === "string" ? m.content : "") ??
    m.content?.[0]?.text ??
    "";

  return {
    id: m.id ?? `msg-${(globalThis.crypto?.randomUUID?.() ?? Date.now())}`,
    role: m.role || "assistant",
    text,
    content: [{ type: "text", text }],
    createdAt: m.createdAt ?? new Date().toISOString(),
  };
}

function mergeMessages(prev, incoming) {
  const map = new Map(prev.map(x => [x.id, x]));
  for (const raw of incoming || []) {
    const nm = normalizeMessage(raw);
    if (!nm) continue;
    map.set(nm.id, { ...(map.get(nm.id) || {}), ...nm });
  }
  return Array.from(map.values());
}

function formatRoleLabel(role) {
  if (role === "user") return "You";
  if (role === "assistant") return "Assistant";
  return role?.toString?.() ?? "system";
}

function formatTimestamp(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleString();
  } catch {
    return "";
  }
}

/** ============ main component ============ */

export default function ChatSDKClient() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [bootError, setBootError] = useState(null);
  const [sendError, setSendError] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);

  const messagesEndRef = useRef(null);

  // ===== DEBUG: global console API
  useEffect(() => {
    const pushOne = (m) => setMessages(prev => [...prev, normalizeMessage(m)]);
    globalThis.chatDebug = {
      push: (m) => pushOne(m),
      clear: () => setMessages([]),
      log: () => console.log("messages:", messages),
      len: () => console.log("len:", messages.length),
    };
    if (!document.getElementById("build-banner")) {
      const el = document.createElement("div");
      el.id = "build-banner";
      el.textContent = "LOCAL SDK CHAT • " + new Date().toISOString();
      el.style.cssText =
        "position:fixed;z-index:99999;top:0;left:0;padding:6px 10px;background:#222;color:#0f0;font:12px/1.2 monospace";
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }
    console.log("[chatDebug] ready");
  }, [messages]);

  // ===== autoscroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ===== initial session bootstrap
  useEffect(() => {
    let canceled = false;

    (async () => {
      try {
        // hit your existing session endpoint (must return 200 even if vector store linking fails)
        const r = await fetch("/api/chatkit/session", {
          method: "GET",
          credentials: "include",
        });
        if (!r.ok) {
          throw new Error(`Session bootstrap failed (${r.status})`);
        }
        const data = await r.json();
        // If your API returns any prior messages, normalize + replace.
        const initial = Array.isArray(data?.messages) ? data.messages : [];
        if (!canceled) {
          setMessages(initial.map(normalizeMessage));
          setSessionReady(true);
        }
      } catch (err) {
        console.error("bootstrap error:", err);
        if (!canceled) {
          setBootError(err.message || "Failed to init session");
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, []);

  const handleSend = useCallback(async () => {
    if (isSending) return;

    const text = (inputValue || "").trim();
    if (!text) return;

    const optimistic = normalizeMessage({
      id: `local-${Date.now()}`,
      role: "user",
      text,
    });

    setMessages(prev => mergeMessages(prev, [optimistic]));
    setIsSending(true);
    setSendError(null);

    try {
      const res = await fetch("/api/sdk/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Assistant request failed (${res.status})`);
      }

      const data = await res.json();

      const assistant = normalizeMessage({
        id: data?.message?.id ?? data?.responseId ?? `resp-${Date.now()}`,
        role: "assistant",
        text: data?.message?.text ?? data?.text ?? "",
        createdAt: data?.message?.createdAt,
      });

      setMessages(prev => mergeMessages(prev, [assistant]));
      setInputValue("");
    } catch (err) {
      console.error("send error:", err);
      setSendError(err.message || "Failed to send message");
      // roll back optimistic
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setIsSending(false);
    }
  }, [inputValue, isSending]);

  // ENTER to send
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="sdk-chat-root" style={styles.root}>
      <header style={styles.header}>
        <div style={styles.title}>Assistant</div>
        <div style={styles.status}>
          {bootError
            ? <span style={styles.bad}>Init error</span>
            : sessionReady ? <span style={styles.good}>Ready</span> : <span>Initializing…</span>}
        </div>
      </header>

      <ul style={styles.list}>
        {messages.map(m => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={messagesEndRef} />
      </ul>

      {sendError && <div style={styles.error}>⚠️ {sendError}</div>}

      <div style={styles.composer}>
        <textarea
          style={styles.textarea}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a message"
          rows={1}
        />
        <button onClick={handleSend} disabled={isSending || !inputValue.trim()} style={styles.send}>
          {isSending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

/** ============ presentational bits ============ */

function MessageBubble({ message }) {
  const mine = message.role === "user";
  return (
    <li style={{ ...styles.bubble, ...(mine ? styles.bubbleUser : styles.bubbleAssistant) }}>
      <div style={styles.meta}>
        <span style={styles.role}>{formatRoleLabel(message.role)}</span>
        <time style={styles.time}>{formatTimestamp(message.createdAt)}</time>
      </div>
      <div style={styles.text}>
        {String(message.text || "").split("\n").map((line, i) => (
          <p key={i} style={{ margin: 0 }}>{line}</p>
        ))}
      </div>
    </li>
  );
}

const styles = {
  root: { display: "grid", gridTemplateRows: "auto 1fr auto", height: "100vh", background: "#0b0c10" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", color: "#e9ecef", borderBottom: "1px solid #20232b" },
  title: { fontWeight: 600 },
  status: { fontSize: 12, opacity: 0.8 },
  good: { color: "#5ee27a" },
  bad: { color: "#ff6666" },

  list: { listStyle: "none", margin: 0, padding: "16px", overflowY: "auto", display: "grid", gap: 12 },
  bubble: { maxWidth: 720, padding: "10px 12px", borderRadius: 12, color: "#e9ecef", background: "#151823" },
  bubbleUser: { justifySelf: "end", background: "#1f2433" },
  bubbleAssistant: { justifySelf: "start", background: "#151823" },

  meta: { display: "flex", gap: 8, fontSize: 11, opacity: 0.75, marginBottom: 4 },
  role: { fontWeight: 600 },
  time: { opacity: 0.7 },
  text: { whiteSpace: "pre-wrap", wordBreak: "break-word" },

  composer: { display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: 12, borderTop: "1px solid #20232b", background: "#0b0c10" },
  textarea: { resize: "none", outline: "none", borderRadius: 10, border: "1px solid #232838", padding: "10px 12px", background: "#121520", color: "#e9ecef" },
  send: { border: "1px solid #2b3147", background: "#1c2030", color: "#e9ecef", borderRadius: 10, padding: "8px 14px", cursor: "pointer" },
};
