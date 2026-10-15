export type EntityType = "Architecture" | "Agent" | "Algorithm" | "Database" | "Component" | "Concept" | "Metric";

export interface TextChunk {
  chunk_id: string;
  source: string;
  text: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: EntityType;
  degree: number;
  in_degree: number;
  out_degree: number;
  pagerank: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  chunk_id: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

export interface QueryResult {
  answer: string;
  hops: number;
  chunks_used: number;
  graph_facts_used: number;
  strategy: "graph" | "text" | "hybrid";
  confidence: number;
  trace: { agent: string; status: string; detail: string; ms: number; strategy?: string; confidence?: number }[];
  highlighted_nodes: string[];
  highlighted_edges: { source: string; target: string; relation: string }[];
  source_chunks: { id: string; source: string; text: string; score: number }[];
  graph_facts: string[];
  features: { relational_terms: number; interrogative: number; entity_density: number; matched_entities: string[] };
}

const STOPWORDS = new Set("a an and are as at be been by can do does for from how i in is it its of on or that the their this to was what when where which who why with".split(" "));
const DOMAIN: [string, EntityType][] = [
  ["GraphRAG", "Architecture"], ["RAG", "Architecture"], ["Knowledge Graph", "Database"],
  ["Property Graph", "Database"], ["TF-IDF", "Algorithm"], ["TFIDF", "Algorithm"],
  ["BFS", "Algorithm"], ["Dijkstra", "Algorithm"], ["PageRank", "Metric"],
  ["Cosine Similarity", "Algorithm"], ["Vector Search", "Algorithm"],
  ["Extractor", "Agent"], ["Router", "Agent"], ["Synthesizer", "Agent"],
  ["Transformer", "Architecture"], ["Self-Attention", "Algorithm"], ["Neo4j", "Database"],
  ["SQLite", "Database"], ["PostgreSQL", "Database"], ["Python", "Component"],
  ["TypeScript", "Component"], ["FastAPI", "Component"], ["Next.js", "Component"],
  ["React", "Component"], ["OpenAI", "Component"], ["BERT", "Architecture"],
  ["GPT", "Architecture"], ["ChatGPT", "Component"], ["Multi-Agent System", "Architecture"],
  ["Multi-Agent", "Architecture"], ["Embedding", "Concept"], ["Embeddings", "Concept"],
  ["Chunk", "Concept"], ["Entity", "Concept"], ["Relationship", "Concept"],
  ["IDF", "Metric"], ["TF", "Metric"], ["API", "Component"], ["PDF", "Component"],
];
const PREDICATES: [RegExp, string][] = [
  [/\b(?:built\s+on|based\s+on|powered\s+by)\b/i, "BUILT_ON"],
  [/\b(?:uses?|used|using|utilizes?|utilized|utilizing)\b/i, "USES"], [/\borchestrates?\b/i, "ORCHESTRATES"],
  [/\b(?:writes?|written|stores?|stored|persists?|persisted)\b/i, "WRITES_TO"], [/\b(?:computes?|computed|calculates?|calculated|ranks?|ranked)\b/i, "COMPUTES"],
  [/\b(?:routes?|routed)(?:\s+to)?\b/i, "ROUTES_TO"], [/\b(?:powers?|powered)\b/i, "POWERS"],
  [/\b(?:prevents?|prevented)\b/i, "PREVENTS"], [/\b(?:connects?|connected|links?|linked)\b/i, "CONNECTS_TO"],
  [/\b(?:retrieves?|retrieved)\b/i, "RETRIEVES"], [/\b(?:extracts?|extracted)\b/i, "EXTRACTS"],
  [/\b(?:contains?|contained)\b/i, "CONTAINS"], [/\b(?:combines?|combined)\b/i, "COMBINES"],
  [/\b(?:creates?|created)\b/i, "CREATES"], [/\b(?:generates?|generated)\b/i, "GENERATES"],
  [/\b(?:enables?|enabled)\b/i, "ENABLES"], [/\b(?:supports?|supported)\b/i, "SUPPORTS"],
];

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)*/g) || []).filter((term) => !STOPWORDS.has(term));
}

