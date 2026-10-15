"use client";
import { useRef, useState, useEffect, useCallback } from "react";
import { toast } from "./Toast";
import type { QueryResult } from "@/lib/scratchEngine";

interface TraceStep { agent: string; status: string; detail: string; ms: number; strategy?: string; }
interface SourceChunk { id: string; source: string; text: string; }
interface Message {
  id: string; role: "user" | "assistant"; text: string; error?: boolean; ts: number;
  meta?: { hops: number; chunks: number; facts: number; strategy: string };
  trace?: TraceStep[];
  highlightedNodes?: string[];
  highlightedEdges?: { source: string; target: string }[];
  sourceChunks?: SourceChunk[];
  graphFacts?: string[];
}
interface Props {
  graphNodes?: string[];
  onQuery: (question: string) => QueryResult;
  onHighlight?: (nodes: string[], edges: { source: string; target: string }[]) => void;
  onNodeFocus?: (name: string) => void;
  onSwitchToGraph?: () => void;
}

const STATIC_CHIPS = [
  "What is Self-Attention?",
  "How does Graph RAG differ from plain RAG?",
  "What company built ChatGPT?",
  "How are multi-agent systems used in RAG?",
];
const STRATEGY_COLORS: Record<string, string> = { hybrid: "var(--teal)", graph: "var(--blue)", text: "var(--purple)" };
const AGENT_COLORS: Record<string, string> = { "Router": "var(--blue)", "Extractor / Retriever": "var(--teal)", "Reasoning": "var(--purple)", "Synthesizer": "var(--amber)" };

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 0" }}>
      {[0,1,2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--teal)", animation: `pulse-dot 1.2s ease-in-out ${i*0.2}s infinite`, display: "inline-block" }} />)}
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}
      style={{ background: "none", color: copied ? "var(--teal)" : "var(--muted)", fontSize: "0.67rem", padding: "2px 6px", borderRadius: "var(--radius-sm)", border: "1px solid transparent" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.color = "var(--text2)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = copied ? "var(--teal)" : "var(--muted)"; }}>
      {copied ? "✓" : "Copy"}
    </button>
  );
}

