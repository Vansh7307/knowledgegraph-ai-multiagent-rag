"use client";
import { useCallback, useState } from "react";
import axios from "axios";
import { toast } from "./Toast";

interface Props {
  onGraphUpdate: (graph: { nodes: any[]; links: any[] }) => void;
  onStatus: (msg: string) => void;
}

const DEMO_QUESTIONS = [
  "What is Self-Attention and how does it work?",
  "How does Graph RAG differ from plain RAG?",
  "What company built ChatGPT and who invested in them?",
  "How are multi-agent systems used in RAG pipelines?",
  "What is Few-Shot Prompting?",
];

const DEMO_DOCS = [
  { name: "01_transformers.txt", label: "Transformer Architecture" },
  { name: "02_gpt_family.txt",   label: "GPT Family & OpenAI" },
  { name: "03_retrieval_augmented_generation.txt", label: "RAG Systems" },
];

export default function IngestionPanel({ onGraphUpdate, onStatus }: Props) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState("");

  const upload = useCallback(async (file: File) => {
    if (!file.name.endsWith(".txt") && !file.name.endsWith(".pdf")) {
      toast("Only .txt and .pdf files are supported", "error");
      onStatus("Only .txt and .pdf files are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("File too large — max 10 MB", "error");
      return;
    }
    setLoading(true);
    setFileName(file.name);
    setProgress(10);
    onStatus(`Ingesting "${file.name}"…`);

    const form = new FormData();
    form.append("file", file);

    try {
      setProgress(30);
      const { data } = await axios.post("/api/ingest", form, {
        onUploadProgress: (e) => {
          if (e.total) setProgress(30 + Math.round((e.loaded / e.total) * 40));
        },
      });
      setProgress(90);
      onGraphUpdate(data.graph);
      onStatus(data.message);
      toast(`"${file.name}" ingested successfully`, "success");
      setProgress(100);
      setTimeout(() => setProgress(0), 800);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "Upload failed — check file format";
      onStatus(msg);
      toast(msg, "error");
      setProgress(0);
    } finally {
      setLoading(false);
      setFileName("");
    }
  }, [onGraphUpdate, onStatus]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  }, [upload]);

  const loadDemoScenario = async () => {
    setLoading(true);
    onStatus("Loading demo scenario…");
    toast("Loading demo knowledge graph…", "info");
    try {
      const { data } = await axios.get("/api/graph-data");
      onGraphUpdate(data);
      onStatus(`Demo loaded: ${data.nodes.length} nodes, ${data.links.length} edges`);
      toast(`Demo graph loaded — ${data.nodes.length} nodes, ${data.links.length} edges`, "success");
    } catch {
      toast("Demo load failed — backend may be starting", "error");
      onStatus("Backend is starting up, try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside style={{
      width: 240,
      minWidth: 200,
      background: "var(--panel)",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Ingestion</span>
          <span className="badge badge-teal" style={{ fontSize: "0.65rem" }}>Extractor Agent</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "var(--text2)", lineHeight: 1.5 }}>
          Upload .txt or .pdf to build the knowledge graph
        </p>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Drop zone */}
        <div
          style={{
            border: `2px dashed ${dragging ? "var(--teal)" : "var(--border2)"}`,
            borderRadius: "var(--radius)",
            padding: "20px 12px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            background: dragging ? "var(--teal-glow)" : "var(--panel2)",
            transition: "all var(--transition)",
            cursor: loading ? "not-allowed" : "pointer",
          }}
          onDragOver={(e) => { e.preventDefault(); if (!loading) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={loading ? undefined : onDrop}
        >
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%" }}>
              <div className="spin" style={{ width: 24, height: 24, border: "2px solid var(--border2)", borderTopColor: "var(--teal)", borderRadius: "50%" }} />
              <span style={{ fontSize: "0.75rem", color: "var(--text2)", textAlign: "center" }}>
                {fileName ? `Processing "${fileName}"…` : "Processing…"}
              </span>
              {progress > 0 && (
                <div style={{ width: "100%", height: 3, background: "var(--border)", borderRadius: 99, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${progress}%`, background: "var(--teal)", borderRadius: 99, transition: "width 0.3s ease" }} />
                </div>
              )}
            </div>
          ) : (
            <>
              <span style={{ fontSize: "1.6rem" }}>📄</span>
              <span style={{ fontSize: "0.78rem", color: "var(--text2)", textAlign: "center", lineHeight: 1.4 }}>
                Drag & drop a file here
              </span>
              <label style={{
                background: "var(--teal)",
                color: "#06110f",
                borderRadius: "var(--radius-sm)",
                padding: "6px 14px",
                fontSize: "0.78rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "opacity var(--transition)",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>
                Browse
                <input type="file" accept=".txt,.pdf" style={{ display: "none" }}
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            </>
          )}
        </div>

        {/* Demo scenario */}
        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
          <div style={{ fontSize: "0.7rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Demo Scenario
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
            {DEMO_DOCS.map(d => (
              <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--teal)", flexShrink: 0 }} />
                <span style={{ fontSize: "0.72rem", color: "var(--text2)" }}>{d.label}</span>
              </div>
            ))}
          </div>
          <button
            onClick={loadDemoScenario}
            disabled={loading}
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "var(--radius-sm)",
              background: "linear-gradient(135deg, var(--teal-dim), rgba(0,212,170,0.08))",
              border: "1px solid rgba(0,212,170,0.25)",
              color: "var(--teal)",
              fontSize: "0.78rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,170,0.15)")}
            onMouseLeave={e => (e.currentTarget.style.background = "linear-gradient(135deg, var(--teal-dim), rgba(0,212,170,0.08))")}
          >
            ⚡ Load Demo Graph
          </button>
        </div>

        {/* Sample questions */}
        <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
          <div style={{ fontSize: "0.7rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Sample Questions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {DEMO_QUESTIONS.map(q => (
              <div key={q} style={{
                fontSize: "0.72rem",
                color: "var(--text2)",
                padding: "5px 8px",
                borderRadius: "var(--radius-sm)",
                background: "var(--panel)",
                border: "1px solid var(--border)",
                lineHeight: 1.4,
                cursor: "default",
              }}>
                {q}
              </div>
            ))}
          </div>
        </div>

        {/* Info footer */}
        <div style={{ marginTop: "auto", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--teal)", marginTop: 5, flexShrink: 0, boxShadow: "0 0 6px var(--teal)" }} />
          <span style={{ fontSize: "0.7rem", color: "var(--muted)", lineHeight: 1.5 }}>
            Entities & relations extracted by the <strong style={{ color: "var(--text2)" }}>Extractor Agent</strong> using LLM-powered NER
          </span>
        </div>
      </div>
    </aside>
  );
}