export function splitSentences(text: string): string[] {
  return text.trim().split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean);
}

export function chunkText(text: string, source: string, size = 120, overlap = 20): TextChunk[] {
  const words = text.split(/\s+/).filter(Boolean);
  const step = Math.max(1, size - Math.max(0, overlap));
  const output: TextChunk[] = [];
  for (let start = 0; start < words.length; start += step) {
    const part = words.slice(start, start + size).join(" ");
    if (part) output.push({ chunk_id: `${source}::chunk${output.length}`, source, text: part });
    if (start + size >= words.length) break;
  }
  return output;
}

export async function extractPdfText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const raw = new TextDecoder("latin1").decode(bytes);
  const streams: Uint8Array[] = [];
  const streamPattern = /\/Filter\s*(?:\[\s*)?\/FlateDecode[\s\S]*?stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw))) {
    const start = streamPattern.lastIndex;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const compressed = bytes.slice(start, end);
    if (typeof DecompressionStream !== "undefined") {
      try {
        const decompressed = new DecompressionStream("deflate");
        const writer = decompressed.writable.getWriter();
        writer.write(compressed);
        writer.close();
        streams.push(new Uint8Array(await new Response(decompressed.readable).arrayBuffer()));
      } catch {
        continue;
      }
    }
    streamPattern.lastIndex = end + "endstream".length;
  }
  const decoded = [raw, ...streams.map((stream) => new TextDecoder("latin1").decode(stream))];
  const pieces: string[] = [];
  decoded.forEach((content) => {
    const textOps = content.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:.|\n)*?)\]\s*TJ/g);
    for (const operation of textOps) {
      const value = operation[1] ?? operation[2] ?? "";
      const literals = value.matchAll(/\(((?:\\.|[^\\)])*)\)/g);
      for (const literal of literals) {
        pieces.push(literal[1].replace(/\\([()\\])/g, "$1").replace(/\\n/g, "\n").replace(/\\r/g, "\n"));
      }
      if (!value.includes("(")) pieces.push(value);
    }
  });
  const text = pieces.join(" ").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Could not extract readable text from this PDF.");
  return text;
}

function classify(name: string): EntityType {
  const known = DOMAIN.find(([phrase]) => phrase.toLowerCase() === name.toLowerCase());
  if (known) return known[1];
  if (/architecture|framework|system|pipeline|model/i.test(name)) return "Architecture";
  if (/agent|router|extractor|synthesizer/i.test(name)) return "Agent";
  return "Concept";
}

interface Entity { name: string; type: EntityType; mentions: Set<string>; }
interface Edge extends GraphEdge { source_text: string; }

export class ScratchGraphRAG {
  private entities = new Map<string, Entity>();
  private outgoing = new Map<string, Edge[]>();
  private incoming = new Map<string, Edge[]>();
  private inverted = new Map<string, Set<string>>();
  private edgeList: Edge[] = [];
  private chunkList: TextChunk[] = [];
  private chunkIds = new Set<string>();

  reset(): void {
    this.entities.clear(); this.outgoing.clear(); this.incoming.clear();
    this.inverted.clear(); this.edgeList = []; this.chunkList = []; this.chunkIds.clear();
  }

  get chunkCount(): number {
    return this.chunkList.length;
  }

  exportChunks(): TextChunk[] {
    return this.chunkList.map((chunk) => ({ ...chunk }));
  }