function AgentTrace({ trace }: { trace: TraceStep[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: "none", color: "var(--text2)", fontSize: "0.67rem", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ color: "var(--teal)" }}>{open ? "▾" : "▸"}</span>
        Agent Execution Trace ({trace.length} steps)
      </button>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
          {trace.map((step, i) => (
            <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 8px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: AGENT_COLORS[step.agent] || "var(--muted)", marginTop: 4, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontSize: "0.68rem", fontWeight: 600, color: AGENT_COLORS[step.agent] || "var(--text2)" }}>{step.agent}</span>
                  <span style={{ fontSize: "0.6rem", color: "var(--muted)", fontFamily: "JetBrains Mono, monospace" }}>{step.ms}ms</span>
                </div>
                <span style={{ fontSize: "0.67rem", color: "var(--text2)", lineHeight: 1.4 }}>{step.detail}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceContext({ chunks, facts }: { chunks: SourceChunk[]; facts: string[] }) {
  const [open, setOpen] = useState(false);
  if (!chunks.length && !facts.length) return null;
  return (
    <div style={{ marginTop: 6, borderTop: "1px solid var(--border)", paddingTop: 6 }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: "none", color: "var(--text2)", fontSize: "0.67rem", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ color: "var(--purple)" }}>{open ? "▾" : "▸"}</span>
        Source Context & Graph Triplets ({chunks.length} chunks, {facts.length} facts)
      </button>
      {open && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 5 }}>
          {chunks.map(c => (
            <div key={c.id} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 9px" }}>
              <div style={{ fontSize: "0.6rem", color: "var(--muted)", marginBottom: 3, fontFamily: "JetBrains Mono, monospace" }}>{c.source}</div>
              <div style={{ fontSize: "0.7rem", color: "var(--text2)", lineHeight: 1.5 }}>{c.text}</div>
            </div>
          ))}
          {facts.length > 0 && (
            <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 9px" }}>
              <div style={{ fontSize: "0.6rem", color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Graph Facts</div>
              {facts.map((f, i) => <div key={i} style={{ fontSize: "0.67rem", color: "var(--text2)", fontFamily: "JetBrains Mono, monospace", lineHeight: 1.6 }}>{f}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({ graphNodes = [], onQuery, onHighlight, onNodeFocus, onSwitchToGraph }: Props) {
  const [messages,     setMessages]     = useState<Message[]>([]);
  const [input,        setInput]        = useState("");
  const [loading,      setLoading]      = useState(false);
  const [chips,        setChips]        = useState<string[]>(STATIC_CHIPS);
  const [lastHL,       setLastHL]       = useState<{ nodes: string[]; edges: { source: string; target: string }[] } | null>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (graphNodes.length < 4) { setChips(STATIC_CHIPS); return; }
    const picks = graphNodes.slice(0, 2);
    setChips([...STATIC_CHIPS.slice(0, 2), `What is ${picks[0]} and how does it relate to the graph?`, `Explain the relationship between ${picks[0]} and ${picks[1]}`]);
  }, [graphNodes]);

  const scrollToBottom = useCallback(() => setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50), []);

  const send = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    if (q.length < 3)  { toast("Question too short", "warning"); return; }
    if (q.length > 500){ toast("Question too long — max 500 chars", "warning"); return; }
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setMessages(prev => [...prev, { id: Math.random().toString(36).slice(2), role: "user", text: q, ts: Date.now() }]);
    setLoading(true); scrollToBottom();
    try {
      const data = onQuery(q);
      const msg: Message = {
        id: Math.random().toString(36).slice(2), role: "assistant", text: data.answer, ts: Date.now(),
        meta: { hops: data.hops, chunks: data.chunks_used, facts: data.graph_facts_used, strategy: data.strategy },
        trace: data.trace || [], highlightedNodes: data.highlighted_nodes || [],
        highlightedEdges: data.highlighted_edges || [], sourceChunks: data.source_chunks || [], graphFacts: data.graph_facts || [],
      };
      setMessages(prev => [...prev, msg]);
      if (data.highlighted_nodes?.length > 0) {
        const hl = { nodes: data.highlighted_nodes, edges: data.highlighted_edges || [] };
        setLastHL(hl);
        onHighlight?.(hl.nodes, hl.edges);
        toast(`${data.highlighted_nodes.length} nodes highlighted on graph`, "info");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "The local graph query failed.";
      setMessages(prev => [...prev, { id: Math.random().toString(36).slice(2), role: "assistant", text: msg, error: true, ts: Date.now() }]);
      toast(msg, "error");
    } finally { setLoading(false); scrollToBottom(); }
  }, [loading, scrollToBottom, onHighlight, onQuery]);

  const clearHistory = () => { setMessages([]); onHighlight?.([], []); setLastHL(null); toast("Conversation cleared", "info"); };

  const autoResize = () => {
    const el = textareaRef.current; if (!el) return;
    el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 100) + "px";
  };

  const renderAnswer = (text: string, nodes: string[]) => {
    if (!nodes.length) return <span style={{ fontSize: "0.82rem", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{text}</span>;
    const alternatives = nodes.slice().sort((a, b) => b.length - a.length).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const matcher = new RegExp(`(^|[^A-Za-z0-9])(${alternatives.join("|")})(?=$|[^A-Za-z0-9])`, "gim");
    const parts: React.ReactNode[] = [];
    let offset = 0;
    for (const match of text.matchAll(matcher)) {
      const name = match[2] || match[0];
      const start = (match.index ?? 0) + (match[1]?.length || 0);
      if (start > offset) parts.push(<span key={`text-${offset}`}>{text.slice(offset, start)}</span>);
      const entity = nodes.find((candidate) => candidate.toLowerCase() === name.toLowerCase()) || name;
      parts.push(
        <button key={`entity-${start}`} onClick={() => { onNodeFocus?.(entity); onSwitchToGraph?.(); }}
          style={{ background: "var(--teal-dim)", color: "var(--teal)", border: "1px solid rgba(0,212,170,0.25)", borderRadius: 4, padding: "0 4px", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", margin: "0 1px" }}>
          {name}
        </button>,
      );
      offset = start + name.length;
    }
    if (offset < text.length) parts.push(<span key={`text-${offset}`}>{text.slice(offset)}</span>);
    return (
      <span style={{ fontSize: "0.82rem", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{parts}</span>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Ask the Graph</span>
            <span className="badge badge-amber" style={{ fontSize: "0.6rem" }}>Synthesizer Agent</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.67rem", color: "var(--teal)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--teal)", boxShadow: "0 0 6px var(--teal)" }} />
              Local engine
            </span>
            {messages.length > 0 && (
              <button onClick={clearHistory} style={{ background: "none", color: "var(--muted)", fontSize: "0.7rem", padding: "2px 6px", borderRadius: "var(--radius-sm)", border: "1px solid transparent" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.color = "var(--red)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "var(--muted)"; }}>
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* messages */}
      <div className="panel-scroll" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <div className="fade-in" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ fontSize: "0.7rem", color: "var(--muted)", marginBottom: 2 }}>Try asking:</p>
            {chips.map(s => (
              <button key={s} onClick={() => send(s)}
                style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 10px", fontSize: "0.74rem", color: "var(--text2)", textAlign: "left", lineHeight: 1.4 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; e.currentTarget.style.background = "var(--teal-glow)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; e.currentTarget.style.background = "var(--panel2)"; }}>
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map(m => (
          <div key={m.id} className="fade-in" style={{ background: m.role === "user" ? "var(--panel2)" : m.error ? "var(--red-dim)" : "rgba(0,212,170,0.04)", border: `1px solid ${m.role === "user" ? "var(--border)" : m.error ? "rgba(239,68,68,0.25)" : "rgba(0,212,170,0.12)"}`, borderRadius: "var(--radius)", padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.6rem", color: m.role === "user" ? "var(--text2)" : m.error ? "var(--red)" : "var(--teal)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {m.role === "user" ? "You" : m.error ? "Error" : "AI"}
              </span>
              {m.role === "assistant" && !m.error && <CopyBtn text={m.text} />}
            </div>
            <div style={{ color: m.error ? "var(--red)" : "var(--text)" }}>
              {m.role === "assistant" && !m.error && m.highlightedNodes?.length
                ? renderAnswer(m.text, m.highlightedNodes)
                : <span style={{ fontSize: "0.82rem", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{m.text}</span>}
            </div>
            {m.meta && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                <span className="badge" style={{ background: "transparent", border: "1px solid var(--border)", color: STRATEGY_COLORS[m.meta.strategy] || "var(--text2)", fontSize: "0.6rem" }}>{m.meta.strategy}</span>
                <span className="badge" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.6rem" }}>{m.meta.hops} hop{m.meta.hops !== 1 ? "s" : ""}</span>
                <span className="badge" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.6rem" }}>{m.meta.chunks} chunks</span>
                <span className="badge" style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.6rem" }}>{m.meta.facts} facts</span>
              </div>
            )}
            {/* mobile: view highlighted graph button */}
            {m.highlightedNodes && m.highlightedNodes.length > 0 && (
              <button onClick={() => { onHighlight?.(m.highlightedNodes!, m.highlightedEdges || []); onSwitchToGraph?.(); }}
                style={{ marginTop: 8, width: "100%", padding: "6px", borderRadius: "var(--radius-sm)", background: "var(--teal-dim)", border: "1px solid rgba(0,212,170,0.25)", color: "var(--teal)", fontSize: "0.72rem", fontWeight: 600 }}>
                🕸️ View Highlighted Graph ({m.highlightedNodes.length} nodes)
              </button>
            )}
            {m.trace && m.trace.length > 0 && <AgentTrace trace={m.trace} />}
            {m.sourceChunks && <SourceContext chunks={m.sourceChunks} facts={m.graphFacts || []} />}
          </div>
        ))}

        {loading && (
          <div className="fade-in" style={{ background: "rgba(0,212,170,0.04)", border: "1px solid rgba(0,212,170,0.12)", borderRadius: "var(--radius)", padding: "10px 12px" }}>
            <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.6rem", color: "var(--teal)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>AI · Running pipeline…</div>
            <TypingDots />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* input */}
      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", flexShrink: 0, background: "var(--panel)" }}>
        <div style={{ display: "flex", gap: 7, alignItems: "flex-end" }}>
          <textarea ref={textareaRef} value={input}
            onChange={e => { setInput(e.target.value); autoResize(); }}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(input); } }}
            placeholder="Ask a question… (Ctrl+Enter)" rows={1} disabled={loading} maxLength={500}
            style={{ flex: 1, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "8px 10px", fontSize: "0.82rem", resize: "none", lineHeight: 1.5, minHeight: 36, maxHeight: 100, overflow: "auto" }}
            onFocus={e => (e.target.style.borderColor = "var(--teal)")}
            onBlur={e => (e.target.style.borderColor = "var(--border)")} />
          <button onClick={() => send(input)} disabled={loading || !input.trim()}
            style={{ width: 36, height: 36, borderRadius: "var(--radius-sm)", background: input.trim() && !loading ? "var(--teal)" : "var(--panel2)", color: input.trim() && !loading ? "#06110f" : "var(--muted)", border: "1px solid var(--border)", fontWeight: 700, fontSize: "1rem", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {loading ? <span className="spin" style={{ width: 14, height: 14, border: "2px solid var(--border2)", borderTopColor: "var(--teal)", borderRadius: "50%", display: "inline-block" }} /> : "→"}
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          <span style={{ fontSize: "0.6rem", color: "var(--muted)" }}>Ctrl+Enter to send</span>
          <span style={{ fontSize: "0.6rem", color: input.length > 450 ? "var(--amber)" : "var(--muted)" }}>{input.length}/500</span>
        </div>
      </div>
    </div>
  );
}
