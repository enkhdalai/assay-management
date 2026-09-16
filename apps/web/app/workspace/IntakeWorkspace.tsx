"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, ClipboardCheck, FlaskConical, Minus, PackageCheck, Plus, RefreshCw, UsersRound } from "lucide-react";
import type { AnonymousSample, BullionIntakeBatchRecord, CreateBullionIntakeInput } from "../../../../packages/shared/src";
import { CreateCustomerDialog } from "../CustomerComponents";
import { WorkspaceDialog } from "../OperationalWorkspace";
import { api } from "./api";
import { CalendarDateInput } from "./CalendarDateInput";
import { ChemistPicker } from "./ChemistPicker";
import { WorkspaceLoadingSkeleton } from "./WorkspaceLoadingSkeleton";
import { CustomerCombobox, type IntakeCustomerOption } from "./CustomerCombobox";

type CustomerOption = IntakeCustomerOption;
type WeightRow = { id?: string; bullionNo: string; before: string; after: string; slag: string; sample: string };
type DailyChemist = { id: string; fullName: string; status: string; onVacation: boolean };
type DailyChemistSchedule = { date: string; goldChemistId: string | null; silverChemistId: string | null; chemists: DailyChemist[] };
const newRow = (): WeightRow => ({ bullionNo: "", before: "", after: "", slag: "", sample: "" });
const optional = (value: string) => value.trim() === "" ? undefined : Number(value);
const slagValue = (row: WeightRow) => row.before.trim() && row.after.trim()
  && Number.isFinite(Number(row.before)) && Number.isFinite(Number(row.after))
  ? String(Number((Number(row.before) - Number(row.after)).toFixed(4))) : "";
const intakeStatus = (status: BullionIntakeBatchRecord["status"]) => status === "sample_taken" ? "Дээж илгээсэн" : status === "ready_for_sampling" ? "Эрхлэгчид илгээсэн" : "Хүлээн авалт / хайлалт";
const examinationNumber = (value?: string) => value ? value.padStart(4, "0") : "-";
const bullionNumber = (firstNumber: string, offset = 0) => {
  if (!/^\d+$/.test(firstNumber)) return "";
  return String(Number(firstNumber) + offset).padStart(Math.max(4, firstNumber.length), "0");
};
const intakeDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" });
const assignmentDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function intakeDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "-";
  const parts = intakeDateFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function assignmentDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "-";
  const parts = assignmentDateFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
