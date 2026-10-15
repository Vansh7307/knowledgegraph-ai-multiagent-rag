"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import axios from "axios";
import { toast } from "./Toast";

const ForceGraph2D = dynamic(() => import("react-force-graph").then((m) => m.ForceGraph2D), { ssr: false });

interface GraphData {
  nodes: { id: string; label: string }[];
  links: { source: string; target: string; relation: string }[];
}

interface NodeDetail {
  name: string;
  degree: number;
  in_degree: number;
  out_degree: number;
  triplets: { subject: string; predicate: string; object: string; chunk_id: string }[];
  source_chunks: { id: string; source: string; text: string }[];
}

interface Props {
  graphData: GraphData;
  status: string;
  streaming?: boolean;
  onStreamEnd?: () => void;
  queryHighlightNodes?: string[];
  queryHighlightEdges?: { source: string; target: string }[];
  onNodeFocus?: (name: string) => void;
}

const NODE_COLORS = ["#00d4aa", "#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4"];
function hashColor(s: string) {
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffffff;
  return NODE_COLORS[Math.abs(h) % NODE_COLORS.length];
}

export default function GraphPanel({ graphData, status, streaming, onStreamEnd, queryHighlightNodes = [], queryHighlightEdges = [], onNodeFocus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef     = useRef<any>(null);
  const [dims,           setDims]           = useState({ width: 600, height: 500 });
  const [selectedNode,   setSelectedNode]   = useState<string | null>(null);
  const [hoveredNode,    setHoveredNode]     = useState<string | null>(null);
  const [clickHighlight, setClickHighlight] = useState<Set<string>>(new Set());
  const [clickEdges,     setClickEdges]     = useState<Set<string>>(new Set());
  const [nodeDetail,     setNodeDetail]     = useState<NodeDetail | null>(null);
  const [detailLoading,  setDetailLoading]  = useState(false);
  const [searchQ,        setSearchQ]        = useState("");
  const [showSearch,     setShowSearch]     = useState(false);
  const [showChunks,     setShowChunks]     = useState(false);

  /* resize */
  useEffect(() => {
    const update = () => { if (containerRef.current) setDims({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight }); };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  /* SSE stream */
  useEffect(() => {
    if (!streaming) return;
    const es = new EventSource("/api/graph-stream");
    es.onmessage = (e) => { try { const p = JSON.parse(e.data); if (p.done) { es.close(); onStreamEnd?.(); } } catch {} };
    es.onerror = () => es.close();
    return () => es.close();
  }, [streaming, onStreamEnd]);

  /* node click → highlight + fetch detail */
  const handleNodeClick = useCallback(async (node: any) => {
    const id = node.id as string;
    if (id === selectedNode) { setSelectedNode(null); setClickHighlight(new Set()); setClickEdges(new Set()); setNodeDetail(null); return; }
    setSelectedNode(id);
    const conn = new Set<string>([id]);
    const edgeKeys = new Set<string>();
    graphData.links.forEach(l => {
      const s = typeof l.source === "object" ? (l.source as any).id : l.source;
      const t = typeof l.target === "object" ? (l.target as any).id : l.target;
      if (s === id || t === id) { conn.add(s); conn.add(t); edgeKeys.add(`${s}||${t}`); }
    });
    setClickHighlight(conn); setClickEdges(edgeKeys);
    setDetailLoading(true); setNodeDetail(null); setShowChunks(false);
    try {
      const { data } = await axios.get<NodeDetail>(`/api/node-detail?name=${encodeURIComponent(id)}`);
      setNodeDetail(data);
    } catch { /* node detail unavailable */ }
    finally { setDetailLoading(false); }
    onNodeFocus?.(id);
  }, [selectedNode, graphData.links, onNodeFocus]);

  const clearSelection = useCallback(() => {
    setSelectedNode(null); setClickHighlight(new Set()); setClickEdges(new Set()); setNodeDetail(null);
  }, []);

  /* search focus */
  const focusNode = (name: string) => {
    const node = (graphRef.current as any)?._graphData?.nodes?.find((n: any) => n.id === name);
    if (node) { graphRef.current?.centerAt(node.x, node.y, 600); graphRef.current?.zoom(3, 600); }
    setSearchQ(""); setShowSearch(false);
  };

  /* export */
  const handleExport = async (fmt: "json" | "csv") => {
    try {
      const r = await axios.get(`/api/export?fmt=${fmt}`, { responseType: "blob" });
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a"); a.href = url; a.download = `knowledge_graph.${fmt}`; a.click();
      URL.revokeObjectURL(url); toast(`Exported as ${fmt.toUpperCase()}`, "success");
    } catch { toast("Export failed", "error"); }
  };

  /* reset */
  const handleReset = async () => {
    clearSelection();
    try {
      const { data } = await axios.get("/api/graph-data");
      toast(`Graph reset — ${data.nodes.length} nodes`, "info");
    } catch { toast("Reset failed", "error"); }
  };

  const zoomIn  = () => graphRef.current?.zoom(graphRef.current.zoom() * 1.3, 300);
  const zoomOut = () => graphRef.current?.zoom(graphRef.current.zoom() * 0.75, 300);
  const fitView = () => graphRef.current?.zoomToFit(400, 40);

  /* combined highlight sets */
  const qNodes = new Set(queryHighlightNodes);
  const qEdges = new Set(queryHighlightEdges.map(e => `${e.source}||${e.target}`));
  const activeNodes = clickHighlight.size > 0 ? clickHighlight : qNodes;
  const activeEdges = clickEdges.size > 0 ? clickEdges : qEdges;

  /* search results */
  const searchResults = searchQ.length >= 2
    ? graphData.nodes.filter(n => n.id.toLowerCase().includes(searchQ.toLowerCase())).slice(0, 12)
    : [];

  const headerH = 44;
  const statusH = status ? 30 : 0;
  const graphH  = dims.height - headerH - statusH;

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", background: "var(--bg)" }} ref={containerRef}>

      {/* ── toolbar ── */}
      <div style={{ height: headerH, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0, zIndex: 2, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: "0.83rem", fontWeight: 600 }}>Knowledge Graph</span>
          <span className="badge badge-blue" style={{ fontSize: "0.62rem" }}>{graphData.nodes.length} nodes</span>
          <span className="badge badge-purple" style={{ fontSize: "0.62rem" }}>{graphData.links.length} edges</span>
          {streaming && <span className="badge badge-amber" style={{ fontSize: "0.62rem" }}><span className="spin" style={{ width: 8, height: 8, border: "1.5px solid var(--amber-dim)", borderTopColor: "var(--amber)", borderRadius: "50%", display: "inline-block" }} /> Building…</span>}
          {qNodes.size > 0 && <span className="badge badge-teal" style={{ fontSize: "0.62rem" }}>⚡ {qNodes.size} highlighted</span>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {/* search */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setShowSearch(s => !s)} title="Search nodes" style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: showSearch ? "var(--teal-dim)" : "var(--panel2)", border: `1px solid ${showSearch ? "rgba(0,212,170,0.3)" : "var(--border)"}`, color: showSearch ? "var(--teal)" : "var(--text2)", fontSize: "0.8rem", display: "flex", alignItems: "center", justifyContent: "center" }}>🔍</button>
            {showSearch && (
              <div style={{ position: "absolute", top: 34, right: 0, width: 220, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 8, zIndex: 20, boxShadow: "var(--shadow)" }}>
                <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search nodes…" style={{ width: "100%", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)", padding: "6px 8px", fontSize: "0.78rem" }} onFocus={e => (e.target.style.borderColor = "var(--teal)")} onBlur={e => (e.target.style.borderColor = "var(--border)")} />
                {searchResults.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2, maxHeight: 160, overflowY: "auto" }}>
                    {searchResults.map(n => (
                      <button key={n.id} onClick={() => focusNode(n.id)} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 8px", fontSize: "0.75rem", color: "var(--text2)", textAlign: "left" }}
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

          {/* zoom controls */}
          {[{ l: "+", fn: zoomIn }, { l: "−", fn: zoomOut }, { l: "⊡", fn: fitView }].map(({ l, fn }) => (
            <button key={l} onClick={fn} style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>{l}</button>
          ))}

          {/* export */}
          <button onClick={() => handleExport("json")} title="Export JSON" style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.72rem", display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>↓J</button>
          <button onClick={() => handleExport("csv")} title="Export CSV" style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.72rem", display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>↓C</button>

          {/* reset */}
          <button onClick={handleReset} title="Reset view" style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.8rem", display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--red)"; e.currentTarget.style.color = "var(--red)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>↺</button>
        </div>
      </div>

      {/* ── status bar ── */}
      {status && (
        <div style={{ height: statusH, padding: "0 16px", display: "flex", alignItems: "center", fontSize: "0.73rem", color: "var(--amber)", background: "rgba(245,158,11,0.05)", borderBottom: "1px solid rgba(245,158,11,0.1)", flexShrink: 0 }}>
          {status}
        </div>
      )}

      {/* ── graph canvas or empty state ── */}
      {graphData.nodes.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <span style={{ fontSize: "3rem" }}>🕸️</span>
          <p style={{ fontSize: "0.88rem", color: "var(--text2)" }}>No graph loaded yet</p>
          <p style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Upload a document or click "Load Enterprise Demo"</p>
        </div>
      ) : (
        <div style={{ flex: 1, position: "relative" }}>
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
            linkColor={(link: any) => {
              const s = typeof link.source === "object" ? link.source.id : link.source;
              const t = typeof link.target === "object" ? link.target.id : link.target;
              const key = `${s}||${t}`;
              if (activeEdges.size > 0) return activeEdges.has(key) ? "rgba(0,212,170,0.8)" : "rgba(30,42,58,0.2)";
              return "rgba(30,42,58,0.8)";
            }}
            linkWidth={(link: any) => {
              const s = typeof link.source === "object" ? link.source.id : link.source;
              const t = typeof link.target === "object" ? link.target.id : link.target;
              return activeEdges.has(`${s}||${t}`) ? 2.5 : 0.8;
            }}
            nodeCanvasObject={(node: any, ctx, gs) => {
              const id = node.id as string;
              const isSel  = id === selectedNode;
              const isHov  = id === hoveredNode;
              const isAct  = activeNodes.size === 0 || activeNodes.has(id);
              const isQHL  = qNodes.has(id);
              const color  = hashColor(id);
              const r      = isSel ? 7 : isHov ? 6.5 : 5;
              ctx.globalAlpha = isAct ? 1 : 0.18;
              if (isSel || isHov || isQHL) {
                ctx.beginPath(); ctx.arc(node.x, node.y, r + 5, 0, 2 * Math.PI);
                ctx.fillStyle = isQHL ? "rgba(0,212,170,0.15)" : color + "18"; ctx.fill();
              }
              ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.shadowColor = color; ctx.shadowBlur = isSel ? 18 : isQHL ? 14 : isHov ? 10 : 4;
              ctx.fill(); ctx.shadowBlur = 0;
              const fs = Math.max(10 / gs, 2.5);
              if (gs > 0.55 || isSel || isHov) {
                ctx.font = `${isSel ? "600 " : ""}${fs}px Inter, sans-serif`;
                ctx.fillStyle = isAct ? "#e2e8f0" : "#3a4a5a";
                ctx.textAlign = "center";
                ctx.fillText(id.length > 22 ? id.slice(0, 20) + "…" : id, node.x, node.y + r + fs + 1);
              }
              ctx.globalAlpha = 1;
            }}
          />

          {/* ── Node Inspector drawer ── */}
          {selectedNode && (
            <div className="fade-in glass" style={{ position: "absolute", bottom: 14, left: 14, width: 300, maxHeight: 340, borderRadius: "var(--radius)", padding: "12px 14px", zIndex: 10, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700, color: hashColor(selectedNode) }}>{selectedNode}</span>
                <button onClick={clearSelection} style={{ background: "none", color: "var(--muted)", fontSize: "0.85rem" }}>✕</button>
              </div>

              {detailLoading && <div className="skeleton" style={{ height: 60, borderRadius: "var(--radius-sm)" }} />}

              {nodeDetail && !detailLoading && (
                <>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[["Degree", nodeDetail.degree], ["In", nodeDetail.in_degree], ["Out", nodeDetail.out_degree]].map(([l, v]) => (
                      <div key={l as string} style={{ flex: 1, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 6px", textAlign: "center" }}>
                        <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--teal)", fontFamily: "JetBrains Mono, monospace" }}>{v}</div>
                        <div style={{ fontSize: "0.6rem", color: "var(--muted)" }}>{l}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: "0.68rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Triplets</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto" }}>
                    {nodeDetail.triplets.slice(0, 10).map((t, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem", background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 7px" }}>
                        <span style={{ color: "var(--teal)", fontWeight: 600, flexShrink: 0 }}>{t.subject === selectedNode ? "→" : "←"}</span>
                        <span style={{ color: "var(--muted)", fontFamily: "JetBrains Mono, monospace", fontSize: "0.62rem", flexShrink: 0 }}>{t.predicate}</span>
                        <span style={{ color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject === selectedNode ? t.object : t.subject}</span>
                      </div>
                    ))}
                  </div>

                  {nodeDetail.source_chunks.length > 0 && (
                    <>
                      <button onClick={() => setShowChunks(s => !s)} style={{ background: "none", color: "var(--text2)", fontSize: "0.7rem", textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ color: "var(--teal)" }}>{showChunks ? "▾" : "▸"}</span> Source Context ({nodeDetail.source_chunks.length})
                      </button>
                      {showChunks && nodeDetail.source_chunks.map(c => (
                        <div key={c.id} style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 9px" }}>
                          <div style={{ fontSize: "0.62rem", color: "var(--muted)", marginBottom: 3, fontFamily: "JetBrains Mono, monospace" }}>{c.source}</div>
                          <div style={{ fontSize: "0.72rem", color: "var(--text2)", lineHeight: 1.5 }}>{c.text}</div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── legend ── */}
          <div style={{ position: "absolute", top: 10, right: 10, display: "flex", flexDirection: "column", gap: 3, zIndex: 10 }}>
            {[{ color: "var(--teal)", label: "Selected / Query hit" }, { color: "rgba(30,42,58,0.9)", label: "Relationship" }].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(8,12,18,0.8)", padding: "3px 8px", borderRadius: 99, backdropFilter: "blur(8px)" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: "0.62rem", color: "var(--text2)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
