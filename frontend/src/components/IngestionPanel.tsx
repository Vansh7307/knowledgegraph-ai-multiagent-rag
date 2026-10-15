"use client";
import { useCallback, useState } from "react";
import axios from "axios";

interface Props {
  onGraphUpdate: (graph: { nodes: any[]; links: any[] }) => void;
  onStatus: (msg: string) => void;
}

export default function IngestionPanel({ onGraphUpdate, onStatus }: Props) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".txt") && !file.name.endsWith(".pdf")) {
        onStatus("Only .txt and .pdf files are supported.");
        return;
      }
      setLoading(true);
      onStatus(`Ingesting "${file.name}"…`);
      const form = new FormData();
      form.append("file", file);
      try {
        const { data } = await axios.post("/api/ingest", form);
        onGraphUpdate(data.graph);
        onStatus(data.message);
      } catch (e: any) {
        onStatus(e?.response?.data?.detail || "Upload failed.");
      } finally {
        setLoading(false);
      }
    },
    [onGraphUpdate, onStatus]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) upload(file);
    },
    [upload]
  );

  return (
    <aside style={styles.panel}>
      <h2 style={styles.heading}>Document Ingestion</h2>
      <p style={styles.sub}>Upload a .txt or .pdf to build the knowledge graph in real-time.</p>

      <div
        style={{ ...styles.dropzone, ...(dragging ? styles.dropzoneActive : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {loading ? (
          <span style={styles.dropText}>Processing…</span>
        ) : (
          <>
            <span style={styles.dropIcon}>📄</span>
            <span style={styles.dropText}>Drag & drop a file here</span>
            <span style={styles.dropSub}>or</span>
            <label style={styles.browseBtn}>
              Browse
              <input
                type="file"
                accept=".txt,.pdf"
                style={{ display: "none" }}
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </label>
          </>
        )}
      </div>

      <div style={styles.hint}>
        <span style={styles.dot} />
        <span style={{ color: "var(--muted)", fontSize: "0.78rem" }}>
          Entities and relationships are extracted by the <strong style={{ color: "var(--text)" }}>Extractor Agent</strong> and written to Neo4j AuraDB.
        </span>
      </div>
    </aside>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 260,
    minWidth: 220,
    background: "var(--panel)",
    borderRight: "1px solid var(--border)",
    padding: "24px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  heading: { fontSize: "0.95rem", fontWeight: 600, letterSpacing: "-0.01em" },
  sub: { fontSize: "0.78rem", color: "var(--muted)", lineHeight: 1.5 },
  dropzone: {
    border: "2px dashed var(--border)",
    borderRadius: 10,
    padding: "28px 16px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    transition: "border-color 0.2s",
    cursor: "pointer",
  },
  dropzoneActive: { borderColor: "var(--teal)" },
  dropIcon: { fontSize: "2rem" },
  dropText: { fontSize: "0.85rem", color: "var(--text)", textAlign: "center" },
  dropSub: { fontSize: "0.75rem", color: "var(--muted)" },
  browseBtn: {
    background: "var(--teal)",
    color: "#06110f",
    border: "none",
    borderRadius: 6,
    padding: "6px 16px",
    fontSize: "0.82rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  hint: { display: "flex", gap: 8, alignItems: "flex-start", marginTop: "auto" },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "var(--teal)",
    marginTop: 4,
    flexShrink: 0,
    boxShadow: "0 0 6px var(--teal)",
  },
};
