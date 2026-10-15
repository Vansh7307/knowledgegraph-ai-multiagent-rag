"use client";
import { useEffect, useState } from "react";
import axios from "axios";
import IngestionPanel from "@/components/IngestionPanel";
import GraphPanel from "@/components/GraphPanel";
import ChatPanel from "@/components/ChatPanel";

interface GraphData {
  nodes: { id: string; label: string }[];
  links: { source: string; target: string; relation: string }[];
}

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };

export default function Home() {
  const [graphData, setGraphData] = useState<GraphData>(EMPTY_GRAPH);
  const [status, setStatus] = useState("Connecting to backend…");
  const [streaming, setStreaming] = useState(false);

  // Fix 4: use /api/* proxy path — never hardcode http://localhost:8000
  useEffect(() => {
    axios
      .get("/api/graph-data")
      .then(({ data }) => {
        setGraphData(data);
        setStatus(
          data.nodes.length > 0
            ? `Graph loaded: ${data.nodes.length} nodes, ${data.links.length} edges`
            : "Ready — upload a document to build the graph."
        );
      })
      .catch(() => setStatus("Backend offline — start the FastAPI server."));
  }, []);

  const handleGraphUpdate = (graph: GraphData) => {
    setGraphData(graph);
    // Trigger SSE stream so the graph animates node-by-node after ingestion
    setStreaming(true);
  };

  return (
    <div style={styles.root}>
      <header style={styles.topbar}>
        <div style={styles.logo}>
          <span style={styles.dot} />
          KnowledgeGraph AI
        </div>
        <span style={styles.tagline}>Multi-Agent GraphRAG · Extractor · Router · Synthesizer</span>
      </header>

      <div style={styles.body}>
        <IngestionPanel onGraphUpdate={handleGraphUpdate} onStatus={setStatus} />
        <GraphPanel
          graphData={graphData}
          status={status}
          streaming={streaming}
          onStreamEnd={() => setStreaming(false)}
        />
        <ChatPanel />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 20px",
    height: 48,
    background: "var(--panel)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontWeight: 700,
    fontSize: "0.95rem",
    letterSpacing: "-0.01em",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "var(--teal)",
    boxShadow: "0 0 8px var(--teal)",
    display: "inline-block",
  },
  tagline: {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: "0.7rem",
    color: "var(--muted)",
    letterSpacing: "0.04em",
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
};
