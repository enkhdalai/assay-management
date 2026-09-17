import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../packages/shared/src/bullion-calculation.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { calculateBullion, calculateSilverBullion } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const entries = [[248.27,196.64,'yes'],[248.99,197.27,'yes'],[249.85,246.23,'addition'],[0,0,'no']].map(([a,b,calculation])=>({receivedWeightGrams:a/1000,outputWeightGrams:b/1000,calculation}));
test('fire assay reproduces laboratory example with signed mass delta and full-precision average',()=>{
 const result=calculateBullion(entries,15.58,-0.03125);
 assert.deepEqual(result.errors,[]);
 assert.deepEqual(result.weightEntries.map(r=>r.goldAssay?.toFixed(2)),['791.92','792.16','985.39',undefined]);
 assert.equal(result.goldResult.toFixed(2),'792.04');
 assert.equal(result.silverResult.toFixed(2),'193.35');
 assert.equal(result.remainingMilligrams.toFixed(2),'14832.89');
 assert.equal(result.lossMilligrams.toFixed(2),'106.97');
 assert.equal(result.returnedMilligrams.toFixed(2),'640.14');
});
test('no rows are excluded from average but retain per-row fineness',()=>{
 const result=calculateBullion(entries.map((r,i)=>i===1?{...r,calculation:'no'}:r),15.58,-0.03125);
 assert.equal(result.goldResult,result.weightEntries[0].goldAssay);
 assert(result.weightEntries[1].goldAssay);
});
test('invalid, missing, out-of-range and ambiguous rows never produce final results',()=>{
 for(const rows of [[{...entries[0],receivedWeightGrams:0}], [{...entries[0],outputWeightGrams:1}], [...entries,entries[2]], [{...entries[0],outputWeightGrams:NaN}]]) {
  const result=calculateBullion(rows,15.58,-0.03125);
  assert(result.errors.length); assert.equal(result.goldResult,undefined);
 }
 assert(calculateBullion(entries,0.1,-0.03125).errors.length);
 const noAdditional=calculateBullion(entries.slice(0,2),15.58,-0.03125);
 assert(noAdditional.goldResult);assert.equal(noAdditional.silverResult,undefined);
});
test('silver titrimetric calculation averages selected titration rows', () => {
 const rows = [[200, 36, 'yes'], [202, 36.3, 'addition'], [0, 0, 'no'], [0, 0, 'no']]
  .map(([weight, volume, calculation]) => ({ receivedWeightGrams: weight / 1000, outputWeightGrams: volume, calculation }));
 const result = calculateSilverBullion(rows, 2, { method: 'titrimetric', titerMilligramsPerMilliliter: 5555 });
 assert.deepEqual(result.errors, []);
 assert.equal(result.weightEntries[0].silverAssay.toFixed(2), '999.90');
 assert.equal(result.weightEntries[1].silverAssay.toFixed(2), '998.25');
 assert.equal(result.silverResult.toFixed(2), '999.00');
});
test('silver calculation follows the assay-center worksheet and rounds the final average', () => {
 const rows = [[201.70, 36.20, 'yes'], [200.11, 35.90, 'yes'], [0, 0, 'no'], [0, 0, 'no']]
  .map(([weight, volume, calculation]) => ({ receivedWeightGrams: weight / 1000, outputWeightGrams: volume, calculation }));
 const result = calculateSilverBullion(rows, 3.790, { method: 'titrimetric', titerMilligramsPerMilliliter: 5555 });
 assert.deepEqual(result.errors, []);
 assert.equal(result.weightEntries[0].silverAssay.toFixed(2), '996.98');
 assert.equal(result.weightEntries[1].silverAssay.toFixed(2), '996.57');
 assert.equal(result.silverResult.toFixed(2), '997.00');
});
test('silver rhodanometric calculation uses blank minus endpoint volume', () => {
 const rows = [{ receivedWeightGrams: 0.2, outputWeightGrams: 4, calculation: 'yes' }];
 const result = calculateSilverBullion(rows, 0.2, { method: 'rhodanometric', titerMilligramsPerMilliliter: 5000, blankVolumeMilliliters: 44 });
 assert.deepEqual(result.errors, []);
 assert.equal(result.weightEntries[0].silverAssay, 1000);
 assert.equal(result.silverResult, 1000);
 const withoutBlank = calculateSilverBullion(rows, 0.2, { method: 'rhodanometric', titerMilligramsPerMilliliter: 5000 });
 assert.deepEqual(withoutBlank.errors, []);
 assert.equal(withoutBlank.silverResult, 100);
});
