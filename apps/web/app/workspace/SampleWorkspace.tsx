"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, Minus, ChevronLeft, ChevronRight, CalendarDays, CircleCheck, RefreshCw, X } from "lucide-react";
import type { AnonymousSample, SubmitBullionExaminationInput } from "../../../../packages/shared/src/bullion-types";
import { WorkspaceDialog } from "../OperationalWorkspace";
import { api } from "./api";
import { printExamination, type ExaminationPrintData } from "./printExamination";
import { calculateBullion, calculateSilverBullion, BULLION_CALCULATION_VERSION, BULLION_SILVER_CALCULATION_VERSION } from "../../../../packages/shared/src/bullion-calculation";
import { WorkspaceLoadingSkeleton } from "./WorkspaceLoadingSkeleton";
import { ChemistPicker } from "./ChemistPicker";

const statusLabels: Record<string, string> = { pending: "Хүлээгдэж байна", draft: "Шинжилгээнд", submitted: "Эрхлэгчийн хяналтад", approved: "Баталсан", esign_approved: "eSign баталсан", rejected: "Буцаасан", superseded: "Өмнөх хувилбар" };
const managerBatchStatusPriority: Record<string, number> = { pending: 0, draft: 0, submitted: 1, approved: 2, esign_approved: 3, rejected: 4, superseded: 5 };
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
type ExaminationCalculation = {
  errors: string[];
  weightEntries: SubmitBullionExaminationInput["weightEntries"];
  goldResult?: number;
  silverResult?: number;
  remainingMilligrams?: number;
  lossMilligrams?: number;
  returnedMilligrams?: number;
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
  if (samples.every((sample) => sample.certificateSignatureStatus === "signed" || sample.certificateSignatureStatus === "cryptographically_verified")) return "esign_approved";
  if (samples.every((sample) => sample.status === "approved")) return "approved";
  if (samples.some((sample) => sample.status === "submitted")) return "submitted";
  if (samples.some((sample) => sample.status === "draft")) return "draft";
  return "pending";
}
const workflowDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const mongoliaDateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" });
const utcDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function workflowDate(value?: string | null, includeTime = true) {
  if (!value || !Number.isFinite(Date.parse(value))) return "-";
  const parts = workflowDateFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find(part => part.type === type)?.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  return includeTime ? `${date} ${part("hour")}:${part("minute")}` : date;
}
function todayInMongolia() {
  const parts = mongoliaDateFormatter.formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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
  const [page, setPage] = useState(1);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [activeColumnFilter, setActiveColumnFilter] = useState<string | null>(null);
  const [historyDate, setHistoryDate] = useState(todayInMongolia);
  const [historyMode, setHistoryMode] = useState(false);
  const [historySamples, setHistorySamples] = useState<AnonymousSample[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDates, setHistoryDates] = useState<string[]>([]);
  const [historyRevision, setHistoryRevision] = useState(0);
  const historyAvailable = !manager && ["private_assay_center", "government_assay_center"].includes(centerType ?? "");
  const loadHistoryDates = useCallback(async () => {
    if (!historyAvailable) return;
    try {
      const { data } = await api<{ data: string[] }>("/api/v1/bullion/samples/history/dates", { cache: "no-store" });
      setHistoryDates(data);
    } catch (requestError) {
      setError((requestError as Error).message);
    }
  }, [historyAvailable]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api<{ data: AnonymousSample[] }>("/api/v1/bullion/samples", { cache: "no-store" });
      setSamples(data); setError("");
      setSelected(current => manager
        ? current ? data.find(sample => sample.id === current.id) ?? null : null
        : current ? data.find(sample => sample.id === current.id) ?? data[0] ?? null : data[0] ?? null);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [manager]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void loadHistoryDates(); }, [loadHistoryDates]);
  useEffect(() => {
    if (!historyAvailable || !historyDate) { setHistorySamples([]); return; }
    let cancelled = false;
    setHistoryLoading(true); setError("");
    void api<{ data: AnonymousSample[] }>(`/api/v1/bullion/samples/history?date=${encodeURIComponent(historyDate)}`, { cache: "no-store" })
      .then(({ data }) => {
        if (cancelled) return;
        setHistorySamples(data);
        setSelected((current) => {
          const updated = current && data.find((sample) => sample.id === current.id && sample.revisionNo === current.revisionNo);
          return updated ?? (historyMode || !current ? data[0] ?? null : current);
        });
      })
      .catch((requestError: Error) => { if (!cancelled) setError(requestError.message); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [historyAvailable, historyDate, historyMode, historyRevision]);
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
  const batchRowValues = (batch: ManagerBatch) => ({
    customer: batch.customerName,
    registrationNo: batch.registrationNo,
    receivedAt: workflowDate(batch.receivedAt, false),
    metal: batch.metal === "gold" ? "Алт" : "Мөнгө",
    bullion: String(batch.samples.length),
    chemistProgress: batch.samples.map((sample) => `${sample.assignedChemistName ?? ""} ${sample.status === "submitted" || sample.status === "approved" ? "1/1" : "0/1"}`).join(" "),
  });
  const filteredBatches = managerBatches.filter((batch) => {
    const fields = batchRowValues(batch);
    return Object.entries(columnFilters).every(([column, value]) => !value.trim() || fields[column as keyof typeof fields].toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()));
  }).sort((left, right) => {
    const statusDifference = (managerBatchStatusPriority[left.status] ?? 99) - (managerBatchStatusPriority[right.status] ?? 99);
    return statusDifference || Date.parse(right.completedAt ?? right.assignedAt ?? right.receivedAt) - Date.parse(left.completedAt ?? left.assignedAt ?? left.receivedAt);
  });
  function HeaderFilter({ column, text, label = text }: { column: string; text: string; label?: ReactNode }) {
    const isActive = activeColumnFilter === column;
    if (isActive) return <input className="report-column-filter-input sample-column-filter-input" aria-label={`${text} хайх`} autoFocus value={columnFilters[column] ?? ""} placeholder={text} onBlur={() => setActiveColumnFilter(null)} onChange={(event) => { setColumnFilters((current) => ({ ...current, [column]: event.target.value })); setPage(1); }} onKeyDown={(event) => { if (event.key === "Escape") { setColumnFilters((current) => ({ ...current, [column]: "" })); setActiveColumnFilter(null); } }} />;
    return <button className={`report-column-filter${columnFilters[column] ? " is-filtered" : ""}`} type="button" title={`${text} хайх`} onClick={() => setActiveColumnFilter(column)}>{label}</button>;
  }
  const activeBatch = selectedBatch ? managerBatches.find((batch) => batch.id === selectedBatch) ?? null : null;
  const pageCount = Math.max(1, Math.ceil(filteredBatches.length / 25));
  const currentPage = Math.min(page, pageCount);
  const offset = (currentPage - 1) * 25;
  const pageBatches = filteredBatches.slice(offset, offset + 25);
  const chemistSamples = [...samples].sort((left, right) => {
    const newRequestOrder = Number(right.status === "pending") - Number(left.status === "pending");
    return newRequestOrder || Date.parse(right.receivedAt) - Date.parse(left.receivedAt) || Number(right.analysisNo) - Number(left.analysisNo);
  });
  const visibleChemistSamples = (historyMode
    ? historySamples
    : [...chemistSamples, ...historySamples.filter((historySample) => !chemistSamples.some((sample) => sample.id === historySample.id && sample.revisionNo === historySample.revisionNo))]
  ).sort((left, right) => {
    const newRequestOrder = Number(right.status === "pending") - Number(left.status === "pending");
    return newRequestOrder || Date.parse(right.receivedAt) - Date.parse(left.receivedAt) || Number(right.analysisNo) - Number(left.analysisNo);
  });
  if (!manager) return <section className="chemist-workstation">
    <aside className="chemist-sample-list" aria-label="Илгээгдсэн шинжилгээнүүд">
      {historyAvailable && <label className="chemist-history-date">Огноо
        <ChemistHistoryDatePicker value={historyDate} availableDates={historyDates} onChange={(date) => { setHistoryDate(date); setHistoryMode(date !== todayInMongolia()); }} />
      </label>}
      <h2>Шинжилгээ №</h2>
      {loading || historyLoading ? <WorkspaceLoadingSkeleton rows={4} /> : <div className="chemist-sample-options" role="listbox" aria-label="Шинжилгээ сонгох">
        {visibleChemistSamples.map((sample, index) => <button key={`${sample.id}:${sample.revisionNo}`} type="button" role="option" aria-selected={selected?.id === sample.id && selected?.revisionNo === sample.revisionNo} className="chemist-sample-option" onClick={() => setSelected(sample)}>
          <span>{index + 1}</span><strong>{sample.status === "pending" && <i className="new-sample-dot" aria-label="Шинэ хүсэлт" title="Шинэ хүсэлт" />}{examinationNumber(sample.analysisNo)}</strong>
        </button>)}
        {!visibleChemistSamples.length && <p>{historyMode ? "Сонгосон өдөр шинжилгээ олдсонгүй." : "Илгээгдсэн дээж алга байна."}</p>}
      </div>}
    </aside>
    <div className="chemist-form-panel">
      {error && <p className="login-error" role="alert">{error}</p>}
      {selected && <SampleDialog key={`${selected.id}:${selected.revisionNo}`} embedded manager={false} centerType={centerType} sample={selected} onClose={() => undefined} onSaved={() => { void refresh(); void loadHistoryDates(); setHistoryRevision((revision) => revision + 1); }} />}
      {!loading && !historyLoading && !selected && !error && <p>Шинжилгээ сонгоно уу.</p>}
    </div>
  </section>;
  const headerActions = typeof document === "undefined" ? null : document.getElementById("intake-header-actions");
  return <><section className="workspace-section">{headerActions && createPortal(<button className="secondary-button sample-list-refresh" disabled={loading} onClick={() => { void refresh(); }} type="button" aria-label="Шинэчлэх" title="Шинэчлэх"><RefreshCw size={20} className={loading ? "is-spinning" : undefined} aria-hidden="true" /></button>, headerActions)}
    {error && <p className="login-error" role="alert">{error}</p>}
{loading ? <WorkspaceLoadingSkeleton /> : <div className="workspace-table-scroll sample-list-scroll"><table className="workspace-table sample-list-table"><thead><tr><th>№</th><th><HeaderFilter column="customer" text="Харилцагч" /></th><th><HeaderFilter column="registrationNo" text="Бүртгэл №" /></th><th><HeaderFilter column="receivedAt" text="Огноо" /></th><th><HeaderFilter column="metal" text="Металл" /></th><th><HeaderFilter column="bullion" text="Гулдмай" /></th><th><HeaderFilter column="chemistProgress" text="Химичдийн явц" /></th><th>Төлөв</th></tr></thead><tbody>{pageBatches.map((batch, index) => <tr key={batch.id} className="manager-sample-row" tabIndex={0} onClick={() => setSelectedBatch(batch.id)} onKeyDown={(event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault(); setSelectedBatch(batch.id);
}}>
  <td>{offset + index + 1}</td><td className="sample-customer-name" title={batch.customerName}><span>{batch.customerName}</span></td><td>{batch.registrationNo}</td><td>{workflowDate(batch.receivedAt, false)}</td><td>{batch.metal === "gold" ? "Алт" : "Мөнгө"}</td><td>{batch.samples.length}</td>
  <td><BatchChemistAssignment samples={batch.samples} onSaved={refresh} /></td><td><StatusBadge status={batch.status} /></td></tr>)}</tbody></table>{filteredBatches.length === 0 && <p>Дээж олдсонгүй.</p>}</div>}
    {!loading && filteredBatches.length > 0 && <nav className="sample-pagination" aria-label="Хуудаслалт">
      <span>{offset + 1}–{Math.min(offset + 25, filteredBatches.length)} / {filteredBatches.length}</span>
      <button type="button" className="secondary-button" aria-label="Өмнөх хуудас" title="Өмнөх хуудас" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
      <span>{currentPage} / {pageCount}</span>
      <button type="button" className="secondary-button" aria-label="Дараах хуудас" title="Дараах хуудас" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
    </nav>}
    {activeBatch && <BatchReviewDialog key={activeBatch.id} batch={activeBatch} centerType={centerType} onClose={() => setSelectedBatch(null)} onSaved={() => { setSelectedBatch(null); void refresh(); }} />}
  </section></>;
}

function ChemistHistoryDatePicker({ value, availableDates, onChange }: { value: string; availableDates: string[]; onChange(value: string): void }) {
  const available = new Set(availableDates);
  const initial = value ? new Date(`${value}T12:00:00`) : new Date();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutsideClick); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(month);
  const firstDay = (month.getDay() + 6) % 7;
  const days = Array.from({ length: firstDay + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() }, (_, index) => index < firstDay ? null : index - firstDay + 1);
  const displayValue = value ? value.replaceAll("-", ".") : "Огноо сонгох";
  const selectDate = (day: number) => {
    const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!available.has(date) && date !== todayInMongolia()) return;
    onChange(date); setOpen(false);
  };
  return <div ref={pickerRef} className="chemist-history-picker">
    <button type="button" className="chemist-history-picker-trigger" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      <span>{displayValue}</span><CalendarDays size={18} aria-hidden="true" />
    </button>
    {open && <div className="chemist-history-calendar" role="dialog" aria-label="Шинжилгээний огноо сонгох">
      <div className="chemist-history-calendar-header"><span>{monthLabel}</span><div>
        <button type="button" aria-label="Өмнөх сар" title="Өмнөх сар" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft size={18} aria-hidden="true" /></button>
        <button type="button" aria-label="Дараах сар" title="Дараах сар" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight size={18} aria-hidden="true" /></button>
      </div></div>
      <div className="chemist-history-calendar-weekdays">{["Д", "М", "Л", "П", "Б", "Б", "Н"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
      <div className="chemist-history-calendar-days">{days.map((day, index) => {
        if (!day) return <span key={`blank-${index}`} />;
        const date = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const enabled = available.has(date) || date === todayInMongolia();
        return <button key={date} type="button" disabled={!enabled} aria-current={value === date ? "date" : undefined} onClick={() => selectDate(day)}>{day}</button>;
      })}</div>
      {!availableDates.length && <p>Шинжилгээний түүх алга байна.</p>}
    </div>}
  </div>;
}

function StatusBadge({ status }: { status: string }) {
  const workflowStatus = status === "submitted" ? "awaiting-review" : status === "draft" ? "assigned" : status === "pending" ? "awaiting-assignment" : status;
  return <span className={`intake-workflow-status sample-workflow-status is-${workflowStatus}`}>{statusLabels[status] ?? status}</span>;
}

function BatchChemistAssignment({ samples, onSaved }: { samples: AnonymousSample[]; onSaved(): Promise<void> }) {
  return <div className="batch-chemist-assignments" aria-label="Хариуцсан химичид">{samples.map((sample) => {
    const complete = sample.status === "submitted" || sample.status === "approved";
    return <div key={sample.id} className={complete ? "batch-chemist-assignment is-complete" : "batch-chemist-assignment"}>
      {complete ? <CircleCheck size={17} aria-hidden="true" /> : <i aria-hidden="true" />}
      <ChemistPicker sample={sample} onSaved={onSaved} />
      <span>{complete ? "1/1" : "0/1"}</span>
    </div>;
  })}</div>;
}

function ApprovalNotice({ sample }: { sample: AnonymousSample }) {
  if (sample.status !== "approved" || !sample.approvedByName || !sample.approvedAt) return null;
  return <span className="approval-notice">Баталсан: <strong>{sample.approvedByName}</strong><time dateTime={sample.approvedAt}>{approvalDate(sample.approvedAt)}</time></span>;
}

function SubmissionNotice({ sample }: { sample: AnonymousSample }) {
  if (sample.status !== "submitted" || !sample.assignedChemistName || !sample.completedAt) return null;
  return <span className="submission-notice">Илгээсэн: <strong>{sample.assignedChemistName}</strong><time dateTime={sample.completedAt}>{workflowDate(sample.completedAt)}</time></span>;
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
  const [toastError, setToastError] = useState("");
  const [errorSecondsRemaining, setErrorSecondsRemaining] = useState(0);
  const [returningForCorrection, setReturningForCorrection] = useState(false);
  const [returnNote, setReturnNote] = useState("");
  const [batchReadyForFinalization, setBatchReadyForFinalization] = useState(Boolean(sample.batchReadyForFinalization));
  const examination = sample.examination;
  const isSilver = sample.metal === "silver";
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
  const displayedStatus = sample.certificateSignatureStatus === "signed" || sample.certificateSignatureStatus === "cryptographically_verified" ? "esign_approved" : submitted ? "submitted" : sample.status;
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [substituteChoices, setSubstituteChoices] = useState<{ id: string; fullName: string }[] | null>(null);
  const [substituteChemist, setSubstituteChemist] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const formId = `bullion-examination-${sample.id}`;
  const [totals, setTotals] = useState([0, 0]);
  const [canCalculate, setCanCalculate] = useState(false);
  useEffect(() => {
    if (!error) return;
    const deadline = Date.now() + 5_000;
    const updateCountdown = () => setErrorSecondsRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)));
    updateCountdown();
    const interval = window.setInterval(updateCountdown, 250);
    const timeout = window.setTimeout(() => { setError(""); setErrorSecondsRemaining(0); }, 5_000);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [error]);
  useEffect(() => {
    if (!toastError) return;
    const timeout = window.setTimeout(() => setToastError(""), 5_000);
    return () => window.clearTimeout(timeout);
  }, [toastError]);
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
  function readWeights(form: FormData): SubmitBullionExaminationInput["weightEntries"] {
    return Array.from({ length: weightRowCount }, (_, index) => ({
      receivedWeightGrams: Number(form.get(`received-${index}`)) / 1000,
      outputWeightGrams: Number(form.get(`output-${index}`)) / (isSilver ? 1 : 1000),
      calculation: String(form.get(`calculation-${index}`)) as "yes" | "no" | "addition",
    }));
  }
  function calculate(form = new FormData(formRef.current!)): ExaminationCalculation {
    if (isSilver) {
      const result = calculateSilverBullion(readWeights(form), sample.sampleWeightMilligrams / 1000, {
        method: form.get("silverMethod") === "rhodanometric" ? "rhodanometric" : "titrimetric",
        titerMilligramsPerMilliliter: Number(form.get("silverTiter")),
        blankVolumeMilliliters: undefined,
      });
      const values: Record<string, number | undefined> = { silverResult: result.silverResult };
      result.weightEntries.forEach((entry, index) => { values[`silver-${index}`] = entry.silverAssay; });
      for (const [name, value] of Object.entries(values)) {
        const input = formRef.current?.elements.namedItem(name) as HTMLInputElement | null;
        if (input) input.value = value == null || !Number.isFinite(value) ? "" : value.toFixed(2);
      }
      return result;
    }
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
    setError(result.errors.join(" ") || (!isSilver && result.silverResult == null ? "Мөнгөний сорьц бодох Нэмэлт мөрийг оруулна уу." : ""));
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
    try {
      const { data } = await api<{ data: { batchReadyForFinalization: boolean } }>(`/api/v1/bullion/samples/${sample.id}/approve`, { method: "POST", body: JSON.stringify({}) });
      if (data.batchReadyForFinalization) {
        setBatchReadyForFinalization(true);
      } else {
        onSaved();
      }
    }
    catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  async function returnForCorrection() {
    const note = returnNote.trim();
    if (!note) return;
    setSaving(true); setError("");
    try { await api(`/api/v1/bullion/samples/${sample.id}/return`, { method: "POST", body: JSON.stringify({ note }) }); setReturningForCorrection(false); setReturnNote(""); onSaved(); }
    catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  async function signCertificateWithEsign() {
    if (!sample.batchId || signingRef.current) return;
    signingRef.current = true;
    setSaving(true); setError(""); setToastError("");
    try {
      if (!sample.certificateNo) {
        await api(`/api/v1/bullion/batches/${sample.batchId}/finalize`, { method: "POST", body: JSON.stringify({}) });
      }
      const { data: payload } = await api<{ data: { documentHash: string } }>(`/api/v1/bullion/batches/${sample.batchId}/signature-payload`);
      const response = await signHashWithEsign(payload.documentHash);
      await api(`/api/v1/bullion/batches/${sample.batchId}/signature-evidence`, { method: "POST", body: JSON.stringify({ providerResponse: response }) });
      onSaved();
    } catch (error) { setToastError((error as Error).message); } finally { signingRef.current = false; setSaving(false); }
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
    if (sendingForApproval && calculated && (calculated.errors.length || (isSilver ? calculated.silverResult == null : calculated.goldResult == null || calculated.silverResult == null))) {
      setError(calculated.errors.join(" ") || (isSilver ? "Мөнгөний сорьцыг бодож чадсангүй." : "Мөнгөний сорьц бодох Нэмэлт мөрийг оруулна уу.")); return;
    }
    setSaving(true);
    const input: SubmitBullionExaminationInput = {
      bullionItemId: sample.id, examinationNo: sample.analysisNo, expectedRevision: sample.revisionNo,
      calculationVersion: isSilver ? BULLION_SILVER_CALCULATION_VERSION : BULLION_CALCULATION_VERSION,
      sampleWeightGrams: sample.sampleWeightMilligrams / 1000, delta: sample.delta, status,
      weightEntries: calculated?.weightEntries ?? readWeights(form),
      measurementEntries: isSilver
        ? (calculated?.weightEntries ?? readWeights(form)).map((entry, index) => ({ label: `${index + 1}-р мөр`, reading: entry.outputWeightGrams, silverAssay: entry.silverAssay }))
        : measurements.map((label, index) => ({ label, reading: index === 0 ? Number(form.get('measurement-0')) : calculated ? [0, calculated.remainingMilligrams ?? 0, calculated.lossMilligrams ?? 0, calculated.returnedMilligrams ?? 0][index] : Number(form.get(`measurement-${index}`)) })),
      goldResult: isSilver ? undefined : calculated?.goldResult, silverResult: calculated?.silverResult,
      silverMethod: isSilver ? (form.get("silverMethod") === "rhodanometric" ? "rhodanometric" : "titrimetric") : undefined,
      silverTiterMilligramsPerMilliliter: isSilver ? Number(form.get("silverTiter")) : undefined,
      silverBlankVolumeMilliliters: undefined,
      notes: String(form.get("notes") || ""), reexaminationRequested: form.get("reexaminationRequested") === "on",
    };
    try {
      if (editable) { await api("/api/v1/bullion/examinations", { method: "POST", body: JSON.stringify(input) }); setHasUnsavedChanges(false); if (sendingForApproval) setSubmitted(true); }
      onSaved();
    }
    catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  const content = <>
    {isSilver ? <><div className={`silver-examination-header${manager ? " is-manager" : ""}`}>
      {manager && <label>Огноо<input className="silver-readonly-field" readOnly disabled value={workflowDate(sample.receivedAt, false)} /></label>}
      <label>Дээжийн жин /мг/<input className="silver-readonly-field" readOnly disabled value={sample.sampleWeightMilligrams} /></label>
      {manager ? <div className="silver-method-used" aria-label="Шинжилгээний арга">
        {examination?.silverMethod === "rhodanometric" ? "Роданометрийн арга" : "Титриметрийн арга"}
      </div> : <div className="silver-method-choice" role="radiogroup" aria-label="Шинжилгээний арга">
        {([['rhodanometric', 'Роданометрийн арга'], ['titrimetric', 'Титриметрийн арга']] as const).map(([value, label]) => <label key={value}>
          <input form={formId} type="radio" name="silverMethod" value={value} disabled={!editable} defaultChecked={(examination?.silverMethod ?? 'titrimetric') === value} onChange={invalidateCalculation} />{label}
        </label>)}
      </div>}
      <label className="silver-titer-field"><span>Титр</span><input form={formId} name="silverTiter" type="number" min="0" step="0.01" required disabled={!editable} defaultValue={Number(examination?.silverTiterMilligramsPerMilliliter ?? sample.silverTiter ?? 5555).toFixed(2)} onInput={invalidateCalculation} /></label>
    </div>
    </> : <dl className="examination-metadata">
      {manager && <div><dt>Огноо</dt><dd>{workflowDate(sample.receivedAt, false)}</dd></div>}
      <div><dt>Дээжийн жин /мг/</dt><dd>{sample.sampleWeightMilligrams}</dd></div>
      <div><dt>{manager ? "Гулдмайн №" : "Шинжилгээний №"}</dt><dd>{manager ? bullionDisplayNumber(sample.bullionNo) : examinationNumber(sample.analysisNo)}</dd></div>
      <div><dt>Делта</dt><dd>{sample.delta}</dd></div>
    </dl>}
    {!manager && sample.returnNote && <aside className="examination-return-note" aria-label="Эрхлэгчийн засварын тэмдэглэл"><strong>Эрхлэгчийн засварын тэмдэглэл</strong><span>{sample.returnNote}</span>{sample.returnedByName && <small>{sample.returnedByName}{sample.returnedAt ? ` · ${workflowDate(sample.returnedAt)}` : ""}</small>}</aside>}
    <form id={formId} ref={formRef} className="workspace-form examination-form" autoComplete="off" onSubmit={submit}><fieldset disabled={saving}>
      <div className="examination-scroll"><div className="examination-columns">
        <div><table className="examination-table examination-weights"><colgroup><col /><col className="calculation-column" /><col /></colgroup>
          {!isSilver && <thead><tr><th>Авсан жин /мг/</th><th>Бодолт</th><th>Гарсан жин /мг/</th></tr></thead>}
          <tbody>{Array.from({ length: weightRowCount }, (_, index) => <tr key={index}>
            <td><input name={`received-${index}`} aria-label={`${isSilver ? "Дээжийн жин" : "Авсан жин"} ${index + 1}`} type="number" disabled={!editable} min="0" step="0.0001" onInput={weightInput} onFocus={(event) => clearZero(event.currentTarget)} defaultValue={(examination?.weightEntries[index]?.receivedWeightGrams ?? 0) * 1000} /></td>
            <td><div className="examination-calculation" role="group" aria-label={`Бодолт ${index + 1}`}>
              {([["yes", "Тийм"], ["no", "Үгүй"], ["addition", "Нэмэлт"]] as const).map(([value, label]) => <label key={value}>
                <input type="radio" onChange={invalidateCalculation} disabled={!editable} name={`calculation-${index}`} value={value} defaultChecked={(examination?.weightEntries[index]?.calculation || "no") === value} />{label}
              </label>)}
            </div></td>
            <td><input name={`output-${index}`} aria-label={`${isSilver ? "Титрийн эзлэхүүн" : "Гарсан жин"} ${index + 1}`} type="number" disabled={!editable} min="0" step="0.0001" onInput={weightInput} onFocus={(event) => clearZero(event.currentTarget)} defaultValue={(examination?.weightEntries[index]?.outputWeightGrams ?? 0) * (isSilver ? 1 : 1000)} /></td>
          </tr>)}</tbody>
          <tfoot>{editable && reexamination && <tr><td><div className="examination-row-controls"><button type="button" className="secondary-button examination-add-row" aria-label="Шинжилгээний мөр нэмэх" title="Шинжилгээний мөр нэмэх" onClick={() => { invalidateCalculation(); setWeightRowCount((count) => count + 1); }}><Plus size={20} aria-hidden="true" /></button><button type="button" className="secondary-button examination-add-row" aria-label="Сүүлийн мөр хасах" title="Сүүлийн мөр хасах" disabled={weightRowCount <= 4} onClick={() => { invalidateCalculation(); setWeightRowCount((count) => Math.max(4, count - 1)); }}><Minus size={20} aria-hidden="true" /></button></div></td><td colSpan={2} /></tr>}
          </tfoot>
        </table>
        </div>
        <div className={`examination-right${isSilver ? " silver-examination-right" : ""}`}>{isSilver ? <><div className="silver-derived-values">
          <label>Дээжийн үлдэгдэл жин<input readOnly tabIndex={-1} aria-label="Дээжийн үлдэгдэл жин" value={Math.max(0, sample.sampleWeightMilligrams - totals[0]).toFixed(2)} /></label>
          <label>Шинжилгээний хорогдол<input readOnly tabIndex={-1} aria-label="Шинжилгээний хорогдол" value={totals[0].toFixed(2)} /></label>
          {(!manager || reexamination) && <label className="examination-recheck"><input type="checkbox" disabled={!editable} name="reexaminationRequested" checked={reexamination} onChange={(event) => {
            setReexamination(event.target.checked);
            setHasUnsavedChanges(true);
            focusNotes.current = event.target.checked;
            if (!event.target.checked) { invalidateCalculation(); setWeightRowCount(4); }
          }} aria-controls="reexamination-description" /><span>Дахин шинжилгээ хийх</span></label>}
        </div>
        <div className="silver-assay-values">{Array.from({ length: weightRowCount }, (_, index) => <input key={index} name={`silver-${index}`} aria-label={`Мөнгөний сорьц ${index + 1}`} type="number" readOnly data-calculated disabled={!editable} min="0" max="1000" step="0.000001" defaultValue={examination?.weightEntries[index]?.silverAssay?.toFixed(2) ?? ""} />)}</div>
        </> : <><table className="examination-table examination-measurements"><colgroup><col className="measurement-label-column" /><col /><col /></colgroup>
          <thead><tr><th aria-label="Хэмжилтийн нэр" /><th scope="col">Үзүүлэлт</th><th scope="col">Алтны сорьц ‰</th></tr></thead>
          <tbody>{Array.from({ length: weightRowCount }, (_, index) => <tr key={index}><th scope="row">{measurements[index]}</th>
            <td>{index < measurements.length && <input name={`measurement-${index}`} aria-label={measurements[index]} type="number" readOnly={index > 0} data-calculated={index > 0 ? true : undefined} disabled={!editable} min="0" step="0.0001" onInput={index === 0 ? invalidateCalculation : undefined} defaultValue={(index > 0 ? examination?.measurementEntries[index]?.reading?.toFixed(2) : examination?.measurementEntries[index]?.reading) ?? ""} />}</td>
            <td><input name={`gold-${index}`} aria-label={`Алтны сорьц ${index + 1}`} type="number" readOnly data-calculated disabled={!editable} min="0" max="1000" step="0.000001" defaultValue={(examination?.weightEntries[index]?.goldAssay ?? examination?.measurementEntries[index]?.goldAssay)?.toFixed(2) ?? ""} /></td>
          </tr>)}</tbody>
        </table>
        <div className="examination-results"><h3>Сорьцын дүн</h3>
          <label>Алтны сорьц ‰<input name="goldResult" type="number" readOnly data-calculated disabled={!editable} min="0" max="1000" step="0.000001" defaultValue={examination?.goldResult?.toFixed(2) ?? ""} /></label>
          <label>Мөнгөний сорьц ‰<input name="silverResult" type="number" readOnly data-calculated disabled={!editable} min="0" max="1000" step="0.000001" defaultValue={examination?.silverResult?.toFixed(2) ?? ""} /></label>
        </div></>}
        </div>
        {isSilver && <div className="silver-result"><label className="examination-total">Сорьцын дүн:<input name="silverResult" aria-label="Мөнгөний сорьцын дүн" type="number" readOnly data-calculated disabled={!editable} min="0" max="1000" step="0.000001" defaultValue={examination?.silverResult?.toFixed(2) ?? ""} /></label>
        </div>}
        <table className="examination-table examination-totals"><colgroup><col /><col className="calculation-column" /><col /></colgroup><tbody>
          <tr><td><label className="examination-total">Дүн:<input readOnly tabIndex={-1} onMouseDown={(event) => event.preventDefault()} aria-label="Авсан жингийн дүн" value={totals[0].toFixed(4).replace(/0{1,2}$/, "")} /></label></td><td /><td><label className="examination-total">Дүн:<input readOnly tabIndex={-1} onMouseDown={(event) => event.preventDefault()} aria-label={isSilver ? "Титрийн эзлэхүүний дүн" : "Гарсан жингийн дүн"} value={totals[1].toFixed(4).replace(/0{1,2}$/, "")} /></label></td></tr>
        </tbody></table>
        <div className={`examination-footer-fields${isSilver ? " silver-footer-fields" : ""}`}>
          {!isSilver && (!manager || reexamination) && <label className="examination-recheck"><input type="checkbox" disabled={!editable} name="reexaminationRequested" checked={reexamination} onChange={(event) => {
            setReexamination(event.target.checked);
            setHasUnsavedChanges(true);
            focusNotes.current = event.target.checked;
            if (!event.target.checked) { invalidateCalculation(); setWeightRowCount(4); }
          }} aria-controls="reexamination-description" /><span>Дахин шинжилгээ хийх</span></label>
          }
          <div id="reexamination-description" className={`examination-description${reexamination ? " is-open" : ""}`} inert={!reexamination}>
            <div><input ref={notesRef} name="notes" aria-label="Тайлбар" placeholder="Тайлбар" maxLength={2000} disabled={!reexamination || !editable} onInput={() => setHasUnsavedChanges(true)} defaultValue={examination?.notes ?? ""} /></div>
          </div>
        </div>
      </div></div>
      </fieldset>
      <div className="examination-actions">
        {!manager && sample.substitutedByName && sample.substitutedAt && <span className="substitute-notice">Шилжүүлсэн химич: <strong>{sample.substitutedByName}</strong> · <time dateTime={sample.substitutedAt}>{workflowDate(sample.substitutedAt)}</time></span>}
        <SubmissionNotice sample={sample} />
        {manager ? <>{sample.status === "submitted" && <><button className="secondary-button" type="button" disabled={saving} onClick={() => setReturningForCorrection(true)}>Буцаах</button><button className="primary-button" type="button" disabled={saving} onClick={() => void approve()}>Батлах</button></>}{batchReadyForFinalization && !sample.certificateNo && <button className="primary-button" type="button" disabled={saving} onClick={() => void signCertificateWithEsign()}>eSign-аар эцсийн гэрчилгээ батлах</button>}{sample.certificateNo && <><span className="certificate-ready">Гэрчилгээ № {sample.certificateNo}</span>{sample.certificateSignatureStatus === "unsigned" && <button className="primary-button" type="button" disabled={saving} onClick={() => void signCertificateWithEsign()}>eSign-аар гэрчилгээ батлах</button>}{(sample.certificateSignatureStatus === "signed" || sample.certificateSignatureStatus === "cryptographically_verified") && <span className="certificate-ready">eSign баталсан</span>}<button className="secondary-button" type="button" disabled={saving} onClick={() => void printArchiveReport()}>Архивын тайлан хэвлэх</button></>}</> : <>
        <button className="secondary-button" type="button" disabled={saving || !editable || !canCalculate} onClick={checkCalculation}>Бодолт</button>
        <button className="secondary-button" type="button" disabled={saving || !editable || !canCalculate} onClick={checkCalculation}>Шалгах</button>
        <button className="primary-button" type="submit" value="draft" disabled={saving || !editable}>Хадгалах</button>
        <button className="primary-button" type="submit" value="submit" disabled={saving || !editable}>Хяналтад илгээх</button>
        <button className="secondary-button" type="button" disabled={saving || !editable} title={!examination || hasUnsavedChanges ? "Эхлээд дүнг хадгална уу." : "Орлогч химич томилох"} onClick={chooseSubstituteChemist}>Орлогч томилох</button>
        </>}
        {!embedded && <button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Хаах</button>}
      </div>
    </form>
    {substituteChoices && <SubstituteChemistDialog chemists={substituteChoices} value={substituteChemist} saving={saving} onChange={setSubstituteChemist} onClose={() => { if (!saving) { setSubstituteChoices(null); setSubstituteChemist(""); } }} onConfirm={() => void substitute(substituteChemist)} />}
  </>;
  const feedback = error && <p className="login-error examination-feedback" role="alert"><span>{error}</span><time aria-label={`Алдаа ${errorSecondsRemaining} секундын дараа хаагдана`}>Автоматаар хаагдана: {errorSecondsRemaining}с</time></p>;
  const toast = toastError && <div className="workspace-toast workspace-toast-error" role="alert" aria-live="assertive"><span>{toastError}</span><button type="button" aria-label="Мэдэгдэл хаах" title="Хаах" onClick={() => setToastError("")}><X size={17} aria-hidden="true" /></button></div>;
  const returnDialog = returningForCorrection && <ReturnForCorrectionDialog note={returnNote} saving={saving} onChange={setReturnNote} onClose={() => { if (!saving) { setReturningForCorrection(false); setReturnNote(""); } }} onConfirm={() => void returnForCorrection()} />;
  if (embedded) return <><section className="chemist-examination">{content}</section>{feedback}{returnDialog}{toast}</>;
  return <><WorkspaceDialog size="examination" title={sample.metal === "gold" ? "Алтан гулдмайн шинжилгээ" : "Мөнгөн гулдмайн шинжилгээ"}
    titleBadge={<span className={`examination-status examination-status-${displayedStatus}`}>{statusLabels[displayedStatus] ?? displayedStatus}</span>}
    onClose={() => { if (!saving) onClose(); }}>{content}{feedback}{returnDialog}</WorkspaceDialog>{toast}</>;
}

function ReturnForCorrectionDialog({ note, saving, onChange, onClose, onConfirm }: { note: string; saving: boolean; onChange(value: string): void; onClose(): void; onConfirm(): void }) {
  return <div className="account-dialog-backdrop" role="presentation"><section className="account-dialog return-for-correction-dialog" role="dialog" aria-modal="true" aria-labelledby="return-for-correction-title">
    <h2 id="return-for-correction-title">Шинжилгээг буцаах</h2><p>Химич засвар хийхийн тулд тайлбар оруулна уу.</p>
    <label>Засварын тэмдэглэл<textarea value={note} onChange={(event) => onChange(event.target.value)} maxLength={2000} autoFocus disabled={saving} /></label>
    <div className="account-dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Болих</button><button type="button" className="primary-button" onClick={onConfirm} disabled={saving || !note.trim()}>{saving ? "Буцааж байна..." : "Химичид буцаах"}</button></div>
  </section></div>;
}

function SubstituteChemistDialog({ chemists, value, saving, onChange, onClose, onConfirm }: { chemists: { id: string; fullName: string }[]; value: string; saving: boolean; onChange(value: string): void; onClose(): void; onConfirm(): void }) {
  return <WorkspaceDialog size="compact" title="Орлогч химич томилох" onClose={onClose}>
    <p className="substitute-dialog-copy">Энэ дээжийг сонгосон химичид шилжүүлнэ. Шилжүүлсний дараа таны жагсаалтаас хасагдана.</p>
    {chemists.length ? <label className="workspace-field">Орлох химич<select aria-label="Орлох химич" value={value} disabled={saving} onChange={(event) => onChange(event.target.value)}><option value="">Сонгоно уу</option>{chemists.map((chemist) => <option key={chemist.id} value={chemist.id}>{chemist.fullName}</option>)}</select></label> : <p className="substitute-dialog-empty">Танай сорьцын төвд идэвхтэй өөр химич алга.</p>}
    <div className="substitute-dialog-actions"><button className="secondary-button" type="button" disabled={saving} onClick={onClose}>Цуцлах</button><button className="primary-button" type="button" disabled={saving || !value} onClick={onConfirm}>Томилох</button></div>
  </WorkspaceDialog>;
}
