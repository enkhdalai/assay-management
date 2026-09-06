import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../apps/web/app/workspace/printExamination.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { printExamination } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

test("private print details, local ISO dates, escaped names and signature layout", async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { origin: "https://report.test" } };
  try {
    let html = "", printed = false;
    const popup = { document: { open() {}, write(value) { html = value; }, close() {}, images: [] }, focus() {}, print() { printed = true; } };
    const data = {
      centerType: "private_assay_center", centerName: "Test center", customerName: "Company <test>",
      registrationNo: "BI-001676", bullionNo: "123", bullionWeightGrams: 100, origin: null, chemistName: "Бат Энхжаргал", managerName: "Жамбал Батбаатар",
      printedAt: "2026-09-06T18:00:00Z", sample: { analysisNo: "3", revisionNo: 1, metal: "gold",
        receivedAt: "2026-09-05T18:00:00Z", sampleWeightMilligrams: 7500, examination: { measurementEntries: [] } },
    };
    data.certificateNo = "0924";
    data.issuedAt = "2026-09-06T18:00:00Z";
    data.entries = Array.from({ length: 8 }, (_, index) => ({ analysisNo: String(index + 1), bullionNo: String(123 + index),
      bullionWeightGrams: 100 + index, origin: "Test", sampleWeightMilligrams: 7500, remainingMilligrams: 6800,
      returnedMilligrams: 600, lossMilligrams: 100, goldResult: 792 + index, silverResult: 193, chemistName: "Test chemist" }));
    await printExamination(popup, data);
    assert(printed);
    assert(html.includes("ИТГЭМЖЛЭГДСЭН ЛАБОРАТОРИЙН СОРИЛТЫН ДҮН № 0924"));
    assert.equal((html.split("<tbody>")[1].split("</tbody>")[0].match(/<tr>/g) ?? []).length, 8);
    assert(html.includes("Дээжийг ирүүлсэн газар: <strong>Company &lt;test&gt;</strong>"));
    assert(html.includes("Лабораторийн эрхлэгч, Ж.Батбаатар"));
    assert(html.includes("Олгосон огноо: <strong>2026-09-07</strong>"));
    assert(html.includes("Хүлээн авсан огноо: <strong>2026-09-06</strong>"));
    assert(html.includes("Шинжилгээний аргын стандарт: <strong>MNS ISO 11426:2022</strong>"));
    assert(html.includes("<strong>Б.Энхжаргал</strong>"));
    assert(html.includes("<strong>ХИМИ-ШИНЖЭЭЧ</strong>"));
    assert.equal((html.match(/class="signature-row"/g) ?? []).length, 3);
    assert(html.indexOf('class="private-signatures"') > html.indexOf("</table>"));
    assert(html.includes("Сорьцын дүнг лабораторийн зөвшөөрөлгүйгээр хуулбарлахыг хориглоно."));
    assert(!html.includes("Тоон гарын үсгээр баталгаажаагүй"));
    assert(!html.includes("Сориптым дуне"));
    assert(!html.includes("<footer"));
    assert(!html.includes(data.centerName));
    await printExamination(popup, { ...data, managerName: null });
    assert(html.includes("Лабораторийн эрхлэгч, __________________"));
    await printExamination(popup, { ...data, centerType: "government_assay_center" });
    assert(!html.includes('class="private-details"'));
    assert(!html.includes('class="private-signatures"'));
    assert(html.includes("Дугаар №: <strong>0924</strong>"));
    assert(html.includes("Шинжилгээний аргын стандарт: <strong>MNS ISO 11426:2022</strong>"));
    assert(html.includes("Олгосон: <strong>2026-09-07</strong>"));
    assert(html.includes("Хүлээн авсан: <strong>2026-09-06</strong>"));
    assert(html.includes('class="public-signatures"'));
    assert(html.includes("<strong>Ж.Батбаатар</strong>"));
    assert(html.includes("Дээжийг авсан хүний нэр, албан тушаал: <strong>Лабораторийн эрхлэгч Ж.Батбаатар</strong>"));
    assert(html.includes("Утас: 77005757, 18002525"));
    assert(html.includes("Тоон гарын үсгээр баталгаажаагүй"));
  } finally {
    globalThis.window = previousWindow;
  }
});
