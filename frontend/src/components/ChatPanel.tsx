"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import axios from "axios";
import { toast } from "./Toast";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: { hops: number; chunks: number; facts: number; strategy: string };
  error?: boolean;
  ts: number;
}

const SUGGESTIONS = [
  "What is Self-Attention?",
  "How does Graph RAG differ from plain RAG?",
  "What company built ChatGPT?",
  "How are multi-agent systems used in RAG?",
  "What is Few-Shot Prompting?",
];

const STRATEGY_COLORS: Record<string, string> = {
  hybrid: "var(--teal)",
  graph:  "var(--blue)",
  text:   "var(--purple)",
};

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 0" }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: "50%", background: "var(--teal)",
          animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
          display: "inline-block",
        }} />
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard not available */ }
  };
  return (
    <button onClick={copy} style={{ background: "none", color: copied ? "var(--teal)" : "var(--muted)", fontSize: "0.7rem", padding: "2px 6px", borderRadius: "var(--radius-sm)", border: "1px solid transparent", transition: "all var(--transition)" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.color = "var(--text2)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = copied ? "var(--teal)" : "var(--muted)"; }}>
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    axios.get("/api/health").then(({ data }) => {
      setBackendReady(data.status === "ok");
    }).catch(() => setBackendReady(false));
  }, []);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const send = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    if (q.length < 3) { toast("Question too short — minimum 3 characters", "warning"); return; }
    if (q.length > 500) { toast("Question too long — maximum 500 characters", "warning"); return; }

    setInput("");
    const userMsg: Message = { id: Math.random().toString(36).slice(2), role: "user", text: q, ts: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    scrollToBottom();

    try {
      const { data } = await axios.post("/api/query", { question: q });
      const aiMsg: Message = {
        id: Math.random().toString(36).slice(2),
        role: "assistant",
        text: data.answer,
        meta: { hops: data.hops, chunks: data.chunks_used, facts: data.graph_facts_used, strategy: data.strategy },
        ts: Date.now(),
      };
      setMessages(prev => [...prev, aiMsg]);
      setBackendReady(true);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const status = e?.response?.status;
      let msg = "Pipeline error — try again";
      if (status === 503) msg = "Knowledge graph is still building — wait a moment and retry";
      else if (status === 429) msg = "Rate limit reached — wait a minute before sending more queries";
      else if (status === 502) msg = "LLM provider error — the AI backend returned an error";
      else if (detail) msg = detail;

      const errMsg: Message = { id: Math.random().toString(36).slice(2), role: "assistant", text: msg, error: true, ts: Date.now() };
      setMessages(prev => [...prev, errMsg]);
      toast(msg, "error");
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }, [loading, scrollToBottom]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(input); }
  };

  const clearHistory = () => {
    setMessages([]);
    toast("Conversation cleared", "info");
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 100) + "px";
  };

  return (
    <aside style={{ width: 340, minWidth: 280, background: "var(--panel)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Ask the Graph</span>
            <span className="badge badge-amber" style={{ fontSize: "0.65rem" }}>Synthesizer Agent</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {backendReady !== null && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.68rem", color: backendReady ? "var(--teal)" : "var(--red)" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: backendReady ? "var(--teal)" : "var(--red)", boxShadow: backendReady ? "0 0 6px var(--teal)" : "none" }} />
                {backendReady ? "Ready" : "Offline"}
              </span>
            )}
            {messages.length > 0 && (
              <button onClick={clearHistory} style={{ background: "none", color: "var(--muted)", fontSize: "0.72rem", padding: "2px 6px", borderRadius: "var(--radius-sm)", border: "1px solid transparent" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.color = "var(--red)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ fontSize: "0.72rem", color: "var(--muted)", marginBottom: 2 }}>Try asking:</p>
            {SUGGESTIONS.map(s => (
              <button key={s} onClick={() => send(s)} style={{
                background: "var(--panel2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "7px 10px",
                fontSize: "0.75rem",
                color: "var(--text2)",
                textAlign: "left",
                lineHeight: 1.4,
                transition: "all var(--transition)",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; e.currentTarget.style.background = "var(--teal-glow)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; e.currentTarget.style.background = "var(--panel2)"; }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map(m => (
          <div key={m.id} className="fade-in" style={{
            background: m.role === "user" ? "var(--panel2)" : m.error ? "var(--red-dim)" : "rgba(0,212,170,0.04)",
            border: `1px solid ${m.role === "user" ? "var(--border)" : m.error ? "rgba(239,68,68,0.25)" : "rgba(0,212,170,0.12)"}`,
            borderRadius: "var(--radius)",
            padding: "10px 12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.65rem", color: m.role === "user" ? "var(--text2)" : m.error ? "var(--red)" : "var(--teal)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {m.role === "user" ? "You" : m.error ? "Error" : "AI"}
              </span>
              {m.role === "assistant" && !m.error && <CopyButton text={m.text} />}
            </div>
            <div style={{ fontSize: "0.83rem", lineHeight: 1.65, whiteSpace: "pre-wrap", color: m.error ? "var(--red)" : "var(--text)" }}>
              {m.text}
            </div>
            {m.meta && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                <span className="badge" style={{ background: "transparent", border: "1px solid var(--border)", color: STRATEGY_COLORS[m.meta.strategy] || "var(--text2)", fontSize: "0.65rem" }}>
                  {m.meta.strategy}
                </span>
                <span className="badge" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.65rem" }}>
                  {m.meta.hops} hop{m.meta.hops !== 1 ? "s" : ""}
                </span>
                <span className="badge" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.65rem" }}>
                  {m.meta.chunks} chunks
                </span>
                <span className="badge" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.65rem" }}>
                  {m.meta.facts} graph facts
                </span>
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="fade-in" style={{ background: "rgba(0,212,170,0.04)", border: "1px solid rgba(0,212,170,0.12)", borderRadius: "var(--radius)", padding: "10px 12px" }}>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.65rem", color: "var(--teal)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>AI</div>
            <TypingDots />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", flexShrink: 0, background: "var(--panel)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); autoResize(); }}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question… (Ctrl+Enter to send)"
            rows={1}
            disabled={loading}
            maxLength={500}
            style={{
              flex: 1,
              background: "var(--panel2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              padding: "8px 10px",
              fontSize: "0.83rem",
              resize: "none",
              lineHeight: 1.5,
              minHeight: 36,
              maxHeight: 100,
              overflow: "auto",
            }}
            onFocus={e => (e.target.style.borderColor = "var(--teal)")}
            onBlur={e => (e.target.style.borderColor = "var(--border)")}
          />
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            style={{
              width: 36,
              height: 36,
              borderRadius: "var(--radius-sm)",
              background: input.trim() && !loading ? "var(--teal)" : "var(--panel2)",
              color: input.trim() && !loading ? "#06110f" : "var(--muted)",
              border: "1px solid var(--border)",
              fontWeight: 700,
              fontSize: "1rem",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all var(--transition)",
            }}
          >
            {loading ? (
              <span className="spin" style={{ width: 14, height: 14, border: "2px solid var(--border2)", borderTopColor: "var(--teal)", borderRadius: "50%", display: "inline-block" }} />
            ) : "→"}
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
          <span style={{ fontSize: "0.65rem", color: "var(--muted)" }}>Ctrl+Enter to send</span>
          <span style={{ fontSize: "0.65rem", color: input.length > 450 ? "var(--amber)" : "var(--muted)" }}>{input.length}/500</span>
        </div>
      </div>
    </aside>
  );
}
