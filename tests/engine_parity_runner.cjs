const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "frontend", "node_modules", "typescript"));
const sourcePath = path.join(root, "frontend", "src", "lib", "scratchEngine.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    lib: ["ES2020", "DOM"],
  },
}).outputText;
const engineModule = new Module(sourcePath, module);
engineModule.filename = sourcePath;
engineModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
engineModule._compile(compiled, sourcePath);

const fixture = JSON.parse(fs.readFileSync(0, "utf8"));
const engine = new engineModule.exports.ScratchGraphRAG();
engine.ingest(fixture.chunks);
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const graph = engine.graphData();
const result = {
  nodes: graph.nodes.map(({ id, type, degree, in_degree, out_degree, pagerank }) => ({
    id, type, degree, in_degree, out_degree, pagerank: Number(pagerank.toFixed(6)),
  })).sort((a, b) => compareText(a.id, b.id)),
  edges: graph.links.map(({ source, target, relation, chunk_id }) => ({ source, target, relation, chunk_id }))
    .sort((a, b) => compareText([a.source, a.target, a.relation, a.chunk_id].join("\u0000"),
      [b.source, b.target, b.relation, b.chunk_id].join("\u0000"))),
  traversal: engine.traverse(fixture.traversal.starts, fixture.traversal.max_hops),
  queries: fixture.queries.map((question) => {
    const query = engine.query(question);
    return {
      strategy: query.strategy,
      confidence: query.confidence,
      confidence_breakdown: query.confidence_breakdown,
      hops: query.hops,
      path_nodes: query.path_nodes,
      ranked_chunks: query.source_chunks.map(({ id, score }) => ({ id, score })),
      graph_facts: query.graph_facts,
    };
  }),
};
result.traversal.nodes.sort(compareText);
result.traversal.edges.sort((a, b) => compareText([a.source, a.target, a.relation, a.chunk_id].join("\u0000"),
  [b.source, b.target, b.relation, b.chunk_id].join("\u0000")));
process.stdout.write(JSON.stringify(result));
