"use client";
import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "./Toast";

interface Stats {
  node_count: number;
  edge_count: number;
  chunk_count: number;
  density: number;
  components: number;
  llm_provider: string;
  top_nodes: { name: string; degree: number }[];
  relation_distribution: { relation: string; count: number }[];
  source_distribution: { source: string; chunks: number }[];
}

interface SearchResult { name: string; degree: number; }

const PROVIDER_COLORS: Record<string, string> = {
  groq: "#00d4aa",
  gemini: "#3b82f6",
  openai: "#8b5cf6",
  ollama: "#f59e0b",
  "offline-scratch-engine": "#94a3b8",
};

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: "var(--panel2)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      transition: "border-color var(--transition)",
    }}
    onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border2)")}
    onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--border)")}
    >
      <span style={{ fontSize: "0.7rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: "1.5rem", fontWeight: 700, color: color || "var(--text)", lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: "0.7rem", color: "var(--muted)" }}>{sub}</span>}
    </div>
  );
}

function MiniBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)", fontFamily: "JetBrains Mono, monospace" }}>{value}</span>
      </div>
      <div style={{ height: 4, background: "var(--border)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
    </div>
  );
}

export default function StatsPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "nodes" | "relations">("overview");

  const fetchStats = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/stats");
      setStats(data);
    } catch {
      // silently retry — backend may still be starting
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 15000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  useEffect(() => {
    if (searchQ.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await axios.get(`/api/search-nodes?q=${encodeURIComponent(searchQ)}`);
        setSearchResults(data.results);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 280);
    return () => clearTimeout(t);
  }, [searchQ]);

  const handleExport = async (fmt: "json" | "csv") => {
    try {
      const resp = await axios.get(`/api/export?fmt=${fmt}`, { responseType: "blob" });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `knowledge_graph.${fmt}`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Graph exported as ${fmt.toUpperCase()}`, "success");
    } catch {
      toast("Export failed — try again", "error");
    }
  };

  const providerColor = stats ? (PROVIDER_COLORS[stats.llm_provider] || "#94a3b8") : "#94a3b8";
  const maxRelCount = stats ? Math.max(...stats.relation_distribution.map(r => r.count), 1) : 1;
  const maxDegree = stats ? Math.max(...stats.top_nodes.map(n => n.degree), 1) : 1;
  const maxChunks = stats ? Math.max(...stats.source_distribution.map(s => s.chunks), 1) : 1;

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.75rem",
    fontWeight: 500,
    background: active ? "var(--teal-dim)" : "transparent",
    color: active ? "var(--teal)" : "var(--text2)",
    border: active ? "1px solid rgba(0,212,170,0.2)" : "1px solid transparent",
    transition: "all var(--transition)",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Analytics</span>
            {stats && (
              <span className="badge badge-teal" style={{ fontSize: "0.65rem" }}>
                <span className="pulse" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--teal)", display: "inline-block" }} />
                Live
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => handleExport("json")} style={{ padding: "4px 10px", borderRadius: "var(--radius-sm)", background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 4 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>
              ↓ JSON
            </button>
            <button onClick={() => handleExport("csv")} style={{ padding: "4px 10px", borderRadius: "var(--radius-sm)", background: "var(--panel2)", border: "1px solid var(--border)", color: "var(--text2)", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 4 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--teal)"; e.currentTarget.style.color = "var(--teal)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text2)"; }}>
              ↓ CSV
            </button>
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display: "flex", gap: 4 }}>
          {(["overview", "nodes", "relations"] as const).map(tab => (
            <button key={tab} style={TAB_STYLE(activeTab === tab)} onClick={() => setActiveTab(tab)}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {loading ? (
          <>
            {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 64, borderRadius: "var(--radius)" }} />)}
          </>
        ) : !stats ? (
          <div style={{ textAlign: "center", color: "var(--muted)", fontSize: "0.8rem", paddingTop: 24 }}>
            Graph is building…
          </div>
        ) : (
          <>
            {activeTab === "overview" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <StatCard label="Nodes" value={stats.node_count} sub="entities extracted" color="var(--teal)" />
                  <StatCard label="Edges" value={stats.edge_count} sub="relationships" color="var(--blue)" />
                  <StatCard label="Chunks" value={stats.chunk_count} sub="text segments" color="var(--purple)" />
                  <StatCard label="Density" value={stats.density} sub={`${stats.components} component${stats.components !== 1 ? "s" : ""}`} color="var(--amber)" />
                </div>

                <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>LLM Provider</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: providerColor, boxShadow: `0 0 8px ${providerColor}`, flexShrink: 0 }} />
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.8rem", color: providerColor }}>{stats.llm_provider}</span>
                  </div>
                </div>

                <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Source Documents</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {stats.source_distribution.map(s => (
                      <MiniBar key={s.source} label={s.source} value={s.chunks} max={maxChunks} color="var(--purple)" />
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === "nodes" && (
              <>
                <div style={{ position: "relative" }}>
                  <input
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                    placeholder="Search nodes…"
                    style={{
                      width: "100%",
                      background: "var(--panel2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text)",
                      padding: "8px 32px 8px 10px",
                      fontSize: "0.82rem",
                    }}
                    onFocus={e => (e.target.style.borderColor = "var(--teal)")}
                    onBlur={e => (e.target.style.borderColor = "var(--border)")}
                  />
                  {searching && (
                    <span className="spin" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, border: "2px solid var(--border2)", borderTopColor: "var(--teal)", borderRadius: "50%", display: "inline-block" }} />
                  )}
                </div>

                <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
                  <div style={{ fontSize: "0.7rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
                    {searchQ.length >= 2 ? `Results for "${searchQ}"` : "Top Connected Nodes"}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(searchQ.length >= 2 ? searchResults : stats.top_nodes).map((n) => (
                      <MiniBar key={n.name} label={n.name} value={n.degree} max={searchQ.length >= 2 ? Math.max(...searchResults.map(r => r.degree), 1) : maxDegree} color="var(--teal)" />
                    ))}
                    {searchQ.length >= 2 && searchResults.length === 0 && !searching && (
                      <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>No nodes match "{searchQ}"</span>
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === "relations" && (
              <div style={{ background: "var(--panel2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--text2)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Relation Types</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {stats.relation_distribution.map((r, i) => (
                    <MiniBar key={r.relation} label={r.relation} value={r.count} max={maxRelCount}
                      color={["var(--teal)","var(--blue)","var(--purple)","var(--amber)","var(--green)"][i % 5]} />
                  ))}
                  {stats.relation_distribution.length === 0 && (
                    <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>No relations yet</span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
