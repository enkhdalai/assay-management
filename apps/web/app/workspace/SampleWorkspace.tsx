"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Minus, ChevronLeft, ChevronRight, CircleCheck } from "lucide-react";
import type { AnonymousSample, SubmitBullionExaminationInput } from "../../../../packages/shared/src/bullion-types";
import { WorkspaceDialog } from "../OperationalWorkspace";
import { api } from "./api";
import { ChemistPicker } from "./ChemistPicker";
import { printExamination, type ExaminationPrintData } from "./printExamination";
import { calculateBullion, BULLION_CALCULATION_VERSION } from "../../../../packages/shared/src/bullion-calculation";
import { WorkspaceLoadingSkeleton } from "./WorkspaceLoadingSkeleton";

const statusLabels: Record<string, string> = { pending: "Хүлээгдэж байна", draft: "Шинжилгээнд", submitted: "Эрхлэгчийн хяналтад", approved: "Баталгаажсан", rejected: "Буцаасан", superseded: "Өмнөх хувилбар" };
const examinationNumber = (value: string) => value.padStart(4, "0");
const workflowDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function workflowDate(value?: string | null, includeTime = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return "-";
  const parts = workflowDateFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find(part => part.type === type)?.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return includeTime ? `${date} ${part("hour")}:${part("minute")}` : date;
}

