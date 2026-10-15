"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { toast } from "./Toast";

interface Props {
  onGraphUpdate: (graph: { nodes: any[]; links: any[] }) => void;
  onStatus: (msg: string) => void;
}

interface DemoProgress {
  totalChunks: number;
  totalNodes: number;
  totalEdges: number;
  currentDoc: string;
  phase: "idle" | "running" | "done";
}

const DEMO_DOCS = [
  { name: "01_transformers.txt",                    label: "Transformer Architecture" },
  { name: "02_gpt_family.txt",                      label: "GPT Family & OpenAI"      },
  { name: "03_retrieval_augmented_generation.txt",  label: "RAG Systems"              },
];

export default function IngestionPanel({ onGraphUpdate, onStatus }: Props) {
  const [dragging,   setDragging]   = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [uploadPct,  setUploadPct]  = useState(0);
  const [fileName,   setFileName]   = useState("");
  const [connected,  setConnected]  = useState<"checking" | "ok" | "error">("checking");
  const [demo,       setDemo]       = useState<DemoProgress>({ totalChunks: 0, totalNodes: 0, totalEdges: 0, currentDoc: "", phase: "idle" });
  const esRef = useRef<EventSource | null>(null);

  /* ── connection probe ── */
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const { data } = await axios.get("/api/health", { timeout: 8000 });
        if (!cancelled) setConnected(data.status === "ok" ? "ok" : "error");
      } catch {
        if (!cancelled) setConnected("error");
      }
    };
    probe();
    const iv = setInterval(probe, 12000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  /* ── file upload ── */
  const upload = useCallback(async (file: File) => {
    if (!file.name.endsWith(".txt") && !file.name.endsWith(".pdf")) {
      toast("Only .txt and .pdf files are supported", "error"); return;
    }
    if (file.size > 10 * 1024 * 1024) { toast("File too large — max 10 MB", "error"); return; }
    setUploading(true); setFileName(file.name); setUploadPct(10);
    onStatus(`Ingesting "${file.name}"…`);
    const form = new FormData();
    form.append("file", file);
    try {
      setUploadPct(30);
      const { data } = await axios.post("/api/ingest", form, {
        onUploadProgress: (e) => { if (e.total) setUploadPct(30 + Math.round((e.loaded / e.total) * 50)); },
      });
      setUploadPct(100);
      onGraphUpdate(data.graph);
      onStatus(data.message);
      toast(`"${file.name}" ingested — ${data.graph.nodes.length} nodes`, "success");
      setTimeout(() => setUploadPct(0), 700);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Upload failed";
      onStatus(msg); toast(msg, "error"); setUploadPct(0);
    } finally { setUploading(false); setFileName(""); }
  }, [onGraphUpdate, onStatus]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0]; if (f) upload(f);
  }, [upload]);

  /* ── 1-click demo ingestion via SSE ── */
  const loadDemo = () => {
    if (demo.phase === "running") return;
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    setDemo({ totalChunks: 0, totalNodes: 0, totalEdges: 0, currentDoc: "", phase: "running" });
    onStatus("Loading enterprise demo — extracting entities…");
    toast("Demo ingestion started", "info");

    const es = new EventSource("/api/ingest-demo");
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.event === "doc_start") {
          setDemo(p => ({ ...p, currentDoc: d.source }));
          onStatus(`Extracting: ${d.source} (${d.chunks} chunks)…`);
        } else if (d.event === "chunk") {
          setDemo(p => ({ ...p, totalChunks: d.total_chunks, totalNodes: d.total_nodes, totalEdges: d.total_edges }));
        } else if (d.event === "done") {
          setDemo({ totalChunks: d.total_chunks, totalNodes: d.total_nodes, totalEdges: d.total_edges, currentDoc: "", phase: "done" });
          onGraphUpdate(d.graph);
          onStatus(`Demo loaded — ${d.total_nodes} nodes, ${d.total_edges} edges`);
          toast(`Demo graph ready — ${d.total_nodes} nodes, ${d.total_edges} edges`, "success");
          es.close(); esRef.current = null;
        }
      } catch { /* ignore malformed frames */ }
    };
    es.onerror = () => {
      toast("Demo stream error — retrying graph fetch", "error");
      es.close(); esRef.current = null;
      setDemo(p => ({ ...p, phase: "idle" }));
      axios.get("/api/graph-data").then(({ data }) => { onGraphUpdate(data); onStatus(`Graph loaded — ${data.nodes.length} nodes`); }).catch(() => {});
    };
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  const busy = uploading || demo.phase === "running";

  const connColor = connected === "ok" ? "var(--teal)" : connected === "error" ? "var(--red)" : "var(--amber)";
  const connLabel = connected === "ok" ? "Connected" : connected === "error" ? "Offline" : "Connecting…";

  return (
    <aside style={{ width: 248, minWidth: 210, background: "var(--panel)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── header ── */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Ingestion</span>
            <span className="badge badge-teal" style={{ fontSize: "0.62rem" }}>Extractor Agent</span>
          </div>
          <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.68rem", color: connColor }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: connColor, boxShadow: connected === "ok" ? `0 0 6px ${connColor}` : "none" }} className={connected === "checking" ? "pulse" : ""} />
            {connLabel}
          </span>
        </div>
        <p style={{ fontSize: "0.7rem", color: "var(--text2)", lineHeight: 1.5 }}>Upload .txt / .pdf or load the enterprise demo</p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* ── drop zone ── */}
        <div
          style={{ border: `2px dashed ${dragging ? "var(--teal)" : "var(--border2)"}`, borderRadius: "var(--radius)", padding: "18px 10px", display: "flex", flexDirection: "column", alignItems: "center", gap: 7, background: dragging ? "var(--teal-glow)" : "var(--panel2)", transition: "all var(--transition)", cursor: busy ? "not-allowed" : "pointer" }}
          onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={busy ? undefined : onDrop}
        >
          {uploading ? (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
              <div className="spin" style={{ width: 22, height: 22, border: "2px solid var(--border2)", borderTopColor: "var(--teal)", borderRadius: "50%" }} />
              <span style={{ fontSize: "0.73rem", color: "var(--text2)", textAlign: "center" }}>{fileName ? `Processing "${fileName}"…` : "Processing…"}</span>
              <div style={{ width: "100%", height: 3, background: "var(--border)", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${uploadPct}%`, background: "var(--teal)", borderRadius: 99, transition: "width 0.3s ease" }} />
              </div>
            </div>
          ) : (
            <>
              <span style={{ fontSize: "1.5rem" }}>📄</span>
              <span style={{ fontSize: "0.75rem", color: "var(--text2)", textAlign: "center", lineHeight: 1.4 }}>Drag & drop a file</span>
              <label style={{ background: "var(--teal)", color: "#06110f", borderRadius: "var(--radius-sm)", padding: "5px 14px", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>
                Browse
                <input type="file" accept=".txt,.pdf" style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            </>
          )}
        </div>

        {/* ── demo ingestion card ── */}
        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "11px 13px" }}>
          <div style={{ fontSize: "0.68rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>Enterprise Demo</div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 9 }}>
            {DEMO_DOCS.map(d => (
              <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: demo.currentDoc === d.name ? "var(--amber)" : "var(--teal)", flexShrink: 0, transition: "background 0.3s" }} className={demo.currentDoc === d.name ? "pulse" : ""} />
                <span style={{ fontSize: "0.7rem", color: demo.currentDoc === d.name ? "var(--amber)" : "var(--text2)" }}>{d.label}</span>
              </div>
            ))}
          </div>

          {/* live counters */}
          {demo.phase !== "idle" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5, marginBottom: 9 }}>
              {[
                { label: "Chunks", val: demo.totalChunks, color: "var(--purple)" },
                { label: "Nodes",  val: demo.totalNodes,  color: "var(--teal)"   },
                { label: "Edges",  val: demo.totalEdges,  color: "var(--blue)"   },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 6px", textAlign: "center" }}>
                  <div style={{ fontSize: "0.95rem", fontWeight: 700, color, fontFamily: "JetBrains Mono, monospace" }}>{val}</div>
                  <div style={{ fontSize: "0.6rem", color: "var(--muted)" }}>{label}</div>
                </div>
              ))}
            </div>
          )}

          {/* progress bar while running */}
          {demo.phase === "running" && (
            <div style={{ height: 3, background: "var(--border)", borderRadius: 99, overflow: "hidden", marginBottom: 9 }}>
              <div style={{ height: "100%", width: "100%", background: "linear-gradient(90deg, var(--teal), var(--blue))", borderRadius: 99, animation: "shimmer 1.4s infinite linear", backgroundSize: "200% 100%" }} />
            </div>
          )}

          <button
            onClick={loadDemo}
            disabled={busy}
            style={{ width: "100%", padding: "8px", borderRadius: "var(--radius-sm)", background: demo.phase === "done" ? "rgba(0,212,170,0.08)" : "linear-gradient(135deg, var(--teal-dim), rgba(0,212,170,0.08))", border: `1px solid ${demo.phase === "done" ? "rgba(0,212,170,0.4)" : "rgba(0,212,170,0.25)"}`, color: "var(--teal)", fontSize: "0.78rem", fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            onMouseEnter={e => { if (!busy) e.currentTarget.style.background = "rgba(0,212,170,0.15)"; }}
            onMouseLeave={e => { if (!busy) e.currentTarget.style.background = demo.phase === "done" ? "rgba(0,212,170,0.08)" : "linear-gradient(135deg, var(--teal-dim), rgba(0,212,170,0.08))"; }}
          >
            {demo.phase === "running" ? (
              <><span className="spin" style={{ width: 12, height: 12, border: "2px solid var(--teal-dim)", borderTopColor: "var(--teal)", borderRadius: "50%", display: "inline-block" }} /> Extracting…</>
            ) : demo.phase === "done" ? "✓ Demo Loaded — Reload" : "⚡ Load Enterprise Demo"}
          </button>
        </div>

        {/* ── footer hint ── */}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginTop: "auto" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--teal)", marginTop: 5, flexShrink: 0, boxShadow: "0 0 5px var(--teal)" }} />
          <span style={{ fontSize: "0.68rem", color: "var(--muted)", lineHeight: 1.5 }}>
            Entities & relations extracted by the <strong style={{ color: "var(--text2)" }}>Extractor Agent</strong> via LLM-powered NER
          </span>
        </div>
      </div>
    </aside>
  );
}
