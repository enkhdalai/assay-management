import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../packages/shared/src/bullion-numbering.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { formatBullionNumber, previewBullionNumber } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("bullion numbers preserve center prefixes and leading zeros without truncating at 9999", () => {
  for (const prefix of ["", "55", "22", "27"]) {
    assert.equal(formatBullionNumber(prefix, 1), prefix + "0001");
    assert.equal(previewBullionNumber(prefix + "0001", prefix, 7), prefix + "0008");
    assert.equal(previewBullionNumber(prefix + "9999", prefix, 1), prefix + "10000");
  }
});