export function SampleWorkspace({ manager = false, centerType }: { manager?: boolean; centerType?: string }) {
  const [samples, setSamples] = useState<AnonymousSample[]>([]);
  const [selected, setSelected] = useState<AnonymousSample | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const refresh = useCallback(() => api<{ data: AnonymousSample[] }>("/api/v1/bullion/samples")
    .then(({ data }) => {
      setSamples(data); setError("");
      setSelected(current => manager
        ? current ? data.find(sample => sample.id === current.id) ?? null : null
        : current ? data.find(sample => sample.id === current.id) ?? data[0] ?? null : data[0] ?? null);
    }).catch((error) => setError(error.message)).finally(() => setLoading(false)), [manager]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!manager) return;
    const refreshVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    const timer = window.setInterval(refreshVisible, 15000);
    return () => {
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
      window.clearInterval(timer);
    };
  }, [manager, refresh]);
  const workflowTimestamp = (sample: AnonymousSample) => Date.parse(sample.completedAt ?? sample.assignedAt ?? sample.receivedAt) || 0;
  const filtered = samples.filter((sample) => examinationNumber(sample.analysisNo).toLowerCase().includes(query.trim().toLowerCase()) && (!manager || status === "all" || status === sample.status))
    .sort((left, right) => workflowTimestamp(right) - workflowTimestamp(left) || Number(right.analysisNo) - Number(left.analysisNo));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 25));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * 25;
  const pageSamples = filtered.slice(offset, offset + 25);
  const chemistSamples = [...samples].sort((left, right) => {
    const newRequestOrder = Number(right.status === "pending") - Number(left.status === "pending");
    return newRequestOrder || Date.parse(right.receivedAt) - Date.parse(left.receivedAt) || Number(right.analysisNo) - Number(left.analysisNo);
  });
  if (!manager) return <section className="chemist-workstation">
    <aside className="chemist-sample-list" aria-label="Илгээгдсэн шинжилгээнүүд">
      <h2>Шинжилгээ №</h2>
      {loading ? <WorkspaceLoadingSkeleton rows={4} /> : <div className="chemist-sample-options" role="listbox" aria-label="Шинжилгээ сонгох">
        {chemistSamples.map((sample, index) => <button key={sample.id} type="button" role="option" aria-selected={selected?.id === sample.id} className="chemist-sample-option" onClick={() => setSelected(sample)}>
          <span>{index + 1}</span><strong>{sample.status === "pending" && <i className="new-sample-dot" aria-label="Шинэ хүсэлт" title="Шинэ хүсэлт" />}{examinationNumber(sample.analysisNo)}</strong>
        </button>)}
        {!samples.length && <p>Илгээгдсэн дээж алга байна.</p>}
      </div>}
    </aside>
    <div className="chemist-form-panel">
      {error && <p className="login-error" role="alert">{error}</p>}
      {selected && <SampleDialog key={selected.id} embedded manager={false} centerType={centerType} sample={selected} onClose={() => undefined} onSaved={() => { void refresh(); }} />}
      {!loading && !selected && !error && <p>Шинжилгээ сонгоно уу.</p>}
    </div>
  </section>;
  return <section className="workspace-section"><div className="workspace-toolbar"><input aria-label="Дээж хайх" placeholder="Шинжилгээний дугаараар хайх" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{manager && <select aria-label="Төлөв" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">Бүх төлөв</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}<button className="secondary-button" disabled={loading} onClick={refresh} type="button">Шинэчлэх</button></div>
    {error && <p className="login-error" role="alert">{error}</p>}
{loading ? <WorkspaceLoadingSkeleton /> : <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>№</th><th>Шинжилгээ №</th><th>Огноо</th><th>Металл</th><th>Дээжийн жин /мг/</th>{!manager && <th>Хувилбар</th>}{manager && <><th>Хариуцсан химич</th><th>Химичдийн явц</th><th>Химичид хуваарилсан огноо</th><th>Шинжилгээ дууссан огноо</th></>}<th>Төлөв</th></tr></thead><tbody>{pageSamples.map((sample, index) => <tr key={sample.id} className={manager ? "manager-sample-row" : "chemist-sample-row"} tabIndex={manager ? 0 : undefined}
  onClick={manager ? () => setSelected(sample) : undefined}
  onKeyDown={manager ? (event) => {
    if ((event.key !== "Enter" && event.key !== " ") || (event.target instanceof HTMLElement && event.target.closest("button, input, select, a"))) return;
    event.preventDefault(); setSelected(sample);
  } : undefined}>
  <td>{offset + index + 1}</td><td><button className={`workspace-link${manager ? " sample-number-button" : ""}`} type="button" onClick={() => setSelected(sample)}>{examinationNumber(sample.analysisNo)}</button></td>
  <td>{workflowDate(sample.receivedAt, false)}</td><td>{sample.metal === "gold" ? "Алт" : "Мөнгө"}</td><td>{sample.sampleWeightMilligrams.toLocaleString()}</td>
  {!manager && <td>{sample.revisionNo || "-"}</td>}{manager && <><td><ChemistPicker sample={sample} onSaved={refresh} /></td><td><BatchTimeline sample={sample} /></td>
    <td className="sample-workflow-date">{sample.assignedAt ? <time dateTime={sample.assignedAt}>{workflowDate(sample.assignedAt)}</time> : "-"}</td>
    <td className="sample-workflow-date">{sample.completedAt ? <time dateTime={sample.completedAt}>{workflowDate(sample.completedAt)}</time> : "-"}</td></>}
  <td>{statusLabels[sample.status] ?? sample.status}</td></tr>)}</tbody></table>{filtered.length === 0 && <p>Дээж олдсонгүй.</p>}</div>}
    {!loading && filtered.length > 0 && <nav className="sample-pagination" aria-label="Хуудаслалт">
      <span>{offset + 1}–{Math.min(offset + 25, filtered.length)} / {filtered.length}</span>
      <button type="button" className="secondary-button" aria-label="Өмнөх хуудас" title="Өмнөх хуудас" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
      <span>{currentPage} / {pageCount}</span>
      <button type="button" className="secondary-button" aria-label="Дараах хуудас" title="Дараах хуудас" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
    </nav>}
    {selected && <SampleDialog key={manager ? `${selected.id}:${selected.revisionNo}:${selected.status}` : selected.id} manager={manager} centerType={centerType} sample={selected} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); void refresh(); }} />}
  </section>;
}

function BatchTimeline({ sample }: { sample: AnonymousSample }) {
  const progress = sample.batchProgress ?? [];
  if (!progress.length) return "-";
  return <div className="batch-timeline" aria-label="Химичдийн явц">{progress.map((chemist) => {
    const complete = chemist.assignedCount > 0 && chemist.completedCount === chemist.assignedCount;
    return <span key={chemist.chemistId} className={complete ? "timeline-complete" : "timeline-pending"} title={`${chemist.chemistName}: ${chemist.completedCount}/${chemist.assignedCount}`}>
      {complete ? <CircleCheck size={17} aria-hidden="true" /> : <i aria-hidden="true" />}<span>{chemist.chemistName} {chemist.completedCount}/{chemist.assignedCount}</span>
    </span>;
  })}</div>;
}

