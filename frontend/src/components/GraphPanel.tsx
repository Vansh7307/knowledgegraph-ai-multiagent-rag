"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import axios from "axios";
import { toast } from "./Toast";

const ForceGraph2D = dynamic(() => import("react-force-graph").then(m => m.ForceGraph2D), { ssr: false });

interface GraphData {
  nodes: { id: string; label: string; degree?: number }[];
  links: { source: string; target: string; relation: string }[];
}
interface NodeDetail {
  name: string; degree: number; in_degree: number; out_degree: number;
  triplets: { subject: string; predicate: string; object: string; chunk_id: string }[];
  source_chunks: { id: string; source: string; text: string }[];
}
interface Props {
  graphData: GraphData;
  status: string;
  queryHighlightNodes?: string[];
  queryHighlightEdges?: { source: string; target: string }[];
  pendingFocus?: string | null;
  onFocusConsumed?: () => void;
  onNodeFocus?: (name: string) => void;
  onHighlightClear?: () => void;
}

const COLORS = ["#00d4aa","#3b82f6","#8b5cf6","#f59e0b","#10b981","#ef4444","#06b6d4","#ec4899"];
function hashColor(s: string) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}

export default function GraphPanel({ graphData, status, queryHighlightNodes = [], queryHighlightEdges = [], pendingFocus, onFocusConsumed, onNodeFocus, onHighlightClear }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef     = useRef<any>(null);
  const [dims,          setDims]          = useState({ width: 800, height: 600 });
  const [selectedNode,  setSelectedNode]  = useState<string | null>(null);
  const [hoveredNode,   setHoveredNode]   = useState<string | null>(null);
  const [clickHL,       setClickHL]       = useState<Set<string>>(new Set());
  const [clickEdgeHL,   setClickEdgeHL]   = useState<Set<string>>(new Set());
  const [nodeDetail,    setNodeDetail]    = useState<NodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showChunks,    setShowChunks]    = useState(false);
  const [searchQ,       setSearchQ]       = useState("");
  const [showSearch,    setShowSearch]    = useState(false);
  const [isMobile,      setIsMobile]      = useState(false);
  const [showSheet,     setShowSheet]     = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) setDims({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  /* pendingFocus: zoom to node requested from chat */
  useEffect(() => {
    if (!pendingFocus || !graphRef.current) return;
    const gd = graphRef.current._graphData;
    if (!gd) return;
    const node = gd.nodes?.find((n: any) => n.id === pendingFocus);
    if (node) {
      graphRef.current.centerAt(node.x, node.y, 600);
      graphRef.current.zoom(3.5, 600);
    }
    onFocusConsumed?.();
  }, [pendingFocus, onFocusConsumed]);

  const handleNodeClick = useCallback(async (node: any) => {
    const id = node.id as string;
    if (id === selectedNode) { setSelectedNode(null); setClickHL(new Set()); setClickEdgeHL(new Set()); setNodeDetail(null); setShowSheet(false); return; }
    setSelectedNode(id);
    const conn = new Set<string>([id]);
    const edgeKeys = new Set<string>();
    graphData.links.forEach(l => {
      const s = typeof l.source === "object" ? (l.source as any).id : l.source;
      const t = typeof l.target === "object" ? (l.target as any).id : l.target;
      if (s === id || t === id) { conn.add(s); conn.add(t); edgeKeys.add(`${s}||${t}`); }
    });
    setClickHL(conn); setClickEdgeHL(edgeKeys);
    setDetailLoading(true); setNodeDetail(null); setShowChunks(false); setShowSheet(true);
    try {
      const { data } = await axios.get<NodeDetail>(`/api/node-detail?name=${encodeURIComponent(id)}`);
      setNodeDetail(data);
    } catch {}
    finally { setDetailLoading(false); }
    onNodeFocus?.(id);
  }, [selectedNode, graphData.links, onNodeFocus]);

  const clearSelection = useCallback(() => {
    setSelectedNode(null); setClickHL(new Set()); setClickEdgeHL(new Set()); setNodeDetail(null); setShowSheet(false);
  }, []);

  const focusNode = (name: string) => {
    const gd = graphRef.current?._graphData;
    const node = gd?.nodes?.find((n: any) => n.id === name);
    if (node) { graphRef.current.centerAt(node.x, node.y, 500); graphRef.current.zoom(3, 500); }
    setSearchQ(""); setShowSearch(false);
  };

  const handleExport = async (fmt: "json" | "csv") => {
    try {
      const r = await axios.get(`/api/export?fmt=${fmt}`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = `knowledge_graph.${fmt}`; a.click();
      URL.revokeObjectURL(url); toast(`Exported as ${fmt.toUpperCase()}`, "success");
    } catch { toast("Export failed", "error"); }
  };

  const handleReset = async () => {
    try {
      await axios.post("/api/reset");
      clearSelection(); onHighlightClear?.();
      toast("Graph reset", "info");
    } catch { toast("Reset failed", "error"); }
  };

  const zoomIn  = () => graphRef.current?.zoom(graphRef.current.zoom() * 1.3, 300);
  const zoomOut = () => graphRef.current?.zoom(graphRef.current.zoom() * 0.75, 300);
  const fitView = useCallback(() => graphRef.current?.zoomToFit(400, 40), []);

  const qNodes = new Set(queryHighlightNodes);
  const qEdges = new Set(queryHighlightEdges.map(e => `${e.source}||${e.target}`));
  const activeNodes = clickHL.size > 0 ? clickHL : qNodes;
  const activeEdges = clickEdgeHL.size > 0 ? clickEdgeHL : qEdges;

  const searchResults = searchQ.length >= 2
    ? graphData.nodes.filter(n => n.id.toLowerCase().includes(searchQ.toLowerCase())).slice(0, 10)
    : [];

  const TOOLBAR_BTN: React.CSSProperties = { width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.82rem", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };

  const InspectorContent = () => (
    <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 700, color: selectedNode ? hashColor(selectedNode) : "var(--text)" }}>{selectedNode}</span>
        <button onClick={clearSelection} style={{ background: "none", color: "var(--muted)", fontSize: "0.85rem" }}>✕</button>
      </div>
      {detailLoading && <div className="skeleton" style={{ height: 56, borderRadius: "var(--radius-sm)" }} />}
      {nodeDetail && !detailLoading && (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            {[["Degree", nodeDetail.degree], ["In", nodeDetail.in_degree], ["Out", nodeDetail.out_degree]].map(([l, v]) => (
              <div key={l as string} style={{ flex: 1, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 4px", textAlign: "center" }}>
                <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--teal)", fontFamily: "JetBrains Mono, monospace" }}>{v}</div>
                <div style={{ fontSize: "0.58rem", color: "var(--muted)" }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: "0.67rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Triplets</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 130, overflowY: "auto" }}>
            {nodeDetail.triplets.slice(0, 12).map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.68rem", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 7px" }}>
                <span style={{ color: t.subject === selectedNode ? "var(--teal)" : "var(--blue)", fontWeight: 600, flexShrink: 0 }}>{t.subject === selectedNode ? "→" : "←"}</span>
                <span style={{ color: "var(--muted)", fontFamily: "JetBrains Mono, monospace", fontSize: "0.6rem", flexShrink: 0, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.predicate}</span>
                <span style={{ color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject === selectedNode ? t.object : t.subject}</span>
              </div>
            ))}
          </div>
          {nodeDetail.source_chunks.length > 0 && (
            <>
              <button onClick={() => setShowChunks(s => !s)} style={{ background: "none", color: "var(--text2)", fontSize: "0.68rem", textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "var(--teal)" }}>{showChunks ? "▾" : "▸"}</span> Source Context ({nodeDetail.source_chunks.length})
              </button>
              {showChunks && nodeDetail.source_chunks.map(c => (
                <div key={c.id} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 9px" }}>
                  <div style={{ fontSize: "0.6rem", color: "var(--muted)", marginBottom: 3, fontFamily: "JetBrains Mono, monospace" }}>{c.source}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text2)", lineHeight: 1.5 }}>{c.text}</div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );

  const headerH = 44;
  const statusH = status ? 28 : 0;
  const graphH  = Math.max(dims.height - headerH - statusH, 200);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", background: "var(--bg)", minWidth: 0 }} ref={containerRef}>

      {/* toolbar */}
      <div style={{ height: headerH, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0, zIndex: 2, gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0, minWidth: 0 }}>
          <span style={{ fontSize: "0.83rem", fontWeight: 600, whiteSpace: "nowrap" }}>Knowledge Graph</span>
          <span className="badge badge-blue" style={{ fontSize: "0.6rem" }}>{graphData.nodes.length}N</span>
          <span className="badge badge-purple" style={{ fontSize: "0.6rem" }}>{graphData.links.length}E</span>
          {qNodes.size > 0 && <span className="badge badge-teal" style={{ fontSize: "0.6rem" }}>⚡{qNodes.size}</span>}
        </div>
        <div className="graph-toolbar">
          {/* search */}
          <div style={{ position: "relative" }}>
            <button style={{ ...TOOLBAR_BTN, ...(showSearch ? { borderColor: "var(--teal)", color: "var(--teal)" } : {}) }} onClick={() => setShowSearch(s => !s)} title="Search nodes">🔍</button>
            {showSearch && (
              <div style={{ position: "absolute", top: 32, right: 0, width: 200, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 8, zIndex: 30, boxShadow: "var(--shadow)" }}>
                <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search nodes…"
                  style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "6px 8px", fontSize: "0.78rem" }}
                  onFocus={e => (e.target.style.borderColor = "var(--teal)")} onBlur={e => (e.target.style.borderColor = "var(--border)")} />
                {searchResults.length > 0 && (
                  <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 2, maxHeight: 150, overflowY: "auto" }}>
                    {searchResults.map(n => (
                      <button key={n.id} onClick={() => focusNode(n.id)}
                        style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 8px", fontSize: "0.73rem", color: "var(--text2)", textAlign: "left" }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>
                        {n.id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {[{ l: "+", fn: zoomIn, title: "Zoom in" }, { l: "−", fn: zoomOut, title: "Zoom out" }, { l: "⊡", fn: fitView, title: "Fit view" }].map(({ l, fn, title }) => (
            <button key={l} onClick={fn} title={title} style={TOOLBAR_BTN}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>{l}</button>
          ))}
          <button onClick={() => handleExport("json")} title="Export JSON" style={TOOLBAR_BTN}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>↓J</button>
          <button onClick={() => handleExport("csv")} title="Export CSV" style={TOOLBAR_BTN}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>↓C</button>
          {(activeNodes.size > 0) && (
            <button onClick={() => { clearSelection(); onHighlightClear?.(); }} title="Clear highlight" style={{ ...TOOLBAR_BTN, borderColor: "rgba(0,212,170,0.3)", color: "var(--teal)" }}>✕HL</button>
          )}
          <button onClick={handleReset} title="Reset graph" style={TOOLBAR_BTN}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--red)"; e.currentTarget.style.color = "var(--red)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>↺</button>
        </div>
      </div>

      {/* status bar */}
      {status && (
        <div style={{ height: statusH, padding: "0 14px", display: "flex", alignItems: "center", fontSize: "0.72rem", color: "var(--amber)", background: "rgba(245,158,11,0.05)", borderBottom: "1px solid rgba(245,158,11,0.1)", flexShrink: 0, overflow: "hidden" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</span>
        </div>
      )}

      {/* graph or empty */}
      {graphData.nodes.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <span style={{ fontSize: "3rem" }}>🕸️</span>
          <p style={{ fontSize: "0.88rem", color: "var(--text2)", textAlign: "center", padding: "0 20px" }}>No graph loaded yet</p>
          <p style={{ fontSize: "0.75rem", color: "var(--muted)", textAlign: "center", padding: "0 20px" }}>Upload a document or click "Load Enterprise Demo"</p>
        </div>
      ) : (
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <ForceGraph2D
            ref={graphRef}
            width={dims.width}
            height={graphH}
            graphData={graphData}
            backgroundColor="#080c12"
            nodeLabel="id"
            nodeRelSize={5}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkCurvature={0.15}
            cooldownTicks={80}
            onEngineStop={fitView}
            onNodeClick={handleNodeClick}
            onNodeHover={(n: any) => setHoveredNode(n ? n.id : null)}
            onBackgroundClick={clearSelection}
            enableZoomInteraction={true}
            enablePanInteraction={true}
            linkColor={(link: any) => {
              const s = typeof link.source === "object" ? link.source.id : link.source;
              const t = typeof link.target === "object" ? link.target.id : link.target;
              if (activeEdges.size > 0) return activeEdges.has(`${s}||${t}`) ? "rgba(0,212,170,0.85)" : "rgba(30,42,58,0.18)";
              return "rgba(30,42,58,0.8)";
            }}
            linkWidth={(link: any) => {
              const s = typeof link.source === "object" ? link.source.id : link.source;
              const t = typeof link.target === "object" ? link.target.id : link.target;
              return activeEdges.has(`${s}||${t}`) ? 2.5 : 0.8;
            }}
            nodeCanvasObject={(node: any, ctx, gs) => {
              const id = node.id as string;
              const isSel = id === selectedNode;
              const isHov = id === hoveredNode;
              const isQHL = qNodes.has(id);
              const isAct = activeNodes.size === 0 || activeNodes.has(id);
              const color = hashColor(id);
              const r = isSel ? 7 : isHov ? 6.5 : 5;
              ctx.globalAlpha = isAct ? 1 : 0.15;
              if (isSel || isHov || isQHL) {
                ctx.beginPath(); ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
                ctx.fillStyle = isQHL ? "rgba(0,212,170,0.18)" : color + "18"; ctx.fill();
              }
              ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.shadowColor = color;
              ctx.shadowBlur = isSel ? 20 : isQHL ? 16 : isHov ? 10 : 4;
              ctx.fill(); ctx.shadowBlur = 0;
              const fs = Math.max(10 / gs, 2.5);
              if (gs > 0.5 || isSel || isHov) {
                ctx.font = `${isSel ? "600 " : ""}${fs}px Inter, sans-serif`;
                ctx.fillStyle = isAct ? "#e2e8f0" : "#2a3a4a";
                ctx.textAlign = "center";
                ctx.fillText(id.length > 22 ? id.slice(0, 20) + "…" : id, node.x, node.y + r + fs + 1);
              }
              ctx.globalAlpha = 1;
            }}
          />

          {/* desktop inspector drawer */}
          {selectedNode && !isMobile && (
            <div className="inspector-drawer fade-in glass" style={{ borderRadius: "var(--radius)" }}>
              <InspectorContent />
            </div>
          )}

          {/* legend */}
          <div style={{ position: "absolute", top: 10, right: 10, display: "flex", flexDirection: "column", gap: 3, zIndex: 10 }}>
            {[{ color: "var(--teal)", label: "Query hit / Selected" }, { color: "rgba(30,42,58,0.9)", label: "Relationship" }].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(8,12,18,0.8)", padding: "3px 8px", borderRadius: 99, backdropFilter: "blur(8px)" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: "0.6rem", color: "var(--text2)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* mobile bottom sheet inspector */}
      {isMobile && (
        <div className={`inspector-sheet${showSheet && selectedNode ? "" : " hidden"}`}>
          <div style={{ width: 40, height: 4, background: "var(--border2)", borderRadius: 99, margin: "10px auto 0" }} />
          {selectedNode && <InspectorContent />}
        </div>
      )}
    </div>
  );
}
