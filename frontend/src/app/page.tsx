"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IngestionPanel from "@/components/IngestionPanel";
import GraphPanel from "@/components/GraphPanel";
import ChatPanel from "@/components/ChatPanel";
import { ToastContainer, toast } from "@/components/Toast";
import { chunkText, demoChunks, extractPdfText, ScratchGraphRAG, type GraphData, type TextChunk } from "@/lib/scratchEngine";

type MobileTab = "ingest" | "graph" | "chat";
const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };

export default function Home() {
  const engine = useRef(new ScratchGraphRAG());
  const backendAvailable = useRef(false);
  const [graphData, setGraphData] = useState<GraphData>(EMPTY_GRAPH);
  const [mobileTab, setMobileTab] = useState<MobileTab>("graph");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [status, setStatus] = useState("All processing runs locally in this browser.");
  const [highlightNodes, setHighlightNodes] = useState<string[]>([]);
  const [highlightEdges, setHighlightEdges] = useState<{ source: string; target: string }[]>([]);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);

  const updateGraph = useCallback((message?: string) => {
    setGraphData(engine.current.graphData());
    if (message) setStatus(message);
  }, []);

  const syncChunks = useCallback(async (chunks: TextChunk[]) => {
    if (!backendAvailable.current || !chunks.length) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 1800);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chunks: chunks.map((chunk) => ({ ...chunk, chunk_id: `browser/${chunk.chunk_id}` })) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      setStatus(`Browser engine is active; Python mirror contains ${result.chunks} chunk(s).`);
    } catch (error) {
      const reason = error instanceof DOMException && error.name === "AbortError" ? "request timed out" : error instanceof Error ? error.message : "request failed";
      setStatus(`Browser graph remains active; optional Python sync failed (${reason}).`);
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    if (document.body.dataset.localApi !== "available") return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 900);
    void fetch("/api/health", { signal: controller.signal }).then((response) => {
      if (!response.ok) return;
      backendAvailable.current = true;
      const chunks = engine.current.exportChunks();
      if (chunks.length) void syncChunks(chunks);
      else setStatus("Local browser engine ready; Python mirror is available.");
    }).catch(() => {
      backendAvailable.current = false;
    }).finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [syncChunks]);

  const ingestFile = useCallback(async (file: File) => {
    const content = file.name.toLowerCase().endsWith(".pdf") ? await extractPdfText(file) : await file.text();
    const chunks = chunkText(content, file.name);
    if (!chunks.length) throw new Error("The selected document contains no readable text.");
    engine.current.ingest(chunks);
    updateGraph(`Locally extracted ${chunks.length} chunk(s) from ${file.name}.`);
    void syncChunks(chunks);
  }, [syncChunks, updateGraph]);

  const loadDemo = useCallback(async (progress: (count: number) => void) => {
    const chunks = demoChunks();
    for (const [index, chunk] of chunks.entries()) {
      engine.current.ingest([chunk]);
      setGraphData(engine.current.graphData());
      progress(Math.round(((index + 1) / chunks.length) * 100));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    setStatus(`Enterprise demo loaded locally: ${chunks.length} chunks, ${engine.current.graphData().nodes.length} entities.`);
    void syncChunks(engine.current.exportChunks());
  }, [syncChunks]);

  const query = useCallback((question: string) => {
    const result = engine.current.query(question);
    setHighlightNodes(result.highlighted_nodes);
    setHighlightEdges(result.highlighted_edges);
    return result;
  }, []);

  const handleNodeFocus = useCallback((name: string) => {
    setPendingFocus(name);
    setMobileTab("graph");
  }, []);
  const resetGraph = useCallback(() => {
    engine.current.reset();
    updateGraph("Local graph cleared. Add a document or reload the demo corpus.");
    setHighlightNodes([]);
    setHighlightEdges([]);
    toast("Local graph reset", "info");
    if (backendAvailable.current) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1800);
      void fetch("/api/reset", { method: "POST", signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          setStatus("Local graph and Python mirror cleared.");
        })
        .catch((error: unknown) => {
          const reason = error instanceof DOMException && error.name === "AbortError"
            ? "request timed out" : error instanceof Error ? error.message : "request failed";
          setStatus(`Local graph cleared; Python mirror reset failed (${reason}).`);
        })
        .finally(() => window.clearTimeout(timeout));
    }
  }, [updateGraph]);
  const clearHighlight = useCallback(() => {
    setHighlightNodes([]);
    setHighlightEdges([]);
  }, []);
  const topNodes = useMemo(() => graphData.nodes
    .slice().sort((a, b) => b.pagerank - a.pagerank || b.degree - a.degree)
    .slice(0, 20).map((node) => node.id), [graphData.nodes]);
  const getNodeDetail = useCallback((name: string) => engine.current.nodeDetail(name), []);
  const mobileTabs: { id: MobileTab; icon: string; label: string }[] = [
    { id: "ingest", icon: "📄", label: "Ingest" },
    { id: "graph", icon: "🕸️", label: "Graph" },
    { id: "chat", icon: "🤖", label: "Ask AI" },
  ];

  return (
    <div className="app-shell">
      <ToastContainer />
      <header className="topbar">
        <div className="brand">
          <button className="collapse-toggle" onClick={() => setLeftCollapsed((value) => !value)} aria-label="Toggle ingestion panel">{leftCollapsed ? "▶" : "◀"}</button>
          <span className="brand-dot" />
          <strong>KnowledgeGraph AI</strong>
          <span className="brand-subtitle">Multi-Agent GraphRAG</span>
        </div>
        <div className="agent-pipeline"><span>Extractor</span> → <span>Router</span> → <span>Synthesizer</span></div>
        <div className="local-status"><span className="brand-dot" /> Local · {graphData.nodes.length}N / {graphData.links.length}E</div>
      </header>
      <div className="glow-line" />
      <main className={`main-grid${leftCollapsed ? " left-collapsed" : ""}`}>
        <div className={`app-panel ingestion-panel panel-mobile ${mobileTab === "ingest" ? "visible" : "hidden"}`}>
          <IngestionPanel nodeCount={graphData.nodes.length} edgeCount={graphData.links.length} chunkCount={engine.current.chunkCount}
            onIngest={ingestFile} onLoadDemo={loadDemo} />
        </div>
        <div className={`app-panel graph-panel panel-mobile ${mobileTab === "graph" ? "visible" : "hidden"}`}>
          <GraphPanel graphData={graphData} status={status} queryHighlightNodes={highlightNodes}
            queryHighlightEdges={highlightEdges} pendingFocus={pendingFocus}
            onFocusConsumed={() => setPendingFocus(null)} onNodeFocus={handleNodeFocus}
            onHighlightClear={clearHighlight} getNodeDetail={getNodeDetail} onReset={resetGraph} />
        </div>
        <div className={`app-panel chat-panel panel-mobile ${mobileTab === "chat" ? "visible" : "hidden"}`}>
          <ChatPanel graphNodes={topNodes} onQuery={query} onHighlight={(nodes, edges) => { setHighlightNodes(nodes); setHighlightEdges(edges); }}
            onNodeFocus={handleNodeFocus} onSwitchToGraph={() => setMobileTab("graph")} />
        </div>
      </main>
      <nav className="bottom-nav" aria-label="Main navigation">
        {mobileTabs.map((tab) => <button key={tab.id} className={`bottom-nav-tab${mobileTab === tab.id ? " active" : ""}`} onClick={() => setMobileTab(tab.id)}>
          <span className="bottom-nav-tab-icon">{tab.icon}</span><span>{tab.label}</span>
        </button>)}
      </nav>
    </div>
  );
}
