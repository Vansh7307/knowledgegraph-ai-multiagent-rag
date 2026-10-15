const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  module._compile(compiled, filename);
};

const testPath = path.join(__dirname, "..", "src", "__tests__", "benchmark.test.ts");
require(testPath).runBenchmarkTest();
process.stdout.write("TypeScript engine benchmark assertions passed.\n");
