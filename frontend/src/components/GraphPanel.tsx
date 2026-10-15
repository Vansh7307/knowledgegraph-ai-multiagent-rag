"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphData, GraphNode } from "@/lib/scratchEngine";

interface NodeDetail {
  name: string;
  type: string;
  degree: number;
  pagerank: number;
  in_degree: number;
  out_degree: number;
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
  getNodeDetail: (name: string) => NodeDetail | null;
  onReset: () => void;
}

interface SimNode extends GraphNode { x: number; y: number; vx: number; vy: number; }
const PALETTE: Record<string, string> = {
  Architecture: "#3b82f6", Agent: "#00d4aa", Algorithm: "#8b5cf6", Database: "#f59e0b",
  Component: "#06b6d4", Concept: "#94a3b8", Metric: "#ec4899",
};

export default function GraphPanel({
  graphData, status, queryHighlightNodes = [], queryHighlightEdges = [], pendingFocus,
  onFocusConsumed, onNodeFocus, onHighlightClear, getNodeDetail, onReset,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const viewRef = useRef({ x: 0, y: 0, scale: 1 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const initializedTypesRef = useRef(false);
  const dragRef = useRef<{ mode: "node" | "pan" | "pinch"; node?: SimNode; x: number; y: number; initialDistance?: number; initialScale?: number } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<NodeDetail | null>(null);
  const [search, setSearch] = useState("");
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set());
  const [zoomLabel, setZoomLabel] = useState(100);
  const [showInspector, setShowInspector] = useState(false);
  const highlighted = useMemo(() => new Set(queryHighlightNodes), [queryHighlightNodes]);
  const highlightedEdges = useMemo(() => new Set(queryHighlightEdges.map((edge) => `${edge.source}||${edge.target}`)), [queryHighlightEdges]);
  const nodeTypes = useMemo(() => [...new Set(graphData.nodes.map((node) => node.type))], [graphData.nodes]);

  useEffect(() => {
    const hadNodes = nodesRef.current.length > 0;
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    nodesRef.current = graphData.nodes.map((node, index) => {
      const old = previous.get(node.id);
      const angle = index * 2.39996;
      const radius = 18 * Math.sqrt(index + 1);
      return { ...node, x: old?.x ?? Math.cos(angle) * radius, y: old?.y ?? Math.sin(angle) * radius, vx: old?.vx ?? 0, vy: old?.vy ?? 0 };
    });
    if (!graphData.nodes.length) {
      initializedTypesRef.current = false;
      setVisibleTypes(new Set());
    } else if (!hadNodes || !initializedTypesRef.current) {
      initializedTypesRef.current = true;
      setVisibleTypes(new Set(nodeTypes));
    }
  }, [graphData.nodes, nodeTypes]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      dimensionsRef.current = { width: rect.width, height: rect.height };
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const fitToView = useCallback(() => {
    const nodes = nodesRef.current;
    const { width, height } = dimensionsRef.current;
    if (!nodes.length || !width || !height) return;
    const minX = Math.min(...nodes.map((node) => node.x));
    const maxX = Math.max(...nodes.map((node) => node.x));
    const minY = Math.min(...nodes.map((node) => node.y));
    const maxY = Math.max(...nodes.map((node) => node.y));
    const scale = Math.max(0.25, Math.min(3, Math.min((width - 100) / Math.max(1, maxX - minX + 80), (height - 100) / Math.max(1, maxY - minY + 80))));
    viewRef.current = { x: (minX + maxX) / -2, y: (minY + maxY) / -2, scale };
    setZoomLabel(Math.round(scale * 100));
  }, []);

  useEffect(() => { if (nodesRef.current.length && size.width && size.height) fitToView(); }, [graphData.nodes.length, fitToView, size.width, size.height]);

  useEffect(() => {
    if (!pendingFocus) return;
    const node = nodesRef.current.find((entry) => entry.id === pendingFocus);
    if (node) {
      const { width, height } = dimensionsRef.current;
      viewRef.current = { x: -node.x, y: -node.y, scale: Math.max(2.3, viewRef.current.scale) };
      setZoomLabel(Math.round(viewRef.current.scale * 100));
    }
    onFocusConsumed?.();
  }, [pendingFocus, onFocusConsumed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    let running = true;
    let settleFrames = 120;
    const render = (time: number) => {
      if (!running) return;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = dimensionsRef.current;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#080c12";
      context.fillRect(0, 0, width, height);
      const nodes = nodesRef.current;
      const byName = new Map(nodes.map((node) => [node.id, node]));

      if (settleFrames > 0 || nodes.some((node) => Math.abs(node.vx) + Math.abs(node.vy) > 0.08)) {
        const cellSize = 120;
        const grid = new Map<string, SimNode[]>();
        const cellKey = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
        nodes.forEach((node) => {
          const key = cellKey(node.x, node.y);
          const bucket = grid.get(key) || [];
          bucket.push(node);
          grid.set(key, bucket);
        });
        // Cell-local repulsion bounds the work per node while preserving local Coulomb behavior.
        nodes.forEach((a) => {
          const cellX = Math.floor(a.x / cellSize), cellY = Math.floor(a.y / cellSize);
          const nearby: SimNode[] = [];
          for (let gx = cellX - 1; gx <= cellX + 1; gx += 1) {
            for (let gy = cellY - 1; gy <= cellY + 1; gy += 1) nearby.push(...(grid.get(`${gx},${gy}`) || []));
          }
          nearby.slice(0, 64).forEach((b) => {
            if (a === b) return;
            let dx = a.x - b.x, dy = a.y - b.y;
            const distanceSq = Math.max(25, dx * dx + dy * dy);
            const force = Math.min(1.8, 900 / distanceSq);
            const distance = Math.sqrt(distanceSq);
            dx /= distance; dy /= distance;
            a.vx += dx * force; a.vy += dy * force;
          });
          a.vx -= a.x * 0.002; a.vy -= a.y * 0.002;
        });
        graphData.links.forEach((edge) => {
          const a = byName.get(edge.source), b = byName.get(edge.target);
          if (!a || !b) return;
          const dx = b.x - a.x, dy = b.y - a.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const force = (distance - 100) * 0.0008;
          a.vx += dx / distance * force; a.vy += dy / distance * force;
          b.vx -= dx / distance * force; b.vy -= dy / distance * force;
        });
        nodes.forEach((node) => {
          node.vx *= 0.86; node.vy *= 0.86;
          node.x += node.vx; node.y += node.vy;
        });
        settleFrames = Math.max(0, settleFrames - 1);
      }

      const { x: panX, y: panY, scale } = viewRef.current;
      context.save();
      context.translate(width / 2 + panX * scale, height / 2 + panY * scale);
      context.scale(scale, scale);
      graphData.links.forEach((edge) => {
        const source = byName.get(edge.source), target = byName.get(edge.target);
        if (!source || !target) return;
        const active = highlightedEdges.has(`${edge.source}||${edge.target}`);
        context.strokeStyle = highlighted.size && !active ? "rgba(40,56,72,.18)" : active ? `rgba(0,230,200,${0.65 + Math.sin(time / 250) * 0.25})` : "rgba(45,62,80,.75)";
        context.lineWidth = active ? 2 / scale : 0.7 / scale;
        context.beginPath(); context.moveTo(source.x, source.y); context.lineTo(target.x, target.y); context.stroke();
      });
      nodes.forEach((node) => {
        if (!visibleTypes.has(node.type)) return;
        const active = !highlighted.size || highlighted.has(node.id);
        const radius = Math.min(11, 4 + Math.sqrt(node.degree) * 0.8);
        const color = PALETTE[node.type] || "#94a3b8";
        context.globalAlpha = active ? 1 : 0.14;
        if (highlighted.has(node.id)) {
          context.beginPath(); context.arc(node.x, node.y, radius + 6 + Math.sin(time / 250) * 2, 0, Math.PI * 2);
          context.fillStyle = "rgba(0,212,170,.15)"; context.fill();
        }
        context.beginPath(); context.arc(node.x, node.y, radius, 0, Math.PI * 2);
        context.fillStyle = color; context.shadowColor = color; context.shadowBlur = selected?.name === node.id ? 18 : 6; context.fill(); context.shadowBlur = 0;
        if (scale > 0.65 || selected?.name === node.id) {
          context.fillStyle = active ? "#dce6ef" : "#344252";
          context.font = `${Math.max(8, 11 / scale)}px Inter, sans-serif`;
          context.textAlign = "center";
          const label = node.id.length > 24 ? `${node.id.slice(0, 22)}…` : node.id;
          context.fillText(label, node.x, node.y + radius + 13 / scale);
        }
        context.globalAlpha = 1;
      });
      context.restore();
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => { running = false; cancelAnimationFrame(frame); };
  }, [graphData.links, highlighted, highlightedEdges, selected, visibleTypes]);

  const worldPoint = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const view = viewRef.current;
    return { x: (clientX - rect.left - rect.width / 2) / view.scale - view.x, y: (clientY - rect.top - rect.height / 2) / view.scale - view.y };
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 2) {
      const [first, second] = [...pointersRef.current.values()];
      dragRef.current = { mode: "pinch", x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, initialDistance: Math.hypot(first.x - second.x, first.y - second.y), initialScale: viewRef.current.scale };
      return;
    }
    const point = worldPoint(event.clientX, event.clientY);
    const node = [...nodesRef.current].reverse().find((entry) => Math.hypot(entry.x - point.x, entry.y - point.y) < 18 / viewRef.current.scale);
    dragRef.current = node ? { mode: "node", node, x: event.clientX, y: event.clientY } : { mode: "pan", x: event.clientX, y: event.clientY };
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === "pinch" && pointersRef.current.size > 1) {
      const [first, second] = [...pointersRef.current.values()];
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const rect = canvasRef.current?.getBoundingClientRect();
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const world = worldPoint(center.x, center.y);
      const scale = Math.min(5, Math.max(0.2, (drag.initialScale || 1) * distance / Math.max(1, drag.initialDistance || 1)));
      if (rect) {
        viewRef.current.x = (center.x - rect.left - rect.width / 2) / scale - world.x;
        viewRef.current.y = (center.y - rect.top - rect.height / 2) / scale - world.y;
      }
      viewRef.current.scale = scale;
    } else if (drag.mode === "node" && drag.node) {
      const point = worldPoint(event.clientX, event.clientY);
      drag.node.x = point.x; drag.node.y = point.y; drag.node.vx = 0; drag.node.vy = 0;
    } else if (drag.mode === "pan") {
      viewRef.current.x += (event.clientX - drag.x) / viewRef.current.scale;
      viewRef.current.y += (event.clientY - drag.y) / viewRef.current.scale;
      drag.x = event.clientX; drag.y = event.clientY;
    }
    setZoomLabel(Math.round(viewRef.current.scale * 100));
  };
  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag?.mode === "node" && drag.node && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) {
      const detail = getNodeDetail(drag.node.id);
      setSelected(detail);
      setShowInspector(true);
      onNodeFocus?.(drag.node.id);
    }
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 1) {
      const remaining = [...pointersRef.current.values()][0];
      dragRef.current = { mode: "pan", x: remaining.x, y: remaining.y };
    } else if (!pointersRef.current.size) {
      dragRef.current = null;
    }
  };
  const zoom = (factor: number) => {
    viewRef.current.scale = Math.max(0.2, Math.min(5, viewRef.current.scale * factor));
    setZoomLabel(Math.round(viewRef.current.scale * 100));
  };
  const exportGraph = (format: "json" | "csv") => {
    const content = format === "json"
      ? JSON.stringify(graphData, null, 2)
      : ["source,target,relation,chunk_id", ...graphData.links.map((edge) => [edge.source, edge.target, edge.relation, edge.chunk_id].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `knowledge_graph.${format}`; link.click();
    URL.revokeObjectURL(link.href);
  };
  const filteredNodes = graphData.nodes.filter((node) => node.id.toLowerCase().includes(search.toLowerCase())).slice(0, 8);

  return (
    <section style={{ display: "flex", flexDirection: "column", minWidth: 0, height: "100%", overflow: "hidden", background: "#080c12" }}>
      <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search entities…" aria-label="Search graph nodes" style={{ minWidth: 90, flex: 1, maxWidth: 230, background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", color: "var(--text)", fontSize: "0.72rem" }} />
          {filteredNodes.length > 0 && search.length >= 2 && <select aria-label="Search results" onChange={(event) => {
            const node = nodesRef.current.find((entry) => entry.id === event.target.value);
            if (node) {
              const scale = Math.max(2, viewRef.current.scale);
              viewRef.current = { x: -node.x, y: -node.y, scale };
              setZoomLabel(Math.round(scale * 100));
              setSelected(getNodeDetail(node.id)); setShowInspector(true);
            }
          }} defaultValue="" style={{ maxWidth: 180, background: "var(--panel2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 5, padding: 5 }}>
            <option value="" disabled>Focus result</option>{filteredNodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
          </select>}
          <button className="graph-control" onClick={() => zoom(1.25)} title="Zoom in">＋</button>
          <button className="graph-control" onClick={() => zoom(0.8)} title="Zoom out">−</button>
          <button className="graph-control" onClick={fitToView} title="Fit to view">Fit</button>
          <span style={{ color: "var(--muted)", fontSize: "0.62rem", minWidth: 34 }}>{zoomLabel}%</span>
          <button className="graph-control" onClick={() => exportGraph("json")} title="Export JSON">JSON</button>
          <button className="graph-control" onClick={() => exportGraph("csv")} title="Export CSV">CSV</button>
          <button className="graph-control" onClick={() => { setSelected(null); onHighlightClear?.(); }} title="Clear highlight">Clear</button>
          <button className="graph-control" onClick={() => { setSelected(null); setShowInspector(false); onReset(); }} title="Reset graph">Reset</button>
        </div>
        <div style={{ display: "flex", gap: 5, overflowX: "auto", whiteSpace: "nowrap" }}>
          {nodeTypes.map((type) => <button key={type} onClick={() => setVisibleTypes((current) => {
            const next = new Set(current);
            if (next.has(type)) next.delete(type); else next.add(type);
            return next;
          })} style={{ borderRadius: 99, padding: "3px 8px", background: visibleTypes.has(type) ? `${PALETTE[type]}22` : "transparent", border: `1px solid ${visibleTypes.has(type) ? PALETTE[type] : "var(--border)"}`, color: visibleTypes.has(type) ? PALETTE[type] : "var(--muted)", fontSize: "0.62rem" }}>{type}</button>)}
        </div>
      </div>
      {status && <div style={{ padding: "5px 12px", borderBottom: "1px solid var(--border)", fontSize: "0.67rem", color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status}</div>}
      <div ref={hostRef} style={{ position: "relative", minHeight: 0, flex: 1, touchAction: "none" }}>
        {graphData.nodes.length ? <canvas ref={canvasRef} width={size.width} height={size.height} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onWheel={(event) => zoom(event.deltaY < 0 ? 1.1 : 0.9)} style={{ width: "100%", height: "100%", display: "block", cursor: "grab", touchAction: "none" }} /> : (
          <div style={{ height: "100%", display: "grid", placeContent: "center", textAlign: "center", padding: 20 }}>
            <div style={{ fontSize: "2.5rem" }}>🕸️</div><strong style={{ margin: "8px 0" }}>Your local graph is ready</strong>
            <span style={{ color: "var(--text2)", fontSize: "0.75rem" }}>Load the built-in corpus or add a text/PDF file.</span>
          </div>
        )}
        {selected && <aside className={`${size.width < 1024 ? "inspector-sheet" : "inspector-drawer"} glass${showInspector ? "" : " hidden"}`} style={{ borderRadius: 10, maxHeight: 380, ...(size.width < 1024 ? { display: showInspector ? "block" : "none", bottom: 68 } : {}) }}>
          <div style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div><strong style={{ color: PALETTE[selected.type] }}>{selected.name}</strong><div style={{ color: "var(--muted)", fontSize: "0.65rem" }}>{selected.type}</div></div>
              <button onClick={() => { setSelected(null); setShowInspector(false); }} aria-label="Close inspector">✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, margin: "10px 0" }}>
              {[["Rank", selected.pagerank.toFixed(3)], ["Degree", selected.degree], ["In", selected.in_degree], ["Out", selected.out_degree]].map(([label, value]) => <div key={label} style={{ textAlign: "center", background: "var(--panel2)", padding: 5, borderRadius: 5 }}><b>{value}</b><div style={{ color: "var(--muted)", fontSize: "0.58rem" }}>{label}</div></div>)}
            </div>
            <b style={{ fontSize: "0.68rem" }}>Incoming / outgoing triplets</b>
            <div style={{ maxHeight: 110, overflow: "auto", margin: "5px 0 8px" }}>
              {selected.triplets.map((triplet, index) => <div key={`${triplet.chunk_id}-${index}`} style={{ fontSize: "0.65rem", color: "var(--text2)", marginBottom: 3 }}>{triplet.subject} → <span style={{ color: "var(--teal)" }}>{triplet.predicate}</span> → {triplet.object}</div>)}
            </div>
            <b style={{ fontSize: "0.68rem" }}>Source chunks</b>
            {selected.source_chunks.map((chunk) => <div key={chunk.id} style={{ color: "var(--text2)", fontSize: "0.63rem", marginTop: 5 }}><b>{chunk.source}</b><div>{chunk.text}</div></div>)}
          </div>
        </aside>}
        {size.width < 1024 && selected && <button onClick={() => setShowInspector((shown) => !shown)} style={{ position: "absolute", bottom: 12, right: 12, padding: "7px 10px", borderRadius: 20, background: "var(--teal)", color: "#06110f", fontWeight: 700 }}>Node details</button>}
      </div>
    </section>
  );
}