function SampleDialog({ sample, manager, centerType, onClose, onSaved, embedded = false }: { sample: AnonymousSample; manager: boolean; centerType?: string; onClose(): void; onSaved(): void; embedded?: boolean }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const examination = sample.examination;
  const [reexamination, setReexamination] = useState(examination?.reexaminationRequested ?? false);
  const notesRef = useRef<HTMLInputElement>(null);
  const focusNotes = useRef(false);
  useEffect(() => {
    if (reexamination && focusNotes.current) {
      notesRef.current?.focus({ preventScroll: true });
      focusNotes.current = false;
    }
  }, [reexamination]);
  const [weightRowCount, setWeightRowCount] = useState(Math.max(4, examination?.weightEntries.length ?? 0));
  const [submitted, setSubmitted] = useState(sample.status === "submitted");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [substituteChoices, setSubstituteChoices] = useState<{ id: string; fullName: string }[] | null>(null);
  const [substituteChemist, setSubstituteChemist] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [totals, setTotals] = useState([0, 0]);
  const [canCalculate, setCanCalculate] = useState(false);
  const updateTotals = useCallback(() => {
    setTotals(["received", "output"].map((prefix) => Array.from(formRef.current?.querySelectorAll<HTMLInputElement>(`input[name^="${prefix}-"]`) ?? [])
      .reduce((sum, input) => sum + (Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0), 0)));
    setCanCalculate(Array.from(formRef.current?.querySelectorAll<HTMLInputElement>('input[name^="received-"]') ?? []).some((input) => {
      const output = formRef.current?.querySelector<HTMLInputElement>(`input[name="${input.name.replace("received-", "output-")}"]`);
      return input.validity.valid && input.valueAsNumber > 0 && !!output?.validity.valid && output.valueAsNumber > 0;
    }));
  }, []);
  useEffect(updateTotals, [weightRowCount, updateTotals]);
  const editable = !manager && !submitted && ["pending", "draft"].includes(sample.status);
  function clearZero(input: HTMLInputElement) {
    if (input.valueAsNumber === 0) input.value = "";
    updateTotals();
  }
  function invalidateCalculation() {
    formRef.current?.querySelectorAll<HTMLInputElement>('[data-calculated]').forEach(input => { input.value = ""; });
    setHasUnsavedChanges(true);
    setError("");
  }
  function weightInput() { updateTotals(); invalidateCalculation(); }
  function readWeights(form: FormData) {
    return Array.from({ length: weightRowCount }, (_, index) => ({
      receivedWeightGrams: Number(form.get(`received-${index}`)) / 1000,
      outputWeightGrams: Number(form.get(`output-${index}`)) / 1000,
      calculation: String(form.get(`calculation-${index}`)) as "yes" | "no" | "addition",
    }));
  }
  function calculate(form = new FormData(formRef.current!)) {
    const result = calculateBullion(readWeights(form), sample.sampleWeightMilligrams / 1000, sample.delta);
    const values: Record<string, number | undefined> = {
      goldResult: result.goldResult, silverResult: result.silverResult,
      'measurement-1': result.remainingMilligrams, 'measurement-2': result.lossMilligrams, 'measurement-3': result.returnedMilligrams,
    };
    result.weightEntries.forEach((entry, index) => { values[`gold-${index}`] = entry.goldAssay; });
    for (const [name, value] of Object.entries(values)) {
      const input = formRef.current?.elements.namedItem(name) as HTMLInputElement | null;
      if (input) input.value = value == null || !Number.isFinite(value) ? "" : value.toFixed(2);
    }
    return result;
  }
  function checkCalculation() {
    if (!formRef.current?.reportValidity()) return;
    const result = calculate();
    setError(result.errors.join(" ") || (result.silverResult == null ? "Мөнгөний сорьц бодох Нэмэлт мөрийг оруулна уу." : ""));
  }
  async function chooseSubstituteChemist() {
    if (!examination || hasUnsavedChanges) {
      setError("Орлогч томилохын өмнө шинжилгээний дүнг Хадгалах товчоор хадгална уу.");
      return;
    }
    setSaving(true); setError("");
    try { const { data } = await api<{ data: { id: string; fullName: string }[] }>(`/api/v1/bullion/samples/${sample.id}/substitute-chemists`); setSubstituteChemist(""); setSubstituteChoices(data); }
    catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  async function substitute(chemistId: string) {
    if (!chemistId) return;
    setSaving(true); setError("");
    try { await api(`/api/v1/bullion/samples/${sample.id}/substitute`, { method: "POST", body: JSON.stringify({ chemistId }) }); onSaved(); }
    catch (error) { setSubstituteChemist(""); setError((error as Error).message); } finally { setSaving(false); }
  }
  async function approve() {
    setSaving(true); setError("");
    try { await api(`/api/v1/bullion/samples/${sample.id}/approve`, { method: "POST", body: JSON.stringify({}) }); onSaved(); }
    catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  async function finalizeCertificate() {
    if (!sample.batchId) return;
    setSaving(true); setError("");
    try { await api(`/api/v1/bullion/batches/${sample.batchId}/finalize`, { method: "POST", body: JSON.stringify({}) }); onSaved(); }
    catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  async function printArchiveReport() {
    if (!sample.batchId) return;
    const popup = window.open("", "_blank");
    if (!popup) { setError("Хэвлэх цонх хаагдсан байна. Pop-up зөвшөөрөөд дахин оролдоно уу."); return; }
    setSaving(true); setError("");
    try {
      const { data } = await api<{ data: ExaminationPrintData }>(`/api/v1/bullion/batches/${sample.batchId}/archive-print`, { method: "POST", body: JSON.stringify({}) });
      await printExamination(popup, { ...data, centerType: data.centerType ?? centerType });
    } catch (error) { popup.close(); setError((error as Error).message); } finally { setSaving(false); }
  }
  const measurements = ["Чек мөнгө", "Дээжийн үлдэгдэл жин", "Шинжилгээний хорогдол", "Королько, корточка"];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    const sendingForApproval = action === "submit";
    const form = new FormData(event.currentTarget);
    const status = sendingForApproval ? "submitted" : "draft";
    const calculated = editable ? calculate(form) : null;
    if (sendingForApproval && calculated && (calculated.errors.length || calculated.goldResult == null || calculated.silverResult == null)) {
      setError(calculated.errors.join(" ") || "Мөнгөний сорьц бодох Нэмэлт мөрийг оруулна уу."); return;
    }
    setSaving(true);
    const input: SubmitBullionExaminationInput = {
      bullionItemId: sample.id, examinationNo: sample.analysisNo, expectedRevision: sample.revisionNo,
      calculationVersion: BULLION_CALCULATION_VERSION,
      sampleWeightGrams: sample.sampleWeightMilligrams / 1000, delta: sample.delta, status,
      weightEntries: calculated?.weightEntries ?? readWeights(form),
      measurementEntries: measurements.map((label, index) => ({ label, reading: index === 0 ? Number(form.get('measurement-0')) : calculated ? [0, calculated.remainingMilligrams, calculated.lossMilligrams, calculated.returnedMilligrams][index] : Number(form.get(`measurement-${index}`)) })),
      goldResult: calculated?.goldResult, silverResult: calculated?.silverResult, notes: String(form.get("notes") || ""), reexaminationRequested: form.get("reexaminationRequested") === "on",
    };
    try {
      if (editable) { await api("/api/v1/bullion/examinations", { method: "POST", body: JSON.stringify(input) }); setHasUnsavedChanges(false); if (sendingForApproval) setSubmitted(true); }
      onSaved();
    }
    catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  const content = <>
    <dl className="examination-metadata">
      <div><dt>Огноо</dt><dd>{workflowDate(sample.receivedAt, false)}</dd></div>
      <div><dt>Дээжийн жин /мг/</dt><dd>{sample.sampleWeightMilligrams}</dd></div>
      <div><dt>Шинжилгээний №</dt><dd>{examinationNumber(sample.analysisNo)}</dd></div>
      <div><dt>Делта</dt><dd>{sample.delta}</dd></div>
    </dl>
    <form ref={formRef} className="workspace-form examination-form" autoComplete="off" onSubmit={submit}><fieldset disabled={saving}>
      <div className="examination-scroll"><div className="examination-columns">
        <div><table className="examination-table examination-weights"><colgroup><col /><col className="calculation-column" /><col /></colgroup>
          <thead><tr><th>Авсан жин /мг/</th><th>Бодолт</th><th>Гарсан жин /мг/</th></tr></thead>
          <tbody>{Array.from({ length: weightRowCount }, (_, index) => <tr key={index}>
            <td><input name={`received-${index}`} aria-label={`Авсан жин ${index + 1}`} type="number" disabled={!editable} min="0" step="0.0001" onInput={weightInput} onFocus={(event) => clearZero(event.currentTarget)} defaultValue={(examination?.weightEntries[index]?.receivedWeightGrams ?? 0) * 1000} /></td>
            <td><div className="examination-calculation" role="group" aria-label={`Бодолт ${index + 1}`}>
              {([["yes", "Тийм"], ["no", "Үгүй"], ["addition", "Нэмэлт"]] as const).map(([value, label]) => <label key={value}>
                <input type="radio" onChange={invalidateCalculation} disabled={!editable} name={`calculation-${index}`} value={value} defaultChecked={(examination?.weightEntries[index]?.calculation || "no") === value} />{label}
              </label>)}
            </div></td>
            <td><input name={`output-${index}`} aria-label={`Гарсан жин ${index + 1}`} type="number" disabled={!editable} min="0" step="0.0001" onInput={weightInput} onFocus={(event) => clearZero(event.currentTarget)} defaultValue={(examination?.weightEntries[index]?.outputWeightGrams ?? 0) * 1000} /></td>
          </tr>)}</tbody>
          <tfoot>{editable && reexamination && <tr><td><div className="examination-row-controls"><button type="button" className="secondary-button examination-add-row" aria-label="Шинжилгээний мөр нэмэх" title="Шинжилгээний мөр нэмэх" onClick={() => { invalidateCalculation(); setWeightRowCount((count) => count + 1); }}><Plus size={20} aria-hidden="true" /></button><button type="button" className="secondary-button examination-add-row" aria-label="Сүүлийн мөр хасах" title="Сүүлийн мөр хасах" disabled={weightRowCount <= 4} onClick={() => { invalidateCalculation(); setWeightRowCount((count) => Math.max(4, count - 1)); }}><Minus size={20} aria-hidden="true" /></button></div></td><td colSpan={2} /></tr>}
          </tfoot>
        </table>
        </div>
        <div className="examination-right"><table className="examination-table examination-measurements"><colgroup><col className="measurement-label-column" /><col /><col /></colgroup>
          <thead><tr><th aria-label="Хэмжилтийн нэр" /><th scope="col">Үзүүлэлт</th><th scope="col">Алтны сорьц ‰</th></tr></thead>
          <tbody>{Array.from({ length: weightRowCount }, (_, index) => <tr key={index}><th scope="row">{measurements[index]}</th>
            <td>{index < measurements.length && <input name={`measurement-${index}`} aria-label={measurements[index]} type="number" readOnly={index > 0} data-calculated={index > 0 ? true : undefined} disabled={!editable} min="0" step="0.0001" onInput={index === 0 ? invalidateCalculation : undefined} defaultValue={(index > 0 ? examination?.measurementEntries[index]?.reading?.toFixed(2) : examination?.measurementEntries[index]?.reading) ?? ""} />}</td>
            <td><input name={`gold-${index}`} aria-label={`Алтны сорьц ${index + 1}`} type="number" readOnly data-calculated disabled={!editable} min="0" max="1000" step="0.000001" defaultValue={(examination?.weightEntries[index]?.goldAssay ?? examination?.measurementEntries[index]?.goldAssay)?.toFixed(2) ?? ""} /></td>
          </tr>)}</tbody>
        </table>
        <div className="examination-results"><h3>Сорьцын дүн</h3>
          <label>Алтны сорьц ‰<input name="goldResult" type="number" readOnly data-calculated disabled={!editable} min="0" max="1000" step="0.000001" defaultValue={examination?.goldResult?.toFixed(2) ?? ""} /></label>
          <label>Мөнгөний сорьц ‰<input name="silverResult" type="number" readOnly data-calculated disabled={!editable} min="0" max="1000" step="0.000001" defaultValue={examination?.silverResult?.toFixed(2) ?? ""} /></label>
        </div>
        </div>
        <table className="examination-table examination-totals"><colgroup><col /><col className="calculation-column" /><col /></colgroup><tbody>
          <tr><td><label className="examination-total">Дүн:<input readOnly tabIndex={-1} onMouseDown={(event) => event.preventDefault()} aria-label="Авсан жингийн дүн" value={totals[0].toFixed(4).replace(/0{1,2}$/, "")} /></label></td><td /><td><label className="examination-total">Дүн:<input readOnly tabIndex={-1} onMouseDown={(event) => event.preventDefault()} aria-label="Гарсан жингийн дүн" value={totals[1].toFixed(4).replace(/0{1,2}$/, "")} /></label></td></tr>
        </tbody></table>
        <div className="examination-footer-fields">
          <label className="examination-recheck"><input type="checkbox" disabled={!editable} name="reexaminationRequested" checked={reexamination} onChange={(event) => {
            setReexamination(event.target.checked);
            setHasUnsavedChanges(true);
            focusNotes.current = event.target.checked;
            if (!event.target.checked) { invalidateCalculation(); setWeightRowCount(4); }
          }} aria-controls="reexamination-description" /><span>Дахин шинжилгээ хийх</span></label>
          <div id="reexamination-description" className={`examination-description${reexamination ? " is-open" : ""}`} inert={!reexamination}>
            <div><input ref={notesRef} name="notes" aria-label="Тайлбар" placeholder="Тайлбар" maxLength={2000} disabled={!reexamination || !editable} onInput={() => setHasUnsavedChanges(true)} defaultValue={examination?.notes ?? ""} /></div>
          </div>
        </div>
      </div></div>
      </fieldset>
      <div className="examination-actions">
        {!manager && sample.substitutedByName && sample.substitutedAt && <span className="substitute-notice">Шилжүүлсэн химич: <strong>{sample.substitutedByName}</strong> · <time dateTime={sample.substitutedAt}>{workflowDate(sample.substitutedAt)}</time></span>}
        {manager ? <>{sample.status === "submitted" && <button className="primary-button" type="button" disabled={saving} onClick={() => void approve()}>Баталгаажуулах</button>}{sample.batchReadyForFinalization && !sample.certificateNo && <button className="primary-button" type="button" disabled={saving} onClick={() => void finalizeCertificate()}>Эцсийн гэрчилгээ батлах</button>}{sample.certificateNo && <><span className="certificate-ready">Гэрчилгээ № {sample.certificateNo}</span><button className="secondary-button" type="button" disabled={saving} onClick={() => void printArchiveReport()}>Архивын тайлан хэвлэх</button></>}</> : <>
        <button className="secondary-button" type="button" disabled={saving || !editable || !canCalculate} onClick={checkCalculation}>Бодолт</button>
        <button className="secondary-button" type="button" disabled={saving || !editable || !canCalculate} onClick={checkCalculation}>Шалгах</button>
        <button className="primary-button" type="submit" value="draft" disabled={saving || !editable}>Хадгалах</button>
        <button className="primary-button" type="submit" value="submit" disabled={saving || !editable}>Хяналтад илгээх</button>
        <button className="secondary-button" type="button" disabled={saving || !editable} title={!examination || hasUnsavedChanges ? "Эхлээд дүнг хадгална уу." : "Орлогч химич томилох"} onClick={chooseSubstituteChemist}>Орлогч томилох</button>
        </>}
        {!embedded && <button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Хаах</button>}
      </div>
    {error && <p className="login-error" role="alert">{error}</p>}</form>
    {substituteChoices && <SubstituteChemistDialog chemists={substituteChoices} value={substituteChemist} saving={saving} onChange={setSubstituteChemist} onClose={() => { if (!saving) { setSubstituteChoices(null); setSubstituteChemist(""); } }} onConfirm={() => void substitute(substituteChemist)} />}
  </>;
  if (embedded) return <section className="chemist-examination">{content}</section>;
  return <WorkspaceDialog size="examination" title={sample.metal === "gold" ? "Алтан гулдмайн шинжилгээ" : "Мөнгөн гулдмайн шинжилгээ"}
    titleBadge={<span className={`examination-status examination-status-${submitted ? "submitted" : sample.status}`}>{statusLabels[submitted ? "submitted" : sample.status] ?? sample.status}</span>}
    onClose={() => { if (!saving) onClose(); }}>{content}</WorkspaceDialog>;
}

function SubstituteChemistDialog({ chemists, value, saving, onChange, onClose, onConfirm }: { chemists: { id: string; fullName: string }[]; value: string; saving: boolean; onChange(value: string): void; onClose(): void; onConfirm(): void }) {
  return <WorkspaceDialog size="compact" title="Орлогч химич томилох" onClose={onClose}>
    <p className="substitute-dialog-copy">Энэ дээжийг сонгосон химичид шилжүүлнэ. Шилжүүлсний дараа таны жагсаалтаас хасагдана.</p>
    {chemists.length ? <label className="workspace-field">Орлох химич<select aria-label="Орлох химич" value={value} disabled={saving} onChange={(event) => onChange(event.target.value)}><option value="">Сонгоно уу</option>{chemists.map((chemist) => <option key={chemist.id} value={chemist.id}>{chemist.fullName}</option>)}</select></label> : <p className="substitute-dialog-empty">Танай сорьцын төвд идэвхтэй өөр химич алга.</p>}
    <div className="substitute-dialog-actions"><button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Цуцлах</button><button className="primary-button" type="button" disabled={saving || !value} onClick={onConfirm}>Томилох</button></div>
  </WorkspaceDialog>;
}
