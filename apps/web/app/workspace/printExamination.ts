import type { AnonymousSample, CertificateEntry } from "../../../../packages/shared/src/bullion-types";

export type ExaminationPrintData = {
  customerName: string; centerName: string; centerType?: string; bullionNo: string; bullionWeightGrams: number;
  origin: string | null; registrationNo?: string; chemistName: string; managerName?: string | null; printedAt: string; sample: AnonymousSample;
  certificateNo: string; issuedAt: string; entries: CertificateEntry[];
};

export async function printExamination(popup: Window, data: ExaminationPrintData) {
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  if (!data.certificateNo || !data.entries?.length) throw new Error("Сорилтын дүнгийн дугаар болон бүх дээжийн мэдээлэл шаардлагатай. Дахин хэвлэнэ үү.");
  if (data.centerType !== "private_assay_center" && data.centerType !== "government_assay_center") {
    throw new Error("Төвийн төрөл тодорхойгүй байна. Хуудсыг шинэчлээд дахин хэвлэнэ үү.");
  }
  const logo = (path: string, width: number, name: string) => `<img src="${escape(new URL(path, window.location.origin).href)}" style="width:${width}mm;height:18mm;object-fit:contain" alt="${escape(name)}">`;
  const privateCenter = data.centerType === "private_assay_center";
  const signatureName = (name?: string | null) => {
    const parts = name?.trim().split(/\s+/) ?? [];
    return parts.length === 2 ? `${Array.from(parts[0])[0]}.${parts[1]}` : parts.join(" ");
  };
  const reportDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "__________________";
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
  };
  const managerName = signatureName(data.managerName);
  const details = privateCenter
    ? `<div class="private-details"><div>Дээжийг ирүүлсэн газар: <strong>${escape(data.customerName)}</strong></div><div class="report-date">Олгосон огноо: <strong>${escape(reportDate(data.issuedAt))}</strong></div>
      <div>Дээж авсан хүний нэр, албан тушаалтан: <strong>Лабораторийн эрхлэгч, ${escape(managerName || "__________________")}</strong></div><div class="report-date">Хүлээн авсан огноо: <strong>${escape(reportDate(data.sample.receivedAt))}</strong></div>
      <div>Шинжилгээний аргын стандарт: <strong>MNS ISO 11426:2022</strong></div></div>`
    : `<div class="public-details"><div>Дугаар №: <strong>${escape(data.certificateNo)}</strong></div>
      <div>Шинжилгээний аргын стандарт: <strong>MNS ISO 11426:2022</strong></div><div class="report-date">Олгосон: <strong>${escape(reportDate(data.issuedAt))}</strong></div>
      <div class="public-customer">Дээжийг ирүүлсэн газрын нэр: <strong>${escape(data.customerName)}</strong></div><div class="report-date">Хүлээн авсан: <strong>${escape(reportDate(data.sample.receivedAt))}</strong></div>
      <div style="grid-column:1 / -1">Дээжийг авсан хүний нэр, албан тушаал: <strong>Лабораторийн эрхлэгч ${escape(managerName || "__________________")}</strong></div></div>`;
  const signatures = privateCenter
    ? `<section class="private-signatures" aria-label="Гарын үсэг, тамга">
      <div class="signature-row"><span>ШИНЖИЛГЭЭ ГҮЙЦЭТГСЭН: <strong>ХИМИ-ШИНЖЭЭЧ</strong></span><span class="signature-line"></span><strong>${escape(signatureName(data.chemistName))}</strong></div>
      <div class="signature-row"><span>ХЯНАЖ, БАТАЛГААЖУУЛСАН: <strong>ЛАБОРАТОРИЙН ЭРХЛЭГЧ</strong></span><span class="signature-line"></span><strong>${escape(managerName)}</strong></div>
      <div class="signature-row"><span>ХҮЛЭЭН АВСАН:</span><span class="signature-line"></span><span class="signature-line"></span></div>
      </section><div class="private-notice">Энэхүү сорилтын дүн нь зөвхөн шинжилгээ хийсэн сорьцод хамаарна.<br>
      Сорьцын дүнг лабораторийн зөвшөөрөлгүйгээр хуулбарлахыг хориглоно.</div>`
    : `<div class="public-notice"><span>Зөвшөөрөлгүйгээр хуулбарлахыг хориглоно.</span><span>Зөвхөн энэ шинжилгээнд хүчинтэй</span></div>
      <section class="public-signatures" aria-label="Гарын үсэг, тамга">
      <div class="signature-row"><span>Шинжилгээ гүйцэтгэсэн <strong>химич</strong>:</span><span class="signature-line"></span><strong>${escape(signatureName(data.chemistName))}</strong></div>
      <div class="signature-row"><span>Хянаж баталгаажуулсан <strong>лабораторийн эрхлэгч</strong>:</span><span class="signature-line"></span><strong>${escape(managerName)}</strong></div>
      <div class="signature-row"><span>Хүлээн авсан:</span><span class="signature-line"></span><span class="signature-line"></span></div></section>`;
  const footer = privateCenter ? ""
    : `<footer style="border-top:1px solid #111;padding-top:2mm;text-align:center;font-size:8px">Монгол улс, Улаанбаатар хот, Хан-Уул дүүрэг 3-р хороо, Сорьцын хяналтын газар, Утас: 77005757, 18002525<br>Архивын хувь · Тоон гарын үсгээр баталгаажаагүй</footer>`;
  const branding = privateCenter
    ? `<div>${logo('/mnas-logo.jpg', 18, 'MNAS')}</div><div class="company-contact"><strong>ҮНЭТ МЕТАЛЛЫН СОРЬЦЫН ТӨВ ХХК</strong><br>Хаяг: Улаанбаатар хот, ХУД, 3-р хороо<br>Email: assaylabmon@gmail.com</div><div>${logo('/private_comp_logo.webp', 50, 'ҮМСТ')}</div>`
    : `${logo('/masm.png', 58, 'MASM')}<div style="display:flex;gap:3mm">${logo('/ilac-mra.png', 18, 'ILAC-MRA')}${logo('/mnas-logo.jpg', 18, 'MNAS')}</div>`;
  const tableRows = data.entries.map((entry, index) => {
    const cells = [index + 1, `${data.sample.metal === "gold" ? "Алтан" : "Мөнгөн"} гулдмай № ${entry.bullionNo}`, entry.bullionWeightGrams, entry.origin, entry.sampleWeightMilligrams,
      entry.remainingMilligrams, entry.returnedMilligrams, entry.lossMilligrams, entry.goldResult, entry.silverResult];
    return `<tr>${cells.map((value, column) => `<td>${escape(typeof value === "number" && column > 0 ? value.toFixed(2) : value ?? "-")}</td>`).join("")}</tr>`;
  }).join("");
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>Сорилтын дүн ${escape(data.certificateNo)}</title>
    <style>*{box-sizing:border-box}body{font:10px Arial,sans-serif;color:#111;margin:8mm;width:194mm}h1{font-size:14px;text-align:center;margin:0 0 4px}h2{font-size:12px;text-align:center;margin:0 0 8px}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:10px 0}th,td{border:1px solid #555;padding:4px;text-align:center;overflow-wrap:anywhere}th{font-weight:400}p{line-height:1.3;margin:6px 0;overflow-wrap:anywhere}.signatures{margin-top:14px}@page{size:A4 portrait;margin:8mm}@media print{body{margin:0;width:100%;max-height:132mm}}</style></head><body>
    <style>.report-header{display:flex;align-items:center;justify-content:space-between;min-height:23mm;border-bottom:1px solid #111;margin-bottom:3mm;padding-bottom:2mm;box-sizing:border-box}.report-header.private{display:grid;grid-template-columns:50mm minmax(0,1fr) 50mm;gap:3mm}.company-contact{text-align:center;font-size:10px;line-height:1.4;overflow-wrap:anywhere}.report-header img{display:block;max-width:100%}</style>
    <header class="report-header${privateCenter ? ' private' : ''}">${branding}</header>
    <style>.private-details{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 12px;line-height:1.4}.private-details>div{overflow-wrap:anywhere}.report-date{text-align:right;white-space:nowrap}.private-signatures{width:94%;margin:28px auto 12px;break-inside:avoid}.signature-row{display:grid;grid-template-columns:minmax(0,1fr) 30mm 28mm;align-items:end;gap:3mm;min-height:10mm;padding-bottom:2mm;line-height:1.4}.signature-line{border-bottom:1px solid #111;min-height:14px}.private-notice{text-align:center;font-size:8px;line-height:1.4;margin:10px 0;break-inside:avoid}</style>
    <style>.public-details{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto;gap:8px 16px;line-height:1.4}.public-details>div{overflow-wrap:anywhere}.public-customer{grid-column:1 / 3}.public-notice{display:flex;justify-content:space-between;gap:16px;font-size:8px}.public-signatures{width:78%;margin:28px auto 16px;break-inside:avoid}.public-signatures .signature-row>span:first-child{text-align:right}.signature-row>span{overflow-wrap:anywhere}</style>
    <style>tr{break-inside:avoid}thead{display:table-header-group}@media print{body{max-height:none}}</style>
    <h2>${privateCenter ? `ИТГЭМЖЛЭГДСЭН ЛАБОРАТОРИЙН СОРИЛТЫН ДҮН № ${escape(data.certificateNo)}` : 'ҮНЭТ МЕТАЛЛЫН СОРЬЦ ТОГТООХ ИТГЭМЖЛЭГДСЭН<br>ЛАБОРАТОРИЙН СОРИЛТЫН ДҮН'}</h2>
    ${details}
    <p style="text-align:right">Жин мг-аар · Сорьц ‰</p>
    <table><colgroup><col style="width:3%"><col style="width:25%"><col style="width:10%"><col style="width:6%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:8%"><col style="width:8%"></colgroup><thead><tr>
    <th rowspan="2">№</th><th rowspan="2">Үнэт металл,<br>тэдгээрээр хийсэн<br>эдлэлийн нэр</th><th rowspan="2">Гулдмайн<br>жин /гр/</th><th rowspan="2">Гарал<br>үүсэл</th><th rowspan="2">Шинжилгээнд<br>авсан дээжийн<br>жин</th><th colspan="2">Буцааж олгосон<br>дээжийн</th><th rowspan="2">Шинжилгээгээр<br>гарсан<br>хорогдол</th><th colspan="2">Тогтоосон<br>сорьц</th></tr><tr><th>жин</th><th>Королько<br>корточка</th><th>Алтны</th><th>Мөнгөний</th></tr></thead><tbody>${tableRows}</tbody></table>
    ${signatures}${footer}</body></html>`);
  popup.document.close();
  await Promise.all(Array.from(popup.document.images).map((img) => img.decode()));
  popup.focus();
  popup.print();
}
