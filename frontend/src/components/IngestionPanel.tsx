"use client";

import { useRef, useState } from "react";
import { toast } from "./Toast";

interface Props {
  nodeCount: number;
  edgeCount: number;
  chunkCount: number;
  onIngest: (file: File) => Promise<void>;
  onLoadDemo: (progress: (count: number) => void) => Promise<void>;
}

export default function IngestionPanel({ nodeCount, edgeCount, chunkCount, onIngest, onLoadDemo }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState(0);

  const ingest = async (file: File) => {
    if (!/\.(txt|pdf)$/i.test(file.name)) {
      toast("Only .txt and .pdf files are supported", "error");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("File too large — maximum size is 10 MB", "error");
      return;
    }
    setBusy(true);
    setFileName(file.name);
    setProgress(10);
    try {
      await onIngest(file);
      setProgress(100);
      toast(`${file.name} parsed locally`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not parse this file.";
      toast(message, "error");
    } finally {
      setTimeout(() => { setBusy(false); setProgress(0); setFileName(""); }, 250);
    }
  };

  const loadDemo = async () => {
    if (busy) return;
    setBusy(true);
    setProgress(0);
    try {
      await onLoadDemo(setProgress);
      toast("Enterprise demo graph is ready", "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not load demo corpus.", "error");
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void ingest(file);
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong>Ingestion</strong>
          <span className="badge badge-teal">Local Extractor</span>
        </div>
        <p style={{ color: "var(--text2)", fontSize: "0.72rem", marginTop: 5 }}>Runs in this browser. No account, API key, or server required.</p>
      </div>
      <div className="panel-scroll" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          style={{ border: `2px dashed ${dragging ? "var(--teal)" : "var(--border2)"}`, borderRadius: "var(--radius)", padding: 18, textAlign: "center", background: dragging ? "var(--teal-glow)" : "var(--panel2)" }}
        >
          <div style={{ fontSize: "1.6rem", marginBottom: 5 }}>📄</div>
          <p style={{ fontSize: "0.76rem", color: "var(--text2)", marginBottom: 10 }}>Drop a .txt or .pdf file here</p>
          <button onClick={() => fileInput.current?.click()} disabled={busy} style={{ background: "var(--teal)", color: "#06110f", padding: "6px 13px", borderRadius: 6, fontWeight: 700 }}>
            Choose file
          </button>
          <input ref={fileInput} type="file" accept=".txt,.pdf,text/plain,application/pdf" hidden onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void ingest(file);
            event.target.value = "";
          }} />
        </div>
        {busy && (
          <div>
            <div style={{ fontSize: "0.7rem", color: "var(--text2)", marginBottom: 5 }}>{fileName || `Processing demo corpus (${progress}%)`}</div>
            <div style={{ height: 4, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(8, progress)}%`, height: "100%", background: "var(--teal)", transition: "width 120ms linear" }} />
            </div>
          </div>
        )}
        <button onClick={() => void loadDemo()} disabled={busy} style={{ width: "100%", padding: 10, borderRadius: 7, background: "linear-gradient(135deg, var(--teal-dim), rgba(0,212,170,.12))", border: "1px solid rgba(0,212,170,.3)", color: "var(--teal)", fontWeight: 700 }}>
          ⚡ Load Enterprise Demo
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {[["Chunks", chunkCount], ["Entities", nodeCount], ["Triplets", edgeCount]].map(([label, count]) => (
            <div key={label} style={{ padding: "8px 3px", textAlign: "center", borderRadius: 6, background: "var(--panel2)", border: "1px solid var(--border)" }}>
              <div style={{ color: "var(--teal)", fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}>{count}</div>
              <div style={{ color: "var(--muted)", fontSize: "0.62rem" }}>{label}</div>
            </div>
          ))}
        </div>
        <p style={{ color: "var(--muted)", fontSize: "0.67rem", lineHeight: 1.55 }}>
          The rule-based extractor detects technical phrases, acronyms, entity types, and verb-pattern relationships directly from source text.
        </p>
      </div>
    </section>
  );
}
