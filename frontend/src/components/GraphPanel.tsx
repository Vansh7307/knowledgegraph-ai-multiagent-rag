"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph").then((m) => m.ForceGraph2D), { ssr: false });

interface GraphData {
  nodes: { id: string; label: string }[];
  links: { source: string; target: string; relation: string }[];
}

interface Props {
  graphData: GraphData;
  status: string;
  streaming?: boolean;
  onStreamEnd?: () => void;
}

const NODE_COLORS = ["#00d4aa", "#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4"];

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return NODE_COLORS[Math.abs(h) % NODE_COLORS.length];
}

export default function GraphPanel({ graphData, status, streaming, onStreamEnd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<string>>(new Set());

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!streaming) return;
    const es = new EventSource("/api/graph-stream");
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.done) { es.close(); onStreamEnd?.(); }
      } catch { /* ignore malformed frames */ }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [streaming, onStreamEnd]);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node.id === selectedNode ? null : node.id);
    const connected = new Set<string>();
    const connectedLinks = new Set<string>();
    graphData.links.forEach(l => {
      const src = typeof l.source === "object" ? (l.source as any).id : l.source;
      const tgt = typeof l.target === "object" ? (l.target as any).id : l.target;
      if (src === node.id || tgt === node.id) {
        connected.add(src);
        connected.add(tgt);
        connectedLinks.add(`${src}-${tgt}`);
      }
    });
    setHighlightNodes(connected);
    setHighlightLinks(connectedLinks);
  }, [selectedNode, graphData.links]);

  const handleNodeHover = useCallback((node: any) => {
    setHoveredNode(node ? node.id : null);
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedNode(null);
    setHighlightNodes(new Set());
    setHighlightLinks(new Set());
  }, []);

  const zoomIn  = () => graphRef.current?.zoom(graphRef.current.zoom() * 1.3, 300);
  const zoomOut = () => graphRef.current?.zoom(graphRef.current.zoom() * 0.75, 300);
  const fitView = () => graphRef.current?.zoomToFit(400, 40);

  const selectedNodeLinks = selectedNode
    ? graphData.links.filter(l => {
        const src = typeof l.source === "object" ? (l.source as any).id : l.source;
        const tgt = typeof l.target === "object" ? (l.target as any).id : l.target;
        return src === selectedNode || tgt === selectedNode;
      })
    : [];

  return (
    <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", background: "var(--bg)" }} ref={containerRef}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--panel)", flexShrink: 0, zIndex: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Knowledge Graph</span>
          <span className="badge badge-blue">
            {graphData.nodes.length} nodes
          </span>
          <span className="badge badge-purple">
            {graphData.links.length} edges
          </span>
          {streaming && (
            <span className="badge badge-amber">
              <span className="spin" style={{ width: 8, height: 8, border: "1.5px solid var(--amber-dim)", borderTopColor: "var(--amber)", borderRadius: "50%", display: "inline-block" }} />
              Building…
            </span>
          )}
        </div>
        {/* Zoom controls */}
        <div style={{ display: "flex", gap: 4 }}>
          {[{ label: "+", fn: zoomIn }, { label: "−", fn: zoomOut }, { label: "⊡", fn: fitView }].map(({ label, fn }) => (
            <button key={label} onClick={fn} style={{ width: 28, height: 28, borderRadius: "var(--radius-sm)", background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Status bar */}
      {status && (
        <div style={{ padding: "6px 16px", fontSize: "0.75rem", color: "var(--amber)", background: "rgba(245,158,11,0.06)", borderBottom: "1px solid rgba(245,158,11,0.12)", flexShrink: 0 }}>
          {status}
        </div>
      )}

      {/* Graph or empty state */}
      {graphData.nodes.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, color: "var(--muted)" }}>
          <div style={{ fontSize: "3.5rem", filter: "grayscale(0.3)" }}>🕸️</div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: "0.9rem", color: "var(--text2)", marginBottom: 6 }}>No graph loaded yet</p>
            <p style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Upload a document or click "Load Demo Graph" to begin</p>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, position: "relative" }}>
          <ForceGraph2D
            ref={graphRef}
            width={dimensions.width}
            height={dimensions.height - (status ? 88 : 52)}
            graphData={graphData}
            backgroundColor="#080c12"
            nodeLabel="id"
            nodeRelSize={5}
            linkColor={(link: any) => {
              const src = typeof link.source === "object" ? link.source.id : link.source;
              const tgt = typeof link.target === "object" ? link.target.id : link.target;
              const key = `${src}-${tgt}`;
              if (highlightLinks.size > 0) return highlightLinks.has(key) ? "rgba(0,212,170,0.7)" : "rgba(30,42,58,0.3)";
              return "rgba(30,42,58,0.8)";
            }}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkCurvature={0.15}
            linkWidth={(link: any) => {
              const src = typeof link.source === "object" ? link.source.id : link.source;
              const tgt = typeof link.target === "object" ? link.target.id : link.target;
              return highlightLinks.has(`${src}-${tgt}`) ? 2 : 0.8;
            }}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            onBackgroundClick={handleBackgroundClick}
            nodeCanvasObject={(node: any, ctx, globalScale) => {
              const isHighlighted = highlightNodes.has(node.id) || highlightNodes.size === 0;
              const isSelected = node.id === selectedNode;
              const isHovered = node.id === hoveredNode;
              const color = hashColor(node.id);
              const r = isSelected ? 7 : isHovered ? 6.5 : 5;
              const alpha = isHighlighted ? 1 : 0.25;

              ctx.globalAlpha = alpha;

              if (isSelected || isHovered) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, r + 4, 0, 2 * Math.PI);
                ctx.fillStyle = color + "22";
                ctx.fill();
              }

              ctx.beginPath();
              ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.shadowColor = color;
              ctx.shadowBlur = isSelected ? 16 : isHovered ? 10 : 4;
              ctx.fill();
              ctx.shadowBlur = 0;

              const fontSize = Math.max(10 / globalScale, 2.5);
              if (globalScale > 0.6 || isSelected || isHovered) {
                ctx.font = `${isSelected ? "600 " : ""}${fontSize}px Inter, sans-serif`;
                ctx.fillStyle = isHighlighted ? "#e2e8f0" : "#4a5568";
                ctx.textAlign = "center";
                const label = node.id.length > 22 ? node.id.slice(0, 20) + "…" : node.id;
                ctx.fillText(label, node.x, node.y + r + fontSize + 1);
              }

              ctx.globalAlpha = 1;
            }}
            cooldownTicks={80}
            onEngineStop={fitView}
          />

          {/* Selected node detail card */}
          {selectedNode && (
            <div className="fade-in glass" style={{
              position: "absolute",
              bottom: 16,
              left: 16,
              maxWidth: 280,
              borderRadius: "var(--radius)",
              padding: "12px 14px",
              zIndex: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: hashColor(selectedNode) }}>{selectedNode}</span>
                <button onClick={handleBackgroundClick} style={{ background: "none", color: "var(--muted)", fontSize: "0.9rem", padding: 2 }}>✕</button>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text2)", marginBottom: 6 }}>
                {selectedNodeLinks.length} connection{selectedNodeLinks.length !== 1 ? "s" : ""}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto" }}>
                {selectedNodeLinks.slice(0, 8).map((l, i) => {
                  const src = typeof l.source === "object" ? (l.source as any).id : l.source;
                  const tgt = typeof l.target === "object" ? (l.target as any).id : l.target;
                  const isOut = src === selectedNode;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.7rem" }}>
                      <span style={{ color: isOut ? "var(--teal)" : "var(--blue)", flexShrink: 0 }}>{isOut ? "→" : "←"}</span>
                      <span style={{ color: "var(--muted)", fontFamily: "JetBrains Mono, monospace", fontSize: "0.65rem" }}>{l.relation}</span>
                      <span style={{ color: "var(--text2)" }}>{isOut ? tgt : src}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Legend */}
          <div style={{ position: "absolute", top: 12, right: 12, display: "flex", flexDirection: "column", gap: 4, zIndex: 10 }}>
            {[
              { color: "var(--teal)", label: "Selected / Connected" },
              { color: "rgba(30,42,58,0.8)", label: "Relationship edge" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(8,12,18,0.75)", padding: "3px 8px", borderRadius: 99, backdropFilter: "blur(8px)" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                <span style={{ fontSize: "0.65rem", color: "var(--text2)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