function centerToday() {
  const parts = intakeDateFormatter.formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function IntakeWorkspace({ manager }: { manager: boolean }) {
  const [batches, setBatches] = useState<BullionIntakeBatchRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BullionIntakeBatchRecord | "gold" | "silver" | null>(null);
  const [tracking, setTracking] = useState<{ batch: BullionIntakeBatchRecord; samples: AnonymousSample[] } | null>(null);
  const [openingTrackingId, setOpeningTrackingId] = useState<string | null>(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [dailyChemistScheduleOpen, setDailyChemistScheduleOpen] = useState(false);
  const refresh = useCallback(() => Promise.all([api<{ data: BullionIntakeBatchRecord[] }>("/api/v1/bullion/intakes"), api<{ data: CustomerOption[] }>("/api/v1/customers/lookup")])
    .then(([intakes, lookup]) => { setBatches(intakes.data); setCustomers(lookup.data); setError(""); })
    .catch((error) => setError(error.message)).finally(() => setLoading(false)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const openTracking = useCallback(async (batchId: string) => {
    setOpeningTrackingId(batchId);
    try {
      const [intakes, sampleResult] = await Promise.all([
        api<{ data: BullionIntakeBatchRecord[] }>("/api/v1/bullion/intakes", { cache: "no-store" }),
        manager ? api<{ data: AnonymousSample[] }>("/api/v1/bullion/samples", { cache: "no-store" }) : Promise.resolve({ data: [] as AnonymousSample[] }),
      ]);
      const batch = intakes.data.find((candidate) => candidate.id === batchId);
      if (!batch) throw new Error("Бүртгэл олдсонгүй.");
      setBatches(intakes.data);
      setTracking({ batch, samples: sampleResult.data.filter((sample) => sample.batchId === batchId) });
      setError("");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setOpeningTrackingId(null);
    }
  }, [manager]);
  const refreshTracking = useCallback(async () => {
    if (tracking) await openTracking(tracking.batch.id);
  }, [openTracking, tracking]);
  const filtered = batches.filter((batch) => `${batch.publicId} ${batch.customerName} ${batch.items.map((item) => item.bullionNo).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="workspace-section">
    <div className="workspace-toolbar"><input aria-label="Бүртгэл хайх" placeholder="Дугаар, харилцагчаар хайх" value={search} onChange={(event) => setSearch(event.target.value)} />
      <button type="button" className="secondary-button intake-refresh-button" aria-label="Шинэчлэх" title="Шинэчлэх" disabled={loading} onClick={refresh}><RefreshCw size={20} aria-hidden="true" /></button>
      <button type="button" className="secondary-button" onClick={() => setCreatingCustomer(true)}>Харилцагч нэмэх</button>
      {manager && <button type="button" className="secondary-button" onClick={() => setDailyChemistScheduleOpen(true)}><UsersRound size={18} aria-hidden="true" />Өнөөдрийн химич</button>}
      <button type="button" className="primary-button" onClick={() => setEditing("gold")}>Алтан гулдмай бүртгэх</button>
      <button type="button" className="primary-button" onClick={() => setEditing("silver")}>Мөнгөн гулдмай бүртгэх</button></div>
    {error && <p role="alert" className="login-error">{error}</p>}
    {loading ? <WorkspaceLoadingSkeleton /> : <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Бүртгэл №</th><th>Харилцагч</th><th>Огноо</th><th>Металл</th><th>Гулдмай</th><th>Бүртгэсэн ажилтан</th><th>Төлөв</th></tr></thead><tbody>{filtered.map((batch) => <tr key={batch.id} className="intake-batch-row" tabIndex={0} onClick={() => setEditing(batch)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setEditing(batch); } }} aria-label={`${batch.publicId} бүртгэлийн дэлгэрэнгүй`}><td><strong className="registration-number">{batch.publicId}</strong></td><td>{batch.customerName}</td><td>{intakeDate(batch.receivedAt || batch.createdAt)}</td><td>{batch.metal === "gold" ? "Алт" : "Мөнгө"}</td><td>{batch.pieceCount}</td><td>{batch.receivedByName || "-"}</td><td><button type="button" className="secondary-button intake-status-button" disabled={openingTrackingId === batch.id} onClick={(event) => { event.stopPropagation(); void openTracking(batch.id); }} onKeyDown={(event) => event.stopPropagation()}>{openingTrackingId === batch.id ? "Уншиж байна..." : intakeStatus(batch.status)}</button></td></tr>)}</tbody></table>{filtered.length === 0 && <p>Бүртгэл олдсонгүй.</p>}</div>}
    {editing && <IntakeDialog key={typeof editing === "string" ? editing : editing.id} batch={typeof editing === "string" ? null : editing} initialMetal={typeof editing === "string" ? editing : editing.metal} customers={customers} manager={manager} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />}
    {tracking && <AssignmentDialog batch={tracking.batch} samples={tracking.samples} manager={manager} onClose={() => setTracking(null)} onSaved={refreshTracking} />}
    {creatingCustomer && <CreateCustomerDialog onClose={() => setCreatingCustomer(false)} onCreated={(customer) => { setCustomers((current) => [...current, { ...customer, registrationNumber: customer.registrationNumberMasked, province: customer.province ?? null, district: customer.district ?? null, origin: null }]); setCreatingCustomer(false); }} />}
    {dailyChemistScheduleOpen && <DailyChemistScheduleDialog onClose={() => setDailyChemistScheduleOpen(false)} />}
  </section>;
}

function DailyChemistScheduleDialog({ onClose }: { onClose(): void }) {
  const [date, setDate] = useState(centerToday);
  const [schedule, setSchedule] = useState<DailyChemistSchedule | null>(null);
  const [goldChemistId, setGoldChemistId] = useState<string | null>(null);
  const [silverChemistId, setSilverChemistId] = useState<string | null>(null);
  const [vacationChemistIds, setVacationChemistIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void api<{ data: DailyChemistSchedule }>(`/api/v1/bullion/intakes/daily-chemist-assignment?date=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then(({ data }) => {
        if (!active) return;
        setSchedule(data); setGoldChemistId(data.goldChemistId); setSilverChemistId(data.silverChemistId);
        setVacationChemistIds(data.chemists.filter((chemist) => chemist.onVacation).map((chemist) => chemist.id));
      })
      .catch((error) => { if (active) setError((error as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [date]);
  const toggleVacation = (chemistId: string) => {
    setVacationChemistIds((current) => {
      const next = current.includes(chemistId) ? current.filter((id) => id !== chemistId) : [...current, chemistId];
      if (next.includes(chemistId)) {
        if (goldChemistId === chemistId) setGoldChemistId(null);
        if (silverChemistId === chemistId) setSilverChemistId(null);
      }
      return next;
    });
  };
  const eligible = schedule?.chemists.filter((chemist) => chemist.status === "active" && !vacationChemistIds.includes(chemist.id)) ?? [];
  async function save() {
    setSaving(true); setError("");
    try {
      await api("/api/v1/bullion/intakes/daily-chemist-assignment", { method: "PUT", body: JSON.stringify({ date, goldChemistId, silverChemistId, vacationChemistIds }) });
      onClose();
    } catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  return <WorkspaceDialog title="Өдрийн химичийн хуваарь" onClose={() => { if (!saving) onClose(); }}>
    <div className="daily-chemist-schedule">
      <label>Огноо<input type="date" value={date} disabled={saving} onChange={(event) => setDate(event.target.value)} /></label>
      {loading ? <WorkspaceLoadingSkeleton rows={3} /> : <>
        <div className="daily-chemist-defaults">
          <label>Алтан гулдмай<select value={goldChemistId ?? ""} disabled={saving} onChange={(event) => setGoldChemistId(event.target.value || null)}><option value="">Химич сонгохгүй</option>{eligible.map((chemist) => <option key={chemist.id} value={chemist.id}>{chemist.fullName}</option>)}</select></label>
          <label>Мөнгөн гулдмай<select value={silverChemistId ?? ""} disabled={saving} onChange={(event) => setSilverChemistId(event.target.value || null)}><option value="">Химич сонгохгүй</option>{eligible.map((chemist) => <option key={chemist.id} value={chemist.id}>{chemist.fullName}</option>)}</select></label>
        </div>
        <div className="daily-chemist-roster" role="list" aria-label="Химичдийн жагсаалт">
          {schedule?.chemists.map((chemist) => <label key={chemist.id} className={vacationChemistIds.includes(chemist.id) ? "is-on-vacation" : ""}>
            <span><strong>{chemist.fullName}</strong><small>{chemist.status === "active" ? "Идэвхтэй" : "Идэвхгүй"}</small></span>
            <span className="daily-chemist-vacation"><input type="checkbox" checked={vacationChemistIds.includes(chemist.id)} disabled={saving || chemist.status !== "active"} onChange={() => toggleVacation(chemist.id)} />Амралттай</span>
          </label>)}
          {!schedule?.chemists.length && <p>Бүртгэлтэй химич алга байна.</p>}
        </div>
      </>}
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="workspace-dialog-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Болих</button><button type="button" className="primary-button" disabled={loading || saving} onClick={() => void save()}>{saving ? "Хадгалж байна..." : "Хадгалах"}</button></div>
    </div>
  </WorkspaceDialog>;
}

function AssignmentDialog({ batch, samples, manager, onClose, onSaved }: {
  batch: BullionIntakeBatchRecord; samples: AnonymousSample[]; manager: boolean; onClose(): void; onSaved(): Promise<void>;
}) {
  return <WorkspaceDialog title={`${batch.publicId} · Дээжийн хуваарилалт`} onClose={onClose}>
    <BatchWorkflowTimeline batch={batch} samples={samples} />
    <div className="workspace-table-scroll"><table className="workspace-table">
      <thead><tr><th>Гулдмайн №</th><th>Шинжилгээний №</th><th>Хариуцсан химич</th><th>Хуваарилсан огноо</th></tr></thead>
      <tbody>{batch.items.map((item) => <tr key={item.id}><td>{item.bullionNo}</td><td>{examinationNumber(item.analysisNo)}</td>
        <td>{manager && batch.status === "sample_taken" ? <ChemistPicker sample={{
          id: item.id, batchId: batch.id, bullionNo: item.bullionNo ?? "", analysisNo: item.analysisNo ?? "",
          metal: batch.metal, receivedAt: batch.receivedAt ?? batch.createdAt,
          sampleWeightMilligrams: item.sampleWeightMilligrams ?? 0, delta: batch.delta ?? 0,
          revisionNo: 0, status: "draft", examination: null,
          assignedChemistId: item.assignedChemistId, assignedChemistName: item.assignedChemistName, assignedAt: item.assignedAt,
        }} onSaved={onSaved} /> : item.assignedChemistName || (batch.status === "sample_taken" ? "Химич хуваарилаагүй" : batch.status === "ready_for_sampling" ? "Лабораторийн эрхлэгч хүлээн авна" : "Хайлалт хүлээгдэж байна")}</td>
        <td>{assignmentDate(item.assignedAt)}</td></tr>)}</tbody>
    </table></div>
  </WorkspaceDialog>;
}

function BatchWorkflowTimeline({ batch, samples }: { batch: BullionIntakeBatchRecord; samples: AnonymousSample[] | null }) {
  const matchedSamples = samples ?? [];
  const hasAllSamples = matchedSamples.length === batch.items.length && batch.items.length > 0;
  const allSubmitted = hasAllSamples && matchedSamples.every((sample) => sample.status === "submitted" || sample.status === "approved");
  const allApproved = hasAllSamples && matchedSamples.every((sample) => sample.status === "approved");
  const signed = matchedSamples.some((sample) => sample.certificateSignatureStatus === "signed" || sample.certificateSignatureStatus === "cryptographically_verified");
  const handoffComplete = batch.status === "sample_taken";
  const currentStep = signed ? 4 : allSubmitted ? 4 : handoffComplete ? 3 : 2;
  const steps = [
    { title: "Бүртгэл", detail: "Металл хүлээн авсан", icon: PackageCheck, state: "complete" },
    { title: "Дээж авах", detail: "Химичид хуваарилсан", icon: ClipboardCheck, state: handoffComplete ? "complete" : currentStep === 2 ? "current" : "pending" },
    { title: "Шинжилгээ", detail: "Химич дүн илгээх", icon: FlaskConical, state: allSubmitted ? "complete" : currentStep === 3 ? "current" : "pending" },
    { title: "Баталгаажуулалт", detail: "LE баталж, eSign зурна", icon: BadgeCheck, state: signed ? "complete" : currentStep === 4 ? "current" : "pending" },
  ] as const;
  return <ol className="batch-workflow-timeline" aria-label="Гулдмайн ажлын явц">
    {steps.map((step, index) => {
      const Icon = step.icon;
      return <li key={step.title} className={`batch-workflow-step is-${step.state}`}>
        <span className="batch-workflow-marker"><Icon size={18} aria-hidden="true" /></span>
        <span className="batch-workflow-copy"><strong>{index + 1}. {step.title}</strong><small>{step.detail}</small></span>
      </li>;
    })}
  </ol>;
}

export function IntakeDialog({ batch, initialMetal = "gold", customers, manager, onClose, onSaved }: {
  batch: BullionIntakeBatchRecord | null; initialMetal?: "gold" | "silver"; customers: CustomerOption[]; manager: boolean;
  onClose(): void; onSaved(): void;
}) {
  const [rows, setRows] = useState<WeightRow[]>(batch ? batch.items.map((item) => ({ id: item.id, bullionNo: item.bullionNo ?? "", before: String(item.grossWeightBeforeGrams), after: item.grossWeightAfterGrams == null ? "" : String(item.grossWeightAfterGrams), slag: item.slagWeightGrams == null ? "" : String(item.slagWeightGrams), sample: item.sampleWeightMilligrams == null ? "" : String(item.sampleWeightMilligrams) })) : [newRow()]);
  const [customerId, setCustomerId] = useState(batch?.customerId || "");
  const [location, setLocation] = useState({ province: batch?.province ?? "", district: batch?.district ?? "", origin: batch?.dispatchReference ?? "" });
  const metal = batch?.metal ?? initialMetal;
  const [sequence, setSequence] = useState<{ customerId: string; nextNumber: string; prefix: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const locked = !!batch && batch.status !== "draft" && !(manager && batch.status === "ready_for_sampling");
  const meltingComplete = rows.every((row) => row.after.trim() !== "" && Number.isFinite(Number(row.after))
    && Number(row.after) > 0 && Number(row.after) <= Number(row.before));
  const sampleComplete = !manager || rows.every((row) => row.sample.trim() !== "" && Number.isFinite(Number(row.sample)) && Number(row.sample) > 0);
  const startNumber = batch?.initialBullionNumber || (sequence?.customerId === customerId ? sequence.nextNumber : "");
  useEffect(() => {
    if (batch || !customerId) return;
    let active = true;
    void api<{ nextNumber: string; prefix: string }>(`/api/v1/bullion/intakes/next-number?customerId=${encodeURIComponent(customerId)}`)
      .then((result) => { if (active) { setSequence({ customerId, nextNumber: result.nextNumber, prefix: result.prefix ?? "" }); setError(""); } })
      .catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [batch, customerId]);
  function changeQuantity(value: string) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 100) return;
    if (count < rows.length && rows.slice(count).some((row) => row.before || row.after || row.slag || row.sample)) {
      setError("Жин оруулсан мөрийг Хасах товчоор хасна уу."); return;
    }
    setRows((current) => count > current.length ? [...current, ...Array.from({ length: count - current.length }, newRow)] : current.slice(0, count));
  }
  function update(index: number, field: keyof WeightRow, value: string) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row)); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batch && !startNumber) return;
    setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value");
    const status = action === "sample_taken" ? "sample_taken" : action === "ready_for_sampling" || batch?.status === "ready_for_sampling" ? "ready_for_sampling" : "draft";
    if (status !== "draft" && !meltingComplete) {
      setError("Гулдмай бүрийн хайлалтын дараах жинг зөв оруулна уу."); setSaving(false); return;
    }
    if (status === "sample_taken" && !sampleComplete) {
      setError("Гулдмай бүрийн дээжийн жинг оруулна уу."); setSaving(false); return;
    }
    try {
      if (batch) {
        await api(`/api/v1/bullion/intakes/${batch.id}`, { method: "PATCH", body: JSON.stringify({ status, items: rows.map((row) => ({ id: row.id, grossWeightAfterGrams: optional(row.after), slagWeightGrams: optional(slagValue(row)), ...(manager ? { sampleWeightMilligrams: optional(row.sample) } : {}) })) }) });
      } else {
        const input: CreateBullionIntakeInput = { customerId, metal: metal === "silver" ? "silver" : "gold", receivedAt: String(form.get("receivedAt")), branchName: String(form.get("branchName") || ""), province: String(form.get("province") || ""), district: String(form.get("district") || ""), dispatchReference: String(form.get("origin") || ""), delta: Number(form.get("delta")), status,
          items: rows.map((row) => ({ bullionNo: row.bullionNo.trim(), grossWeightBeforeGrams: Number(row.before), grossWeightAfterGrams: optional(row.after), slagWeightGrams: optional(slagValue(row)), ...(manager ? { sampleWeightMilligrams: optional(row.sample) } : {}) })) };
        await api("/api/v1/bullion/intakes", { method: "POST", body: JSON.stringify(input) });
      }
      onSaved();
    } catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  return <WorkspaceDialog title={metal === "silver" ? "Мөнгөн гулдмайн дээж авах" : "Алтан гулдмайн дээж авах"} onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={submit} className="workspace-form"><fieldset disabled={saving || locked}>
      {!batch && <div className="workspace-form-grid">
        <label htmlFor="intake-date">Огноо<CalendarDateInput id="intake-date" name="receivedAt" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label htmlFor="intake-customer">Харилцагч байгууллага<CustomerCombobox inputId="intake-customer" customers={customers} value={customerId} onChange={(customer) => { setSequence(null); setCustomerId(customer?.id ?? ""); setLocation({ province: customer?.province ?? "", district: customer?.district ?? "", origin: customer?.origin ?? "" }); }} /></label>
        <label>Гулдмайн эхлэх дугаар<input className="intake-auto-number" readOnly aria-readonly="true" value={startNumber} placeholder={customerId && !startNumber ? "Ачаалж байна..." : ""} /></label>
        <div className="intake-secondary-fields"><label>Салбар байгууллага<input name="branchName" maxLength={255} /></label><label>Тоо ширхэг<input type="number" min="1" max="100" step="1" value={rows.length} onChange={(event) => changeQuantity(event.target.value)} /></label><label>Делта<input className="intake-auto-number" name="delta" type="number" step="0.000001" readOnly aria-readonly="true" defaultValue="-0.03125" required /></label></div>
        <div className="intake-location-fields"><label>Аймаг, хот<input name="province" maxLength={120} value={location.province} onChange={(event) => setLocation((current) => ({ ...current, province: event.target.value }))} /></label><label>Сум, дүүрэг<input name="district" maxLength={120} value={location.district} onChange={(event) => setLocation((current) => ({ ...current, district: event.target.value }))} /></label><label>Гарал, үүсэл<input name="origin" maxLength={120} value={location.origin} onChange={(event) => setLocation((current) => ({ ...current, origin: event.target.value }))} /></label></div>
      </div>}
      {batch && <div className="workspace-form-grid"><label>Харилцагч байгууллага<input readOnly value={batch.customerName} /></label><label>Гулдмайн эхлэх дугаар<input className="intake-auto-number" readOnly aria-readonly="true" value={batch.initialBullionNumber || "-"} /></label><label>Тоо ширхэг<input readOnly value={rows.length} /></label></div>}
      <div className="workspace-table-scroll"><table className="workspace-table weight-table"><thead><tr><th rowSpan={2}>Шинжилгээний №</th><th rowSpan={2}>Гулдмайн №</th><th colSpan={2}>Хайлалтын жин /гр/</th><th rowSpan={2}>Шлак /гр/</th>{manager && <th rowSpan={2}>Дээжийн жин /мг/</th>}{!batch && <th rowSpan={2}>Үйлдэл</th>}</tr><tr><th>Өмнөх</th><th>Дараах</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>
        <td><input aria-label={`Шинжилгээ ${index + 1} дугаар`} readOnly value={batch?.items[index]?.analysisNo || ""} placeholder="Автомат" /></td>
        <td><input className="intake-auto-number" aria-label={`Гулдмай ${index + 1} дугаар`} readOnly aria-readonly="true" value={batch ? row.bullionNo : bullionNumber(startNumber, index)} /></td>
        {(["before", "after", "slag", ...(manager ? ["sample"] : [])] as const).map((field) => <td key={field}><input aria-label={`${index + 1} ${field}`} type="number" min={field === "before" || field === "sample" || field === "after" ? "0.0001" : "0"} max={field === "after" && row.before ? Number(row.before) : undefined} step="0.0001" required={field === "before"} readOnly={field === "slag" || (field === "before" && !!batch)} data-calculated={field === "slag" || undefined} value={field === "slag" ? slagValue(row) : row[field as keyof WeightRow] || ""} onChange={(event) => update(index, field as keyof WeightRow, event.target.value)} /></td>)}
        {!batch && <td className="weight-row-action"><div className="weight-row-actions">{index === rows.length - 1 && <button type="button" className="weight-row-icon-button" aria-label="Гулдмай нэмэх" title="Гулдмай нэмэх" disabled={rows.length >= 100} onClick={() => setRows((current) => [...current, newRow()])}><Plus aria-hidden="true" size={18} /></button>}{index > 0 && <button type="button" className="weight-row-icon-button weight-row-remove-button" aria-label="Гулдмай хасах" title="Гулдмай хасах" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}><Minus aria-hidden="true" size={18} /></button>}</div></td>}
      </tr>)}</tbody></table></div>
      {!locked && <div className="workspace-toolbar intake-form-actions"><button className="primary-button" type="submit" value="draft" disabled={!batch && !startNumber}>Хадгалах</button>
        {!manager && <button className="secondary-button" type="submit" value="ready_for_sampling" disabled={(!batch && !startNumber) || !meltingComplete}>Эрхлэгчид илгээх</button>}
        {manager && <button className="secondary-button" type="submit" value="sample_taken" disabled={(!batch && !startNumber) || !meltingComplete || !sampleComplete}>Дээж авах</button>}</div>}
    </fieldset>{error && <p className="login-error" role="alert">{error}</p>}</form>
  </WorkspaceDialog>;
}
