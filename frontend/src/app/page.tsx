"use client";
import { useEffect, useState, useCallback } from "react";
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
  { id: "extractor",   label: "Extractor",   desc: "NER + relation extraction",  color: "var(--teal)" },
  { id: "router",      label: "Router",      desc: "Strategy selection",          color: "var(--blue)" },
  { id: "reasoning",   label: "Reasoning",   desc: "Multi-hop sufficiency check", color: "var(--purple)" },
  { id: "synthesizer", label: "Synthesizer", desc: "Answer generation + citation", color: "var(--amber)" },
];

export default function Home() {
  const [graphData, setGraphData] = useState<GraphData>(EMPTY_GRAPH);
  const [status, setStatus] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [startupDone, setStartupDone] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const { data } = await axios.get<HealthData>("/api/health");
      setHealth(data);
      if (data.status === "ok" && !startupDone) {
        setStartupDone(true);
        toast(`Graph ready — ${data.graph_nodes} nodes, ${data.graph_edges} edges`, "success");
      }
      return data.status === "ok";
    } catch {
      return false;
    }
  }, [startupDone]);

  const fetchGraph = useCallback(async () => {
    try {
      const { data } = await axios.get<GraphData>("/api/graph-data");
      if (data.nodes.length > 0) {
        setGraphData(data);
        setStatus(`Graph loaded: ${data.nodes.length} nodes, ${data.links.length} edges`);
      } else {
        setStatus("Ready — upload a document or load the demo graph.");
      }
    } catch {
      setStatus("Backend is starting up — this may take 30–60 seconds on first load.");
    }
  }, []);

  useEffect(() => {
    fetchGraph();
    fetchHealth();

    // Poll health until ready, then stop
    const interval = setInterval(async () => {
      const ready = await fetchHealth();
      if (ready) {
        clearInterval(interval);
        fetchGraph();
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchGraph, fetchHealth]);

  const handleGraphUpdate = (graph: GraphData) => {
    setGraphData(graph);
    setStreaming(true);
  };

  const isReady = health?.status === "ok";

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <ToastContainer />

      {/* ── Top bar ── */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        height: 48,
        background: "var(--panel)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        zIndex: 100,
      }}>
        {/* Left: logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--teal)", boxShadow: "0 0 10px var(--teal)", display: "inline-block" }} className="pulse" />
            <span style={{ fontWeight: 700, fontSize: "0.92rem", letterSpacing: "-0.02em" }}>KnowledgeGraph AI</span>
          </div>
          <span style={{ width: 1, height: 16, background: "var(--border)" }} />
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.68rem", color: "var(--muted)", letterSpacing: "0.04em" }}>
            Multi-Agent GraphRAG
          </span>
        </div>

        {/* Center: agent pipeline */}
        <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
          {AGENTS.map((a, i) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 10px" }}
                title={a.desc}>
                <span style={{ fontSize: "0.68rem", fontWeight: 600, color: a.color, letterSpacing: "0.02em" }}>{a.label}</span>
                <span style={{ fontSize: "0.6rem", color: "var(--muted)" }}>{a.desc}</span>
              </div>
              {i < AGENTS.length - 1 && (
                <span style={{ color: "var(--border2)", fontSize: "0.7rem" }}>→</span>
              )}
            </div>
          ))}
        </div>

        {/* Right: status + controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: isReady ? "var(--teal)" : "var(--amber)", boxShadow: isReady ? "0 0 8px var(--teal)" : "none", flexShrink: 0 }} className={isReady ? "" : "pulse"} />
            <span style={{ fontSize: "0.72rem", color: isReady ? "var(--teal)" : "var(--amber)", fontFamily: "JetBrains Mono, monospace" }}>
              {isReady ? health?.llm_provider || "ready" : "starting…"}
            </span>
          </div>
          {health?.graph_nodes != null && (
            <span className="badge badge-teal" style={{ fontSize: "0.65rem" }}>
              {health.graph_nodes}N · {health.graph_edges}E
            </span>
          )}
          <button
            onClick={() => setShowStats(s => !s)}
            style={{
              padding: "4px 12px",
              borderRadius: "var(--radius-sm)",
              background: showStats ? "var(--teal-dim)" : "var(--panel2)",
              border: `1px solid ${showStats ? "rgba(0,212,170,0.3)" : "var(--border)"}`,
              color: showStats ? "var(--teal)" : "var(--text2)",
              fontSize: "0.75rem",
              fontWeight: 500,
            }}
            onMouseEnter={e => { if (!showStats) { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}}
            onMouseLeave={e => { if (!showStats) { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}}
          >
            Analytics
          </button>
        </div>
      </header>

      <div className="glow-line" />

      {/* ── Main body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <IngestionPanel onGraphUpdate={handleGraphUpdate} onStatus={setStatus} />
        <GraphPanel
          graphData={graphData}
          status={status}
          streaming={streaming}
          onStreamEnd={() => setStreaming(false)}
        />
        {showStats && (
          <div style={{ width: 280, minWidth: 240, background: "var(--panel)", borderLeft: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <StatsPanel />
          </div>
        )}
        <ChatPanel />
      </div>
    </div>
  );
}
