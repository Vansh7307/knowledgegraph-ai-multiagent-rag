"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import IngestionPanel from "@/components/IngestionPanel";
import GraphPanel from "@/components/GraphPanel";
import ChatPanel from "@/components/ChatPanel";
import StatsPanel from "@/components/StatsPanel";
import { ToastContainer, toast } from "@/components/Toast";

interface GraphData {
  nodes: { id: string; label: string }[];
  links: { source: string; target: string; relation: string }[];
}
interface HealthData {
  status: string;
  llm_provider: string | null;
  graph_nodes: number | null;
  graph_edges: number | null;
}

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };

const AGENTS = [
  { label: "Extractor",   desc: "NER + relations",    color: "var(--teal)"   },
  { label: "Router",      desc: "Strategy select",    color: "var(--blue)"   },
  { label: "Reasoning",   desc: "Multi-hop check",    color: "var(--purple)" },
  { label: "Synthesizer", desc: "Answer + citation",  color: "var(--amber)"  },
];

export default function Home() {
  const [graphData,        setGraphData]        = useState<GraphData>(EMPTY_GRAPH);
  const [status,           setStatus]           = useState("");
  const [streaming,        setStreaming]         = useState(false);
  const [health,           setHealth]           = useState<HealthData | null>(null);
  const [showStats,        setShowStats]        = useState(false);
  const [startupDone,      setStartupDone]      = useState(false);
  const [highlightNodes,   setHighlightNodes]   = useState<string[]>([]);
  const [highlightEdges,   setHighlightEdges]   = useState<{ source: string; target: string }[]>([]);
  const graphRef = useRef<any>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const { data } = await axios.get<HealthData>("/api/health", { timeout: 8000 });
      setHealth(data);
      if (data.status === "ok" && !startupDone) {
        setStartupDone(true);
        toast(`Graph ready — ${data.graph_nodes} nodes, ${data.graph_edges} edges`, "success");
      }
      return data.status === "ok";
    } catch { return false; }
  }, [startupDone]);

  const fetchGraph = useCallback(async () => {
    try {
      const { data } = await axios.get<GraphData>("/api/graph-data", { timeout: 10000 });
      if (data.nodes.length > 0) {
        setGraphData(data);
        setStatus(`Graph loaded: ${data.nodes.length} nodes, ${data.links.length} edges`);
      } else {
        setStatus("Ready — upload a document or load the enterprise demo.");
      }
    } catch {
      setStatus("Backend starting up — this may take 30–60 s on first load.");
    }
  }, []);

  useEffect(() => {
    fetchGraph();
    fetchHealth();
    const iv = setInterval(async () => {
      const ready = await fetchHealth();
      if (ready) { clearInterval(iv); fetchGraph(); }
    }, 6000);
    return () => clearInterval(iv);
  }, [fetchGraph, fetchHealth]);

  const handleGraphUpdate = useCallback((graph: GraphData) => {
    setGraphData(graph);
    setStreaming(true);
    setHighlightNodes([]);
    setHighlightEdges([]);
  }, []);

  const handleHighlight = useCallback((nodes: string[], edges: { source: string; target: string }[]) => {
    setHighlightNodes(nodes);
    setHighlightEdges(edges);
  }, []);

  const handleNodeFocus = useCallback((name: string) => {
    // GraphPanel exposes focus via its own internal ref; we just clear highlights to re-center
    setHighlightNodes(prev => prev.includes(name) ? prev : [...prev, name]);
  }, []);

  const isReady = health?.status === "ok";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <ToastContainer />

      {/* ── top bar ── */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", height: 48, background: "var(--panel)", borderBottom: "1px solid var(--border)", flexShrink: 0, zIndex: 100 }}>

        {/* logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--teal)", boxShadow: "0 0 10px var(--teal)", display: "inline-block" }} className="pulse" />
          <span style={{ fontWeight: 700, fontSize: "0.9rem", letterSpacing: "-0.02em" }}>KnowledgeGraph AI</span>
          <span style={{ width: 1, height: 14, background: "var(--border)" }} />
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.65rem", color: "var(--muted)" }}>Multi-Agent GraphRAG</span>
        </div>

        {/* agent pipeline */}
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {AGENTS.map((a, i) => (
            <div key={a.label} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 9px" }} title={a.desc}>
                <span style={{ fontSize: "0.65rem", fontWeight: 600, color: a.color }}>{a.label}</span>
                <span style={{ fontSize: "0.57rem", color: "var(--muted)" }}>{a.desc}</span>
              </div>
              {i < AGENTS.length - 1 && <span style={{ color: "var(--border2)", fontSize: "0.65rem" }}>→</span>}
            </div>
          ))}
        </div>

        {/* right controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: isReady ? "var(--teal)" : "var(--amber)", boxShadow: isReady ? "0 0 8px var(--teal)" : "none" }} className={isReady ? "" : "pulse"} />
            <span style={{ fontSize: "0.7rem", color: isReady ? "var(--teal)" : "var(--amber)", fontFamily: "JetBrains Mono, monospace" }}>
              {isReady ? (health?.llm_provider || "ready") : "starting…"}
            </span>
          </div>
          {health?.graph_nodes != null && (
            <span className="badge badge-teal" style={{ fontSize: "0.62rem" }}>{health.graph_nodes}N · {health.graph_edges}E</span>
          )}
          {highlightNodes.length > 0 && (
            <button onClick={() => { setHighlightNodes([]); setHighlightEdges([]); }}
              style={{ padding: "3px 10px", borderRadius: "var(--radius-sm)", background: "var(--teal-dim)", border: "1px solid rgba(0,212,170,0.3)", color: "var(--teal)", fontSize: "0.7rem", fontWeight: 500 }}>
              ✕ Clear Highlight
            </button>
          )}
          <button onClick={() => setShowStats(s => !s)}
            style={{ padding: "4px 12px", borderRadius: "var(--radius-sm)", background: showStats ? "var(--teal-dim)" : "var(--panel2)", border: `1px solid ${showStats ? "rgba(0,212,170,0.3)" : "var(--border)"}`, color: showStats ? "var(--teal)" : "var(--text2)", fontSize: "0.73rem", fontWeight: 500 }}
            onMouseEnter={e => { if (!showStats) { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}}
            onMouseLeave={e => { if (!showStats) { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}}>
            Analytics
          </button>
        </div>
      </header>

      <div className="glow-line" />

      {/* ── main body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <IngestionPanel onGraphUpdate={handleGraphUpdate} onStatus={setStatus} />

        <GraphPanel
          graphData={graphData}
          status={status}
          streaming={streaming}
          onStreamEnd={() => setStreaming(false)}
          queryHighlightNodes={highlightNodes}
          queryHighlightEdges={highlightEdges}
          onNodeFocus={handleNodeFocus}
        />

        {showStats && (
          <div style={{ width: 276, minWidth: 240, background: "var(--panel)", borderLeft: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <StatsPanel />
          </div>
        )}

        <ChatPanel
          graphNodes={graphData.nodes.map(n => n.id)}
          onHighlight={handleHighlight}
          onNodeFocus={handleNodeFocus}
        />
      </div>
    </div>
  );
}
