"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import IngestionPanel from "@/components/IngestionPanel";
import GraphPanel from "@/components/GraphPanel";
import ChatPanel from "@/components/ChatPanel";
import { ToastContainer, toast } from "@/components/Toast";

interface GraphData {
  nodes: { id: string; label: string; degree?: number }[];
  links: { source: string; target: string; relation: string }[];
}
interface HealthData {
  status: string;
  llm_provider: string | null;
  graph_nodes: number | null;
  graph_edges: number | null;
}

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };
type MobileTab = "ingest" | "graph" | "chat";

const AGENTS = [
  { label: "Extractor",   color: "var(--teal)"   },
  { label: "Router",      color: "var(--blue)"   },
  { label: "Reasoning",   color: "var(--purple)" },
  { label: "Synthesizer", color: "var(--amber)"  },
];

export default function Home() {
  const [graphData,      setGraphData]      = useState<GraphData>(EMPTY_GRAPH);
  const [status,         setStatus]         = useState("");
  const [health,         setHealth]         = useState<HealthData | null>(null);
  const [startupDone,    setStartupDone]    = useState(false);
  const [highlightNodes, setHighlightNodes] = useState<string[]>([]);
  const [highlightEdges, setHighlightEdges] = useState<{ source: string; target: string }[]>([]);
  const [mobileTab,      setMobileTab]      = useState<MobileTab>("graph");
  const [leftCollapsed,  setLeftCollapsed]  = useState(false);
  const [pendingFocus,   setPendingFocus]   = useState<string | null>(null);

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
      const { data } = await axios.get<GraphData>("/api/graph", { timeout: 10000 });
      if (data.nodes?.length > 0) {
        setGraphData(data);
        setStatus(`Graph loaded: ${data.nodes.length} nodes, ${data.links.length} edges`);
      } else {
        setStatus("Ready — load the enterprise demo or upload a document.");
      }
    } catch {
      setStatus("Backend starting up — may take 30–60 s on first load.");
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
    setHighlightNodes([]);
    setHighlightEdges([]);
  }, []);

  const handleHighlight = useCallback((nodes: string[], edges: { source: string; target: string }[]) => {
    setHighlightNodes(nodes);
    setHighlightEdges(edges);
  }, []);

  const handleNodeFocus = useCallback((name: string) => {
    setPendingFocus(name);
    setMobileTab("graph");
  }, []);

  const clearHighlight = useCallback(() => {
    setHighlightNodes([]);
    setHighlightEdges([]);
  }, []);

  const isReady = health?.status === "ok";

  const TAB_LABELS: { id: MobileTab; icon: string; label: string; badge?: number }[] = [
    { id: "ingest", icon: "📄", label: "Ingest", badge: graphData.nodes.length || undefined },
    { id: "graph",  icon: "🕸️", label: "Graph",  badge: highlightNodes.length || undefined },
    { id: "chat",   icon: "🤖", label: "Ask AI"  },
  ];

  return (
    <div className="app-shell">
      <ToastContainer />

      {/* ── top header ── */}
      <header style={{ height: "var(--header-h)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", background: "var(--panel)", borderBottom: "1px solid var(--border)", flexShrink: 0, zIndex: 100, gap: 8 }}>
        {/* logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {/* laptop collapse toggle */}
          <button className="collapse-toggle" onClick={() => setLeftCollapsed(c => !c)}
            style={{ width: 26, height: 26, borderRadius: "var(--radius-sm)", background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center" }}
            title={leftCollapsed ? "Expand ingestion panel" : "Collapse ingestion panel"}>
            {leftCollapsed ? "▶" : "◀"}
          </button>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--teal)", boxShadow: "0 0 10px var(--teal)", display: "inline-block", flexShrink: 0 }} className="pulse" />
          <span style={{ fontWeight: 700, fontSize: "0.9rem", letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>KnowledgeGraph AI</span>
          <span className="hide-mobile" style={{ width: 1, height: 14, background: "var(--border)", flexShrink: 0 }} />
          <span className="hide-mobile" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.62rem", color: "var(--muted)" }}>Multi-Agent GraphRAG</span>
        </div>

        {/* agent pipeline — hidden on small screens */}
        <div className="hide-mobile" style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
          {AGENTS.map((a, i) => (
            <div key={a.label} style={{ display: "flex", alignItems: "center" }}>
              <span style={{ fontSize: "0.65rem", fontWeight: 600, color: a.color, padding: "0 8px" }}>{a.label}</span>
              {i < AGENTS.length - 1 && <span style={{ color: "var(--border2)", fontSize: "0.65rem" }}>→</span>}
            </div>
          ))}
        </div>

        {/* right status */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: isReady ? "var(--teal)" : "var(--amber)", boxShadow: isReady ? "0 0 8px var(--teal)" : "none", flexShrink: 0 }} className={isReady ? "" : "pulse"} />
            <span style={{ fontSize: "0.68rem", color: isReady ? "var(--teal)" : "var(--amber)", fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap" }}>
              {isReady ? (health?.llm_provider || "ready") : "starting…"}
            </span>
          </div>
          {health?.graph_nodes != null && (
            <span className="badge badge-teal hide-mobile" style={{ fontSize: "0.6rem" }}>{health.graph_nodes}N · {health.graph_edges}E</span>
          )}
          {highlightNodes.length > 0 && (
            <button onClick={clearHighlight} style={{ padding: "3px 9px", borderRadius: "var(--radius-sm)", background: "var(--teal-dim)", border: "1px solid rgba(0,212,170,0.3)", color: "var(--teal)", fontSize: "0.68rem", fontWeight: 500, whiteSpace: "nowrap" }}>
              ✕ Clear
            </button>
          )}
        </div>
      </header>

      <div className="glow-line" />

      {/* ── main grid (desktop) / stacked panels (mobile) ── */}
      <div className={`main-grid${leftCollapsed ? " left-collapsed" : ""}`} style={{ flex: 1, minHeight: 0 }}>

        {/* LEFT — ingestion */}
        <div style={{ background: "var(--panel)", borderRight: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column", transition: "width var(--transition)" }}
          className="panel-mobile visible">
          <IngestionPanel onGraphUpdate={handleGraphUpdate} onStatus={setStatus} />
        </div>

        {/* CENTER — graph */}
        <div style={{ overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}
          className={`panel-mobile ${mobileTab === "graph" ? "visible" : "hidden"}`}>
          <GraphPanel
            graphData={graphData}
            status={status}
            queryHighlightNodes={highlightNodes}
            queryHighlightEdges={highlightEdges}
            pendingFocus={pendingFocus}
            onFocusConsumed={() => setPendingFocus(null)}
            onNodeFocus={handleNodeFocus}
            onHighlightClear={clearHighlight}
          />
        </div>

        {/* RIGHT — chat */}
        <div style={{ background: "var(--panel)", borderLeft: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}
          className={`panel-mobile ${mobileTab === "chat" ? "visible" : "hidden"}`}>
          <ChatPanel
            graphNodes={graphData.nodes.map(n => n.id)}
            onHighlight={handleHighlight}
            onNodeFocus={handleNodeFocus}
            onSwitchToGraph={() => setMobileTab("graph")}
          />
        </div>
      </div>

      {/* ── mobile bottom nav ── */}
      <nav className="bottom-nav">
        {TAB_LABELS.map(t => (
          <button key={t.id} className={`bottom-nav-tab${mobileTab === t.id ? " active" : ""}`} onClick={() => setMobileTab(t.id)}>
            <span className="bottom-nav-tab-icon">{t.icon}</span>
            <span>{t.label}{t.badge ? ` (${t.badge})` : ""}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
