"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph").then((m) => m.ForceGraph2D), {
  ssr: false,
});

interface GraphData {
  nodes: { id: string; label: string }[];
  links: { source: string; target: string; relation: string }[];
}

interface Props {
  graphData: GraphData;
  status: string;
  /** When true, opens an SSE connection to /api/graph-stream to animate the graph build. */
  streaming?: boolean;
  onStreamEnd?: () => void;
}

export default function GraphPanel({ graphData, status, streaming, onStreamEnd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 500 });

  // Resize observer
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
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // SSE stream — always cleaned up on unmount or when streaming flag flips off
  useEffect(() => {
    if (!streaming) return;
    // Fix 3: explicitly close EventSource on unmount to free FastAPI worker threads
    const es = new EventSource("/api/graph-stream");
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.done) {
          es.close();
          onStreamEnd?.();
        }
      } catch {
        // malformed frame — ignore
      }
    };
    es.onerror = () => es.close();
    return () => es.close(); // cleanup on unmount
  }, [streaming, onStreamEnd]);

  return (
    <main style={styles.panel} ref={containerRef}>
      <div style={styles.header}>
        <span style={styles.title}>Knowledge Graph</span>
        <span style={styles.badge}>
          {graphData.nodes.length} nodes · {graphData.links.length} edges
        </span>
      </div>

      {status && <div style={styles.statusBar}>{status}</div>}

      {graphData.nodes.length === 0 ? (
        <div style={styles.empty}>
          <span style={styles.emptyIcon}>🕸️</span>
          <p>Upload a document to watch the graph build in real-time.</p>
        </div>
      ) : (
        <ForceGraph2D
          width={dimensions.width}
          height={dimensions.height - 80}
          graphData={graphData}
          nodeLabel="id"
          nodeColor={() => "#35c9b3"}
          nodeRelSize={5}
          linkLabel="relation"
          linkColor={() => "#212b38"}
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={1}
          linkCurvature={0.1}
          backgroundColor="#0a0e14"
          nodeCanvasObject={(node: any, ctx, globalScale) => {
            const label = node.id as string;
            const fontSize = Math.max(10 / globalScale, 3);
            ctx.font = `${fontSize}px IBM Plex Sans, sans-serif`;
            ctx.fillStyle = "#35c9b3";
            ctx.beginPath();
            ctx.arc(node.x, node.y, 5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.fillStyle = "#e7ecf2";
            ctx.textAlign = "center";
            ctx.fillText(label.length > 20 ? label.slice(0, 18) + "…" : label, node.x, node.y + 10);
          }}
        />
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    position: "relative",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px",
    borderBottom: "1px solid var(--border)",
    background: "var(--panel)",
    flexShrink: 0,
  },
  title: { fontWeight: 600, fontSize: "0.95rem" },
  badge: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: "0.72rem",
    color: "var(--teal)",
    background: "#0f231f",
    border: "1px solid var(--teal-dim)",
    borderRadius: 20,
    padding: "3px 10px",
  },
  statusBar: {
    padding: "8px 18px",
    fontSize: "0.78rem",
    color: "var(--amber)",
    background: "#1a1500",
    borderBottom: "1px solid #4a3a15",
    flexShrink: 0,
  },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    color: "var(--muted)",
    fontSize: "0.9rem",
  },
  emptyIcon: { fontSize: "3rem" },
};
