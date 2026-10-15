"use client";
import { useRef, useState } from "react";
import axios from "axios";

interface Message {
  role: "user" | "assistant";
  text: string;
  meta?: { hops: number; chunks: number; facts: number; strategy: string };
}

const SUGGESTIONS = [
  "What is Self-Attention?",
  "How does Graph RAG differ from plain RAG?",
  "What company built ChatGPT?",
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = async (question: string) => {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setLoading(true);
    try {
      const { data } = await axios.post("/api/query", { question: q });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.answer,
          meta: { hops: data.hops, chunks: data.chunks_used, facts: data.graph_facts_used, strategy: data.strategy },
        },
      ]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: e?.response?.data?.detail || "Pipeline error. Is the backend running?" },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  return (
    <aside style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Ask the Graph</span>
        <span style={styles.agentBadge}>Synthesizer Agent</span>
      </div>

      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.suggestions}>
            <p style={styles.suggestLabel}>Try asking:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} style={styles.chip} onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={m.role === "user" ? styles.userMsg : styles.assistantMsg}>
            <div style={styles.msgRole}>{m.role === "user" ? "You" : "AI"}</div>
            <div style={styles.msgText}>{m.text}</div>
            {m.meta && (
              <div style={styles.meta}>
                <span>Strategy: <b>{m.meta.strategy}</b></span>
                <span>{m.meta.hops} hop{m.meta.hops !== 1 ? "s" : ""}</span>
                <span>{m.meta.chunks} chunks</span>
                <span>{m.meta.facts} graph facts</span>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={styles.assistantMsg}>
            <div style={styles.msgRole}>AI</div>
            <div style={{ ...styles.msgText, color: "var(--muted)" }}>Thinking…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputRow}>
        <textarea
          style={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(input); }}
          placeholder="Ask a question… (Ctrl+Enter to send)"
          rows={2}
          disabled={loading}
        />
        <button style={styles.sendBtn} onClick={() => send(input)} disabled={loading || !input.trim()}>
          {loading ? "…" : "→"}
        </button>
      </div>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 320,
    minWidth: 260,
    background: "var(--panel)",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  title: { fontWeight: 600, fontSize: "0.95rem" },
  agentBadge: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: "0.68rem",
    color: "var(--amber)",
    background: "#241d0e",
    border: "1px solid #4a3a15",
    borderRadius: 20,
    padding: "2px 8px",
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  suggestions: { display: "flex", flexDirection: "column", gap: 8, marginTop: 8 },
  suggestLabel: { fontSize: "0.75rem", color: "var(--muted)" },
  chip: {
    background: "transparent",
    border: "1px solid var(--border)",
    borderRadius: 20,
    padding: "6px 12px",
    fontSize: "0.78rem",
    color: "var(--muted)",
    textAlign: "left",
    transition: "color 0.15s, border-color 0.15s",
  },
  userMsg: {
    background: "#0f1a2a",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 12px",
  },
  assistantMsg: {
    background: "#0f231f",
    border: "1px solid var(--teal-dim)",
    borderRadius: 8,
    padding: "10px 12px",
  },
  msgRole: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: "0.68rem",
    color: "var(--muted)",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  msgText: { fontSize: "0.88rem", lineHeight: 1.6, whiteSpace: "pre-wrap" },
  meta: {
    display: "flex",
    gap: 10,
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid var(--border)",
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: "0.68rem",
    color: "var(--muted)",
    flexWrap: "wrap",
  },
  inputRow: {
    display: "flex",
    gap: 8,
    padding: "12px 14px",
    borderTop: "1px solid var(--border)",
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    background: "#0d131b",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    padding: "8px 10px",
    fontSize: "0.88rem",
    resize: "none",
    lineHeight: 1.5,
  },
  sendBtn: {
    background: "var(--teal)",
    color: "#06110f",
    border: "none",
    borderRadius: 8,
    width: 40,
    fontWeight: 700,
    fontSize: "1.1rem",
    flexShrink: 0,
    alignSelf: "flex-end",
    height: 40,
  },
};