  ingest(chunks: TextChunk[]): GraphData {
    chunks.forEach((chunk) => {
      if (this.chunkIds.has(chunk.chunk_id)) return;
      this.chunkIds.add(chunk.chunk_id);
      this.chunkList.push(chunk);
      const names = new Map<string, EntityType>();
      DOMAIN.forEach(([phrase, type]) => {
        if (new RegExp(`(^|[^\\w])${escapeRegExp(phrase)}([^\\w]|$)`, "i").test(chunk.text)) names.set(phrase, type);
      });
      (chunk.text.match(/\b(?:[A-Z][A-Za-z0-9.+#-]*(?:\s+[A-Z][A-Za-z0-9.+#-]*){0,3})\b/g) || []).forEach((name) => {
        const cleaned = name.trim().replace(/[.,:;]+$/, "").replace(/^(?:The|A|An)\s+/, "");
        if (cleaned.length > 1 && !STOPWORDS.has(cleaned.toLowerCase()) && !names.has(cleaned)) names.set(cleaned, classify(cleaned));
      });
      names.forEach((type, name) => this.addNode(name, type, chunk.chunk_id));
      splitSentences(chunk.text).forEach((sentence) => {
        sentence.split(/,\s*(?:and\s+)?/i).forEach((clause) => {
          const relation = extractRelation(clause, [...names.keys()]);
          if (relation) this.addEdge(relation.source, relation.target, relation.predicate, chunk.chunk_id, sentence);
        });
      });
    });
    return this.graphData();
  }

  private addNode(name: string, type: EntityType, chunkId: string): void {
    let entity = this.entities.get(name);
    if (!entity) {
      entity = { name, type, mentions: new Set() };
      this.entities.set(name, entity);
      tokenize(name).forEach((token) => {
        if (!this.inverted.has(token)) this.inverted.set(token, new Set());
        this.inverted.get(token)?.add(name);
      });
    } else if (entity.type === "Concept" && type !== "Concept") entity.type = type;
    entity.mentions.add(chunkId);
    if (!this.outgoing.has(name)) this.outgoing.set(name, []);
    if (!this.incoming.has(name)) this.incoming.set(name, []);
  }

  private addEdge(source: string, target: string, relation: string, chunkId: string, sourceText: string): void {
    if (source === target) return;
    this.addNode(source, classify(source), chunkId); this.addNode(target, classify(target), chunkId);
    if (this.outgoing.get(source)?.some((edge) => edge.target === target && edge.relation === relation && edge.chunk_id === chunkId)) return;
    const edge = { source, target, relation, chunk_id: chunkId, source_text: sourceText };
    this.edgeList.push(edge); this.outgoing.get(source)?.push(edge); this.incoming.get(target)?.push(edge);
  }

  private bfs(starts: string[], maxHops = 2): { nodes: string[]; edges: Edge[] } {
    const reached = new Set(starts.filter((node) => this.entities.has(node)));
    const queue = [...reached].map((node) => ({ node, depth: 0 }));
    const edges = new Set<Edge>();
    while (queue.length) {
      const current = queue.shift();
      if (!current || current.depth >= maxHops) continue;
      const adjacent = this.outgoing.get(current.node) || [];
      adjacent.forEach((edge) => {
        edges.add(edge);
        const other = edge.target;
        if (!reached.has(other)) { reached.add(other); queue.push({ node: other, depth: current.depth + 1 }); }
      });
    }
    return { nodes: [...reached], edges: [...edges] };
  }

  private shortestPath(source: string, target: string): Edge[] {
    if (!this.entities.has(source) || !this.entities.has(target)) return [];
    const queue = [source];
    const parent = new Map<string, { node: string; edge: Edge }>();
    const visited = new Set([source]);
    while (queue.length) {
      const node = queue.shift() as string;
      if (node === target) break;
      (this.outgoing.get(node) || []).forEach((edge) => {
        const other = edge.target;
        if (!visited.has(other)) { visited.add(other); parent.set(other, { node, edge }); queue.push(other); }
      });
    }
    if (!visited.has(target)) return [];
    const path: Edge[] = [];
    let node = target;
    while (parent.has(node)) { const step = parent.get(node) as { node: string; edge: Edge }; path.push(step.edge); node = step.node; }
    return path.reverse();
  }

  private pageRank(iterations = 30, damping = 0.85): Map<string, number> {
    const names = [...this.entities.keys()];
    const n = names.length;
    let rank = new Map(names.map((name) => [name, n ? 1 / n : 0]));
    for (let step = 0; step < iterations; step += 1) {
      const dangling = names.reduce((sum, name) => sum + ((this.outgoing.get(name)?.length || 0) ? 0 : rank.get(name) || 0), 0);
      const next = new Map(names.map((name) => [name, n ? (1 - damping) / n + damping * dangling / n : 0]));
      names.forEach((name) => (this.incoming.get(name) || []).forEach((edge) => {
        const degree = this.outgoing.get(edge.source)?.length || 0;
        if (degree) next.set(name, (next.get(name) || 0) + damping * (rank.get(edge.source) || 0) / degree);
      }));
      rank = next;
    }
    return rank;
  }

  graphData(): GraphData {
    const rank = this.pageRank();
    return {
      nodes: [...this.entities.values()].map((entity) => ({
        id: entity.name, label: entity.name, type: entity.type,
        degree: (this.incoming.get(entity.name)?.length || 0) + (this.outgoing.get(entity.name)?.length || 0),
        in_degree: this.incoming.get(entity.name)?.length || 0,
        out_degree: this.outgoing.get(entity.name)?.length || 0, pagerank: rank.get(entity.name) || 0,
      })),
      links: this.edgeList.map(({ source, target, relation, chunk_id }) => ({ source, target, relation, chunk_id })),
    };
  }

  nodeDetail(name: string) {
    const entity = this.entities.get(name);
    if (!entity) return null;
    const links = [...(this.incoming.get(name) || []), ...(this.outgoing.get(name) || [])];
    const rank = this.pageRank().get(name) || 0;
    return {
      name, type: entity.type, pagerank: rank,
      degree: links.length, in_degree: this.incoming.get(name)?.length || 0,
      out_degree: this.outgoing.get(name)?.length || 0,
      triplets: links.map((edge) => ({ subject: edge.source, predicate: edge.relation, object: edge.target, chunk_id: edge.chunk_id })),
      source_chunks: this.chunkList.filter((chunk) => entity.mentions.has(chunk.chunk_id)).map((chunk) => ({ id: chunk.chunk_id, source: chunk.source, text: chunk.text })),
    };
  }

  query(question: string): QueryResult {
    const started = performance.now();
    const routerStart = performance.now();
    const terms = tokenize(question);
    const matched = [...this.entities.keys()].filter((name) => new RegExp(`(^|[^\\w])${escapeRegExp(name)}([^\\w]|$)`, "i").test(question));
    matched.sort((a, b) => question.toLowerCase().indexOf(a.toLowerCase()) - question.toLowerCase().indexOf(b.toLowerCase()));
    const relational = (question.match(/\b(connect(?:s|ed|ing|ion)?|relationship|relate(?:s|d|ion)?|between|path|link(?:s|ed|ing)?|route(?:s|d|ing)?)\b/gi) || []).length;
    const interrogative = Number(/^\s*(how|why|which|what|who|where|when)\b/i.test(question));
    const density = Math.min(1, matched.length / Math.max(1, terms.length));
    const strategy: QueryResult["strategy"] = relational && matched.length >= 2 ? "graph" : interrogative && terms.length <= 8 && !relational ? "text" : "hybrid";
    const confidence = Math.min(1, 0.45 + Number(Boolean(relational)) * 0.15 + interrogative * 0.12 + density * 0.2);
    const routerMs = Math.max(0, performance.now() - routerStart);

    const retrievalStart = performance.now();
    const queryCounts = countTerms(terms);
    const df = new Map<string, number>();
    this.chunkList.forEach((chunk) => new Set(tokenize(chunk.text)).forEach((term) => df.set(term, (df.get(term) || 0) + 1)));
    const nDocs = this.chunkList.length;
    const idf = (term: string) => nDocs ? Math.log((1 + nDocs) / (1 + (df.get(term) || 0))) + 1 : 0;
    const queryVector = new Map<string, number>();
    queryCounts.forEach((count, term) => queryVector.set(term, count / Math.max(1, terms.length) * idf(term)));
    const queryNorm = Math.sqrt([...queryVector.values()].reduce((sum, value) => sum + value * value, 0));
    const rankedAll = this.chunkList.map((chunk) => {
      const words = tokenize(chunk.text);
      const counts = countTerms(words);
      const norm = Math.sqrt([...queryVector.keys()].reduce((sum, term) => {
        const tf = (counts.get(term) || 0) / Math.max(1, words.length);
        const weight = idf(term);
        return sum + (tf * weight) ** 2;
      }, 0));
      const dot = [...queryVector].reduce((sum, [term, value]) => {
        const tf = (counts.get(term) || 0) / Math.max(1, words.length);
        return sum + value * tf * idf(term);
      }, 0);
      return { chunk, score: queryNorm && norm ? dot / (queryNorm * norm) : 0 };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);
    const ranked = strategy === "graph" ? [] : rankedAll;
    const traversal = strategy === "text" ? { nodes: [], edges: [] as Edge[] } : this.bfs(matched, 2);
    const path = strategy !== "text" && matched.length >= 2 ? this.shortestPath(matched[0], matched[1]) : [];
    const selectedEdges = [...new Set([...traversal.edges, ...path])];
    const retrievalMs = Math.max(0, performance.now() - retrievalStart);
    const facts = selectedEdges.map((edge) => `${edge.source} -> ${edge.relation} -> ${edge.target} [${edge.chunk_id}]`);
    const sourceChunks = ranked.map(({ chunk, score }) => ({ id: chunk.chunk_id, source: chunk.source, text: chunk.text, score: Number(score.toFixed(4)) }));
    const lines: string[] = [];
    if (facts.length) lines.push(`Heuristically extracted graph relationships: ${facts.slice(0, 6).join("; ")}.`);
    if (path.length && matched.length) {
      let current = matched[0];
      let chain = current;
      path.forEach((edge) => {
        if (edge.source === current) { chain += ` -[${edge.relation}]-> ${edge.target}`; current = edge.target; }
        else { chain += ` <-[${edge.relation}]- ${edge.source}`; current = edge.source; }
      });
      lines.push(`Shortest path: ${chain}.`);
    }
    if (strategy !== "text" && matched.length >= 2 && !path.length) {
      lines.push(`No directed path was found from ${matched[0]} to ${matched[1]} in the extracted graph.`);
    }
    const evidence = ranked.flatMap(({ chunk }) => splitSentences(chunk.text)
      .map((sentence) => ({ sentence, id: chunk.chunk_id, hits: tokenize(sentence).filter((term) => queryCounts.has(term)).length }))
      .filter((item) => item.hits > 0)).sort((a, b) => b.hits - a.hits).slice(0, 3);
    evidence.forEach(({ sentence, id }) => lines.push(`${sentence} [${id}]`));
    if (!lines.length) lines.push("I couldn't find a grounded answer in the ingested documents for that question.");
    const totalMs = Math.max(0, performance.now() - started);
    const cypher = selectedEdges.map((edge) => `MATCH (s)-[r:${edge.relation}]->(o) WHERE s.name = '${edge.source.replace(/'/g, "''")}' AND o.name = '${edge.target.replace(/'/g, "''")}'`).join("\n");
    return {
      answer: lines.join(" "), hops: path.length || (selectedEdges.length || ranked.length ? 1 : 0),
      chunks_used: ranked.length, graph_facts_used: facts.length, strategy,
      confidence: Number(confidence.toFixed(2)),
      trace: [
        { agent: "Router", status: "done", detail: `Selected ${strategy}; confidence ${confidence.toFixed(2)}; relational=${relational}, interrogative=${interrogative}, entityDensity=${density.toFixed(3)}.`, ms: Number(routerMs.toFixed(2)), strategy, confidence: Number(confidence.toFixed(2)) },
        { agent: "Extractor / Retriever", status: "done", detail: `TF-IDF cosine scores ${ranked.map((item) => item.score.toFixed(4)).join(", ") || "(no matches)"}; BFS visited ${traversal.nodes.length} nodes. Cypher: ${cypher || "(no traversal)"}`, ms: Number(retrievalMs.toFixed(2)) },
        { agent: "Synthesizer", status: "done", detail: `Extractive answer from ${ranked.length} chunks and ${facts.length} heuristic graph triplets.`, ms: Number(Math.max(0, totalMs - routerMs - retrievalMs).toFixed(2)) },
      ],
      highlighted_nodes: traversal.nodes, highlighted_edges: selectedEdges.map(({ source, target, relation }) => ({ source, target, relation })),
      source_chunks: sourceChunks, graph_facts: facts, features: { relational_terms: relational, interrogative, entity_density: Number(density.toFixed(3)), matched_entities: matched },
    };
  }
}

function countTerms(tokens: string[]): Map<string, number> {
  const result = new Map<string, number>();
  tokens.forEach((token) => result.set(token, (result.get(token) || 0) + 1));
  return result;
}

function extractRelation(sentence: string, names: string[]): { source: string; target: string; predicate: string } | null {
  const match = PREDICATES.map(([pattern, predicate]) => {
    const found = pattern.exec(sentence);
    return found ? { found, predicate } : null;
  }).find((candidate) => candidate !== null);
  if (!match || /\b(?:not|never|no)\b/i.test(sentence.slice(Math.max(0, match.found.index - 24), match.found.index))) return null;
  const occurrences = names.flatMap((name) => {
    const index = sentence.toLowerCase().indexOf(name.toLowerCase());
    return index < 0 ? [] : [{ start: index, end: index + name.length, name }];
  });
  const passive = /\b(?:is|are|was|were|been|being)\s+(?:used|utilized|orchestrated|written|stored|persisted|computed|calculated|ranked|routed|powered|prevented|connected|linked|retrieved|extracted|contained|combined|created|generated|enabled|supported)\s+by\b/i.exec(sentence);
  if (passive) {
    const patients = occurrences.filter((entry) => entry.end <= passive.index);
    const actors = occurrences.filter((entry) => entry.start >= passive.index + passive[0].length);
    if (!patients.length || !actors.length) return null;
    return {
      source: actors.reduce((left, right) => left.start < right.start ? left : right).name,
      target: patients.reduce((left, right) => left.start > right.start ? left : right).name,
      predicate: match.predicate,
    };
  }
  const before = occurrences.filter((entry) => entry.end <= match.found.index);
  const after = occurrences.filter((entry) => entry.start >= match.found.index + match.found[0].length);
  if (!before.length || !after.length) return null;
  const source = before.reduce((left, right) => left.start > right.start ? left : right).name;
  const target = after.reduce((left, right) => left.start < right.start ? left : right).name;
  return source === target ? null : { source, target, predicate: match.predicate };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const ENTERPRISE_DEMO: { name: string; text: string }[] = [
  { name: "01_transformers.txt", text: "The Transformer Architecture was introduced by Google in 2017. Transformer models use Self-Attention to compute token relationships and enable parallel processing. BERT is built on the Transformer architecture. GPT models use Transformer blocks and Self-Attention." },
  { name: "02_gpt_family.txt", text: "OpenAI released GPT and ChatGPT. GPT models use the Transformer architecture. ChatGPT is built on GPT and conversational training. OpenAI uses large language models to generate text." },
  { name: "03_retrieval_augmented_generation.txt", text: "Retrieval-Augmented Generation, abbreviated RAG, combines document retrieval with language models. GraphRAG uses a Knowledge Graph to connect entities and retrieve multi-hop facts. RAG retrieves relevant text chunks and reduces hallucination. The Extractor extracts entities, the Router routes queries, and the Synthesizer combines source evidence." },
  { name: "04_graph_algorithms.txt", text: "The Property Graph stores entities and typed relationships. BFS computes graph neighborhoods and shortest paths. Dijkstra computes weighted paths. PageRank computes the centrality metric for important hub entities. TF-IDF computes document relevance using term frequency and inverse document frequency. Cosine Similarity compares query and chunk vectors." },
  { name: "05_local_system.txt", text: "The Multi-Agent System uses an Extractor, Router, and Synthesizer. The TypeScript engine powers the browser graph and Python powers the FastAPI backend. The Router routes relational questions to graph traversal and conceptual questions to Vector Search. The Synthesizer uses source chunks and graph triplets to produce a grounded answer." },
];

export function demoChunks(): TextChunk[] {
  return ENTERPRISE_DEMO.flatMap((document) => chunkText(document.text, document.name));
}
