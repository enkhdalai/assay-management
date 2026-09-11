"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Minus, ChevronLeft, ChevronRight, CircleCheck } from "lucide-react";
import type { AnonymousSample, SubmitBullionExaminationInput } from "../../../../packages/shared/src/bullion-types";
import { WorkspaceDialog } from "../OperationalWorkspace";
import { api } from "./api";
import { printExamination, type ExaminationPrintData } from "./printExamination";
import { calculateBullion, BULLION_CALCULATION_VERSION } from "../../../../packages/shared/src/bullion-calculation";
import { WorkspaceLoadingSkeleton } from "./WorkspaceLoadingSkeleton";

const statusLabels: Record<string, string> = { pending: "Хүлээгдэж байна", draft: "Шинжилгээнд", submitted: "Эрхлэгчийн хяналтад", approved: "Баталгаажсан", rejected: "Буцаасан", superseded: "Өмнөх хувилбар" };
type ManagerBatch = {
  id: string;
  customerName: string;
  registrationNo: string;
  metal: AnonymousSample["metal"];
  receivedAt: string;
  samples: AnonymousSample[];
  status: string;
  batchProgress: NonNullable<AnonymousSample["batchProgress"]>;
  assignedAt: string | null;
  completedAt: string | null;
};
const examinationNumber = (value: string) => value.padStart(4, "0");
function bullionDisplayNumber(value?: string | null, fallback = "-") {
  const number = value?.trim();
  if (!number) return fallback;
  // Legacy records stored the intake's 55-prefixed registration number here.
  const shortNumber = /^55(\d+)$/.exec(number)?.[1] ?? number;
  return /^\d+$/.test(shortNumber) ? shortNumber.padStart(4, "0") : shortNumber;
}
function batchStatus(samples: AnonymousSample[]) {
  if (samples.every((sample) => sample.status === "approved")) return "approved";
  if (samples.some((sample) => sample.status === "submitted")) return "submitted";
  if (samples.some((sample) => sample.status === "draft")) return "draft";
  return "pending";
}
const workflowDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const utcDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function workflowDate(value?: string | null, includeTime = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return "-";
  const parts = workflowDateFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find(part => part.type === type)?.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return includeTime ? `${date} ${part("hour")}:${part("minute")}` : date;
}
function approvalDate(value?: string | null) {
  if (!value) return "-";
  const isoValue = value.replace(" ", "T");
  const normalized = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(isoValue)
    ? isoValue.replace(/([+-]\d{2})$/, "$1:00")
    : `${isoValue}Z`;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return "-";
  // Existing approval records were stored eight hours behind the laboratory clock.
  const parts = utcDateFormatter.formatToParts(new Date(timestamp + 16 * 60 * 60 * 1000));
  const part = (type: string) => parts.find(part => part.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

let esignSessionActive = false;

function signHashWithEsign(documentHash: string): Promise<string> {
  if (esignSessionActive) return Promise.reject(new Error("eSign гарын үсэг зурах ажиллагаа аль хэдийн эхэлсэн байна."));
  esignSessionActive = true;
  return new Promise((resolve, reject) => {
    let settled = false;
    let socket: WebSocket | null = null;
    let requestSent = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      esignSessionActive = false;
      window.clearTimeout(timeout);
      socket?.close(1000, "Signature response received");
      callback();
    };
    const timeout = window.setTimeout(() => finish(() => reject(new Error("eSign Client-ээс хариу ирсэнгүй. Токен болон PIN цонхыг шалгана уу."))), 60_000);
    try {
      socket = new WebSocket("ws://127.0.0.1:59001");
      socket.onopen = () => {
        if (requestSent || settled) return;
        requestSent = true;
        socket?.send(JSON.stringify({ type: "055a3cb74cc69e86", data: documentHash }));
      };
      socket.onmessage = (event) => {
        const value = typeof event.data === "string" ? event.data : "";
        if (!value) return finish(() => reject(new Error("eSign Client хоосон хариу өглөө.")));
        let response: { status?: unknown } | null = null;
        try { response = JSON.parse(value) as { status?: unknown }; } catch { return finish(() => reject(new Error("eSign Client-ийн хариу JSON форматтай биш байна."))); }
        if (response.status !== "success") return;
        finish(() => resolve(value));
      };
      socket.onerror = () => finish(() => reject(new Error("eSign Client-т холбогдож чадсангүй. Client ажиллаж, токен залгаатай эсэхийг шалгана уу.")));
      socket.onclose = () => {
        if (!settled) finish(() => reject(new Error("eSign Client холболтыг хаалаа. Гарын үсэг зурах ажиллагааг дахин оролдоно уу.")));
      };
    } catch {
      finish(() => reject(new Error("eSign Client-т холбогдож чадсангүй.")));
    }
  });
}

export function SampleWorkspace({ manager = false, centerType }: { manager?: boolean; centerType?: string }) {
  const [samples, setSamples] = useState<AnonymousSample[]>([]);
  const [selected, setSelected] = useState<AnonymousSample | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
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
  const grouped = new Map<string, AnonymousSample[]>();
  if (manager) samples.forEach((sample) => {
    if (!sample.batchId) return;
    grouped.set(sample.batchId, [...(grouped.get(sample.batchId) ?? []), sample]);
  });
  const managerBatches: ManagerBatch[] = Array.from(grouped, ([id, batchSamples]) => {
    const first = batchSamples[0];
    return {
      id, customerName: first.customerName ?? "-", registrationNo: first.registrationNo ?? "-", metal: first.metal,
      receivedAt: first.receivedAt, samples: batchSamples, status: batchStatus(batchSamples), batchProgress: first.batchProgress ?? [],
      assignedAt: batchSamples.map((sample) => sample.assignedAt).filter(Boolean).sort()[0] ?? null,
      completedAt: batchSamples.map((sample) => sample.completedAt).filter(Boolean).sort().at(-1) ?? null,
    };
  });
  const filteredBatches = managerBatches.filter((batch) => {
    const needle = query.trim().toLowerCase();
    return (!needle || batch.customerName.toLowerCase().includes(needle) || batch.registrationNo.toLowerCase().includes(needle) || batch.samples.some((sample) => examinationNumber(sample.analysisNo).includes(needle)))
      && (status === "all" || status === batch.status);
  }).sort((left, right) => Date.parse(right.completedAt ?? right.assignedAt ?? right.receivedAt) - Date.parse(left.completedAt ?? left.assignedAt ?? left.receivedAt));
  const activeBatch = selectedBatch ? managerBatches.find((batch) => batch.id === selectedBatch) ?? null : null;
  const pageCount = Math.max(1, Math.ceil(filteredBatches.length / 25));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * 25;
  const pageBatches = filteredBatches.slice(offset, offset + 25);
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
  return <section className="workspace-section"><div className="workspace-toolbar"><input aria-label="Дээж хайх" placeholder="Харилцагч, бүртгэл эсвэл шинжилгээний дугаараар хайх" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{manager && <select aria-label="Төлөв" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">Бүх төлөв</option>{Object.entries(statusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>}<button className="secondary-button" disabled={loading} onClick={refresh} type="button">Шинэчлэх</button></div>
    {error && <p className="login-error" role="alert">{error}</p>}
{loading ? <WorkspaceLoadingSkeleton /> : <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>№</th><th>Харилцагч</th><th>Бүртгэл №</th><th>Огноо</th><th>Металл</th><th>Гулдмай</th><th>Химичдийн явц</th><th>Хуваарилсан огноо</th><th>Дууссан огноо</th><th>Төлөв</th></tr></thead><tbody>{pageBatches.map((batch, index) => <tr key={batch.id} className="manager-sample-row" tabIndex={0} onClick={() => setSelectedBatch(batch.id)} onKeyDown={(event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault(); setSelectedBatch(batch.id);
}}>
  <td>{offset + index + 1}</td><td>{batch.customerName}</td><td>{batch.registrationNo}</td><td>{workflowDate(batch.receivedAt, false)}</td><td>{batch.metal === "gold" ? "Алт" : "Мөнгө"}</td><td>{batch.samples.length}</td>
  <td><BatchTimeline progress={batch.batchProgress} /></td><td className="sample-workflow-date">{batch.assignedAt ? <time dateTime={batch.assignedAt}>{workflowDate(batch.assignedAt)}</time> : "-"}</td><td className="sample-workflow-date">{batch.completedAt ? <time dateTime={batch.completedAt}>{workflowDate(batch.completedAt)}</time> : "-"}</td><td><StatusBadge status={batch.status} /></td></tr>)}</tbody></table>{filteredBatches.length === 0 && <p>Дээж олдсонгүй.</p>}</div>}
    {!loading && filteredBatches.length > 0 && <nav className="sample-pagination" aria-label="Хуудаслалт">
      <span>{offset + 1}–{Math.min(offset + 25, filteredBatches.length)} / {filteredBatches.length}</span>
      <button type="button" className="secondary-button" aria-label="Өмнөх хуудас" title="Өмнөх хуудас" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
      <span>{currentPage} / {pageCount}</span>
      <button type="button" className="secondary-button" aria-label="Дараах хуудас" title="Дараах хуудас" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
    </nav>}
    {activeBatch && <BatchReviewDialog key={activeBatch.id} batch={activeBatch} centerType={centerType} onClose={() => setSelectedBatch(null)} onSaved={() => { setSelectedBatch(null); void refresh(); }} />}
  </section>;
}

function StatusBadge({ status }: { status: string }) {
  const style = status === "approved" ? "active" : status === "submitted" ? "warning" : "neutral";
  return <span className={`status-badge status-${style}`}>{statusLabels[status] ?? status}</span>;
}

function BatchTimeline({ progress }: { progress: NonNullable<AnonymousSample["batchProgress"]> }) {
  if (!progress.length) return "-";
  return <div className="batch-timeline" aria-label="Химичдийн явц">{progress.map((chemist) => {
    const complete = chemist.assignedCount > 0 && chemist.completedCount === chemist.assignedCount;
    return <span key={chemist.chemistId} className={complete ? "timeline-complete" : "timeline-pending"} title={`${chemist.chemistName}: ${chemist.completedCount}/${chemist.assignedCount}`}>
      {complete ? <CircleCheck size={17} aria-hidden="true" /> : <i aria-hidden="true" />}<span>{chemist.chemistName} {chemist.completedCount}/{chemist.assignedCount}</span>
    </span>;
  })}</div>;
}

function ApprovalNotice({ sample }: { sample: AnonymousSample }) {
  if (sample.status !== "approved" || !sample.approvedByName || !sample.approvedAt) return null;
  return <span className="approval-notice">Баталгаажуулсан: <strong>{sample.approvedByName}</strong><time dateTime={sample.approvedAt}>{approvalDate(sample.approvedAt)}</time></span>;
}

function BatchReviewDialog({ batch, centerType, onClose, onSaved }: { batch: ManagerBatch; centerType?: string; onClose(): void; onSaved(): void }) {
  const [activeSampleId, setActiveSampleId] = useState(batch.samples[0]?.id ?? "");
  const activeSample = batch.samples.find((sample) => sample.id === activeSampleId) ?? batch.samples[0];
  return <WorkspaceDialog size="examination" title={`${batch.customerName} · ${batch.registrationNo}`} headerActions={activeSample ? <ApprovalNotice sample={activeSample} /> : null} onClose={onClose}>
    <section className="manager-review-workstation">
      <aside className="chemist-sample-list" aria-label="Гулдмайн шинжилгээнүүд">
        <h2>Гулдмайн №</h2>
        <div className="chemist-sample-options" role="listbox" aria-label="Шинжилгээ сонгох">
          {batch.samples.map((sample, index) => <button key={sample.id} type="button" role="option" aria-selected={activeSample?.id === sample.id} className="chemist-sample-option" onClick={() => setActiveSampleId(sample.id)}>
            <span>{index + 1}</span><strong>{bullionDisplayNumber(sample.bullionNo, String(index + 1).padStart(4, "0"))}</strong><StatusBadge status={sample.status} />
          </button>)}
        </div>
      </aside>
      <div className="chemist-form-panel">
        {activeSample && <SampleDialog key={`${activeSample.id}:${activeSample.revisionNo}:${activeSample.status}`} embedded manager centerType={centerType} sample={activeSample} onClose={onClose} onSaved={onSaved} />}
      </div>
    </section>
  </WorkspaceDialog>;
}

function SampleDialog({ sample, manager, centerType, onClose, onSaved, embedded = false }: { sample: AnonymousSample; manager: boolean; centerType?: string; onClose(): void; onSaved(): void; embedded?: boolean }) {
  const [saving, setSaving] = useState(false);
  const signingRef = useRef(false);
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
  async function signCertificateWithEsign() {
    if (!sample.batchId || signingRef.current) return;
    signingRef.current = true;
    setSaving(true); setError("");
    try {
      if (!sample.certificateNo) {
        await api(`/api/v1/bullion/batches/${sample.batchId}/finalize`, { method: "POST", body: JSON.stringify({}) });
      }
      const { data: payload } = await api<{ data: { documentHash: string } }>(`/api/v1/bullion/batches/${sample.batchId}/signature-payload`);
      const response = await signHashWithEsign(payload.documentHash);
      await api(`/api/v1/bullion/batches/${sample.batchId}/signature-evidence`, { method: "POST", body: JSON.stringify({ providerResponse: response }) });
      onSaved();
    } catch (error) { setError((error as Error).message); } finally { signingRef.current = false; setSaving(false); }
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
      <div><dt>{manager ? "Гулдмайн №" : "Шинжилгээний №"}</dt><dd>{manager ? bullionDisplayNumber(sample.bullionNo) : examinationNumber(sample.analysisNo)}</dd></div>
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
        {manager ? <>{sample.status === "submitted" && <button className="primary-button" type="button" disabled={saving} onClick={() => void approve()}>Баталгаажуулах</button>}{sample.batchReadyForFinalization && !sample.certificateNo && <button className="primary-button" type="button" disabled={saving} onClick={() => void signCertificateWithEsign()}>eSign-аар эцсийн гэрчилгээ батлах</button>}{sample.certificateNo && <><span className="certificate-ready">Гэрчилгээ № {sample.certificateNo}</span>{sample.certificateSignatureStatus === "unsigned" && <button className="primary-button" type="button" disabled={saving} onClick={() => void signCertificateWithEsign()}>eSign-аар гэрчилгээ батлах</button>}{sample.certificateSignatureStatus === "signing" && <span className="certificate-ready">eSign шалгалт хүлээгдэж байна</span>}{sample.certificateSignatureStatus === "cryptographically_verified" && <span className="certificate-ready">RSA гарын үсэг шалгагдсан</span>}{sample.certificateSignatureStatus === "signed" && <span className="certificate-ready">Дижитал гарын үсэг баталгаажсан</span>}<button className="secondary-button" type="button" disabled={saving} onClick={() => void printArchiveReport()}>Архивын тайлан хэвлэх</button></>}</> : <>
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
