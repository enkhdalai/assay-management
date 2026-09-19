"use client";

import { useCallback, useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BadgeCheck, ClipboardCheck, FlaskConical, LoaderCircle, Minus, PackageCheck, Pencil, PencilLine, Plus, ReceiptText, RefreshCw, UsersRound, X } from "lucide-react";
import type { AnonymousSample, BullionIntakeBatchRecord, CreateBullionIntakeInput, CreateJewelryIntakeInput, JewelryIntakeRecord, JewelryServicePriceRule } from "../../../../packages/shared/src";
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
type DailyChemistSchedule = { date: string; goldChemistIds: string[]; silverChemistIds: string[]; chemists: DailyChemist[] };
type JewelryCatalogueItem = { name: string; metal: "gold" | "silver"; spoonType: "Халбагатай" | "Халбагагүй" };
const fallbackJewelryCatalogue: JewelryCatalogueItem[] = [
  { name: "Таг/мөнгөн/", metal: "silver", spoonType: "Халбагатай" },
  { name: "Зүрх /алтан/", metal: "gold", spoonType: "Халбагагүй" },
  { name: "Хяналтын дээж/999,99/", metal: "gold", spoonType: "Халбагагүй" },
  { name: "Цагны нүүр/алтан/", metal: "gold", spoonType: "Халбагатай" },
  { name: "Бүсний тоног/алтан/", metal: "gold", spoonType: "Халбагатай" },
  { name: "Цөгц/алтан/", metal: "gold", spoonType: "Халбагатай" },
  { name: "Дөрөө/мөнгөн/", metal: "silver", spoonType: "Халбагатай" },
  { name: "Ялтсан зоос/алтан/", metal: "gold", spoonType: "Халбагагүй" },
  { name: "Одон/мөнгөн/", metal: "silver", spoonType: "Халбагатай" },
  { name: "Сэрээ /алтан/", metal: "gold", spoonType: "Халбагатай" },
  { name: "Халбага /алтан/", metal: "gold", spoonType: "Халбагатай" },
  { name: "Тогоо /алтан/ сүвнер", metal: "gold", spoonType: "Халбагатай" },
  { name: "Тулга /алтан/ сүвнер", metal: "gold", spoonType: "Халбагатай" },
  { name: "Хуудас /алтан/", metal: "gold", spoonType: "Халбагагүй" },
  { name: "Өлзий/алтан/", metal: "gold", spoonType: "Халбагагүй" },
  { name: "Чарм/алтан/", metal: "gold", spoonType: "Халбагагүй" },
  { name: "Эрх/алтан/", metal: "gold", spoonType: "Халбагагүй" },
  { name: "Очир/алтан/", metal: "gold", spoonType: "Халбагагүй" },
  { name: "Шатрын чимэг/алтан/", metal: "gold", spoonType: "Халбагатай" },
  { name: "Хяналтын дээж/алтан/", metal: "gold", spoonType: "Халбагатай" },
];
const jewelryWeightBands = ["0-10 гр", "10-50 гр", "50-100 гр", "100-500 гр", "500-1000 гр", "1000 гр дээш"];
const fallbackJewelryPriceRules: JewelryServicePriceRule[] = [
  { id: "gold-0-500", serviceCode: "gold_jewelry_analysis", metal: "gold", minWeightGrams: 0, maxWeightGrams: 500, priceMnt: 50000, effectiveFrom: "2026-01-01" },
  { id: "gold-501-2000", serviceCode: "gold_jewelry_analysis", metal: "gold", minWeightGrams: 500.001, maxWeightGrams: 2000, priceMnt: 100000, effectiveFrom: "2026-01-01" },
  { id: "gold-2001-4000", serviceCode: "gold_jewelry_analysis", metal: "gold", minWeightGrams: 2000.001, maxWeightGrams: 4000, priceMnt: 150000, effectiveFrom: "2026-01-01" },
  { id: "gold-4001-6000", serviceCode: "gold_jewelry_analysis", metal: "gold", minWeightGrams: 4000.001, maxWeightGrams: 6000, priceMnt: 175000, effectiveFrom: "2026-01-01" },
  { id: "gold-6001", serviceCode: "gold_jewelry_analysis", metal: "gold", minWeightGrams: 6000.001, maxWeightGrams: null, priceMnt: 250000, effectiveFrom: "2026-01-01" },
  { id: "silver-flat", serviceCode: "silver_jewelry_analysis", metal: "silver", minWeightGrams: null, maxWeightGrams: null, priceMnt: 25000, effectiveFrom: "2026-01-01" },
  { id: "gold-hallmark", serviceCode: "gold_hallmark", metal: "gold", minWeightGrams: null, maxWeightGrams: null, priceMnt: 2000, effectiveFrom: "2026-01-01" },
  { id: "silver-hallmark", serviceCode: "silver_hallmark", metal: "silver", minWeightGrams: null, maxWeightGrams: null, priceMnt: 1000, effectiveFrom: "2026-01-01" },
  { id: "gold-laser", serviceCode: "gold_laser", metal: "gold", minWeightGrams: null, maxWeightGrams: null, priceMnt: 4000, effectiveFrom: "2026-01-01" },
  { id: "silver-laser", serviceCode: "silver_laser", metal: "silver", minWeightGrams: null, maxWeightGrams: null, priceMnt: 2000, effectiveFrom: "2026-01-01" },
];
const newRow = (): WeightRow => ({ bullionNo: "", before: "", after: "", slag: "", sample: "" });
const optional = (value: string) => value.trim() === "" ? undefined : Number(value);
const formattedNumber = (value: string) => {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return value;
  const [whole, fraction] = value.split(".");
  return `${Number(whole).toLocaleString("en-US")}${fraction == null ? "" : `.${fraction}`}`;
};
function FormattedNumberInput({ value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & { value: string; onValueChange(value: string): void }) {
  const [focused, setFocused] = useState(false);
  return <input {...props} type="text" inputMode="decimal" value={focused ? value : formattedNumber(value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onChange={(event) => {
    const next = event.target.value.replaceAll(",", "");
    if (/^\d*(?:\.\d*)?$/.test(next)) onValueChange(next);
  }} />;
}
const lossValue = (row: WeightRow) => row.before.trim() && row.after.trim()
  && Number.isFinite(Number(row.before)) && Number.isFinite(Number(row.after)) && Number.isFinite(optional(row.slag) ?? 0)
  ? String(Number((Number(row.before) - Number(row.after) - (optional(row.slag) ?? 0)).toFixed(4))) : "";
type IntakeWorkflowStatus = "registered" | "awaiting_assignment" | "assigned" | "awaiting_review" | "approved" | "esign_approved";
function intakeWorkflowStatus(batch: BullionIntakeBatchRecord, samples: AnonymousSample[]): IntakeWorkflowStatus {
  const batchSamples = samples.filter((sample) => sample.batchId === batch.id);
  const hasAllSamples = batch.items.length > 0 && batchSamples.length === batch.items.length;
  const allSigned = hasAllSamples && batchSamples.every((sample) => sample.certificateSignatureStatus === "signed" || sample.certificateSignatureStatus === "cryptographically_verified");
  const allApproved = hasAllSamples && batchSamples.every((sample) => sample.status === "approved");
  const allSubmitted = hasAllSamples && batchSamples.every((sample) => sample.status === "submitted" || sample.status === "approved");
  if (allSigned) return "esign_approved";
  if (allApproved) return "approved";
  if (allSubmitted) return "awaiting_review";
  if (batch.status === "sample_taken") return "assigned";
  if (batch.status === "ready_for_sampling") return "awaiting_assignment";
  return "registered";
}
const intakeWorkflowStatusLabel: Record<IntakeWorkflowStatus, string> = {
  registered: "Бүртгэсэн",
  awaiting_assignment: "Хүлээгдэж байна",
  assigned: "Шинжилгээ",
  awaiting_review: "Хянуулахаар хүлээгдэж байна",
  approved: "Баталсан",
  esign_approved: "eSign баталсан",
};
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
  const [sampleRecords, setSampleRecords] = useState<AnonymousSample[]>([]);
  const [jewelryRecords, setJewelryRecords] = useState<JewelryIntakeRecord[]>([]);
  const [jewelryLoading, setJewelryLoading] = useState(false);
  const [listMode, setListMode] = useState<"all" | "gold" | "silver" | "jewelry">("all");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [activeColumnFilter, setActiveColumnFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<BullionIntakeBatchRecord | "gold" | "silver" | null>(null);
  const [viewing, setViewing] = useState<BullionIntakeBatchRecord | null>(null);
  const [tracking, setTracking] = useState<{ batch: BullionIntakeBatchRecord; samples: AnonymousSample[] } | null>(null);
  const [openingTrackingId, setOpeningTrackingId] = useState<string | null>(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [jewelryRegistrationOpen, setJewelryRegistrationOpen] = useState(false);
  const [jewelrySaveToast, setJewelrySaveToast] = useState<number | null>(null);
  const [dailyChemistScheduleOpen, setDailyChemistScheduleOpen] = useState(false);
  const refresh = useCallback(() => {
    setLoading(true);
    return Promise.all([
      api<{ data: BullionIntakeBatchRecord[] }>("/api/v1/bullion/intakes", { cache: "no-store" }),
      api<{ data: CustomerOption[] }>("/api/v1/customers/lookup", { cache: "no-store" }),
      manager ? api<{ data: AnonymousSample[] }>("/api/v1/bullion/samples", { cache: "no-store" }) : Promise.resolve({ data: [] as AnonymousSample[] }),
    ]).then(([intakes, lookup, samples]) => { setBatches(intakes.data); setCustomers(lookup.data); setSampleRecords(samples.data); setError(""); })
      .catch((error) => setError(error.message)).finally(() => setLoading(false));
  }, [manager]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (jewelrySaveToast === null) return;
    const timeout = window.setTimeout(() => setJewelrySaveToast(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [jewelrySaveToast]);
  const refreshJewelry = useCallback(async () => {
    let active = true;
    setJewelryLoading(true); setError("");
    await api<{ data: JewelryIntakeRecord[] }>("/api/v1/bullion/jewelry-intakes", { cache: "no-store" })
      .then((result) => { if (active) setJewelryRecords(result.data); })
      .catch((error) => { if (active) setError(error.message); })
      .finally(() => { if (active) setJewelryLoading(false); });
    active = false;
  }, []);
  useEffect(() => {
    if (listMode === "jewelry") void refreshJewelry();
  }, [listMode, refreshJewelry]);
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
  const intakeRowValues = (batch: BullionIntakeBatchRecord) => ({
    registrationNo: batch.publicId,
    customer: batch.customerName,
    receivedAt: intakeDate(batch.receivedAt || batch.createdAt),
    metal: batch.metal === "gold" ? "Алт" : "Мөнгө",
    pieceCount: String(batch.pieceCount),
    receivedBy: batch.receivedByName || "-",
    status: intakeWorkflowStatusLabel[intakeWorkflowStatus(batch, sampleRecords)],
  });
  const workflowPriority: Record<IntakeWorkflowStatus, number> = {
    registered: 0,
    awaiting_assignment: 1,
    assigned: 2,
    awaiting_review: 3,
    approved: 4,
    esign_approved: 5,
  };
  const filtered = batches.filter((batch) => {
    const fields = intakeRowValues(batch);
    const matchesColumns = Object.entries(columnFilters).every(([column, value]) => !value.trim() || fields[column as keyof typeof fields].toLocaleLowerCase().includes(value.trim().toLocaleLowerCase()));
    return matchesColumns && (listMode === "all" || listMode === "jewelry" || batch.metal === listMode);
  }).sort((left, right) => manager ? workflowPriority[intakeWorkflowStatus(left, sampleRecords)] - workflowPriority[intakeWorkflowStatus(right, sampleRecords)] : 0);
  function HeaderFilter({ column, text, label = text }: { column: string; text: string; label?: ReactNode }) {
    const isActive = activeColumnFilter === column;
    if (isActive) return <input className="report-column-filter-input intake-column-filter-input" aria-label={`${text} хайх`} autoFocus value={columnFilters[column] ?? ""} placeholder={text} onBlur={() => setActiveColumnFilter(null)} onChange={(event) => setColumnFilters((current) => ({ ...current, [column]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Escape") { setColumnFilters((current) => ({ ...current, [column]: "" })); setActiveColumnFilter(null); } }} />;
    return <button className={`report-column-filter${columnFilters[column] ? " is-filtered" : ""}`} type="button" title={`${text} хайх`} onClick={() => setActiveColumnFilter(column)}>{label}</button>;
  }
  const headerActions = typeof document === "undefined" ? null : document.getElementById("intake-header-actions");
  return <section className="workspace-section">
    {headerActions && createPortal(<><button type="button" className="secondary-button" onClick={() => setCreatingCustomer(true)}>Харилцагч нэмэх</button>{manager && <button type="button" className="secondary-button" onClick={() => setDailyChemistScheduleOpen(true)}><UsersRound size={18} aria-hidden="true" />Химичийн тохиргоо</button>}</>, headerActions)}
    <div className="workspace-toolbar intake-list-toolbar"><div className="intake-list-filters" role="group" aria-label="Бүртгэлийн төрөл шүүх">{([ ["all", "Бүгд"], ["gold", "Алт"], ["silver", "Мөнгө"], ["jewelry", "Эдлэл"] ] as const).map(([mode, label]) => <button key={mode} type="button" className={listMode === mode ? "is-active" : undefined} onClick={() => setListMode(mode)}>{label}</button>)}</div><div className="intake-list-actions"><button type="button" className="secondary-button intake-refresh-button" aria-label="Шинэчлэх" title="Шинэчлэх" disabled={loading} onClick={refresh}><RefreshCw size={20} className={loading ? "is-spinning" : undefined} aria-hidden="true" /></button>
      <button type="button" className="primary-button" onClick={() => setEditing("gold")}>Алтан гулдмай бүртгэх</button>
      <button type="button" className="primary-button" onClick={() => setEditing("silver")}>Мөнгөн гулдмай бүртгэх</button><button type="button" className="primary-button" onClick={() => setJewelryRegistrationOpen(true)}>Алт, мөнгөн эдлэл</button></div></div>
    {error && <p role="alert" className="login-error">{error}</p>}
    {listMode === "jewelry" ? jewelryLoading ? <WorkspaceLoadingSkeleton /> : <div className="workspace-table-scroll"><table className="workspace-table jewelry-intake-table"><thead><tr><th>Эдлэлийн нэр</th><th>Харилцагч</th><th>Огноо</th><th>Металл</th><th>Халбагын төрөл</th><th>Делта / Титр</th><th>Жингийн ангилал</th><th>Тоо</th><th>Бүртгэсэн ажилтан</th><th className="jewelry-invoice-heading"><span className="sr-only">QPay нэхэмжлэл</span></th></tr></thead><tbody>{jewelryRecords.map((record) => <tr key={record.id}><td>{record.itemName}</td><td>{record.customerName || "-"}</td><td>{intakeDate(record.receivedAt)}</td><td>{record.metal === "gold" ? "Алт" : "Мөнгө"}</td><td>{record.spoonType}</td><td>{record.qualityValue}</td><td>{record.weightBand}</td><td className="jewelry-piece-count">{record.pieceCount}</td><td>{record.receivedByName}</td><td className="jewelry-invoice-cell"><button type="button" className="secondary-button jewelry-invoice-button" disabled title="QPay нэхэмжлэл удахгүй"><ReceiptText size={18} aria-hidden="true" /><span className="sr-only">QPay нэхэмжлэл</span></button></td></tr>)}</tbody></table>{jewelryRecords.length === 0 && <p>Эдлэлийн бүртгэл олдсонгүй.</p>}</div> : loading ? <WorkspaceLoadingSkeleton /> : <div className="workspace-table-scroll"><table className="workspace-table intake-batch-table"><thead><tr><th><HeaderFilter column="registrationNo" text="Бүртгэл №" /></th><th><HeaderFilter column="customer" text="Харилцагч" /></th><th><HeaderFilter column="receivedAt" text="Огноо" /></th><th><HeaderFilter column="metal" text="Металл" /></th><th><HeaderFilter column="pieceCount" text="Гулдмай" /></th><th><HeaderFilter column="receivedBy" text="Бүртгэсэн ажилтан" /></th><th>Төлөв</th></tr></thead><tbody>{filtered.map((batch) => { const status = intakeWorkflowStatus(batch, sampleRecords); const opening = openingTrackingId === batch.id; return <tr key={batch.id} className="intake-batch-row is-detail" tabIndex={0} onClick={() => setViewing(batch)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewing(batch); } }} aria-label={`${batch.publicId} бүртгэлийн дэлгэрэнгүйг харах`}><td><strong className="registration-number">{batch.publicId}</strong></td><td>{batch.customerName}</td><td>{intakeDate(batch.receivedAt || batch.createdAt)}</td><td>{batch.metal === "gold" ? "Алт" : "Мөнгө"}</td><td>{batch.pieceCount}</td><td>{batch.receivedByName || "-"}</td><td><div className="intake-status-cell"><button type="button" className={`intake-workflow-status is-${status}`} disabled={opening} title="Ажлын явц харах" onClick={(event) => { event.stopPropagation(); void openTracking(batch.id); }} onKeyDown={(event) => event.stopPropagation()}>{opening ? <LoaderCircle className="is-spinning" size={18} aria-label="Ачаалж байна" /> : intakeWorkflowStatusLabel[status]}</button>{manager && <button type="button" className="secondary-button intake-edit-button" aria-label={`${batch.publicId} бүртгэл засах`} title="Бүртгэл засах" onClick={(event) => { event.stopPropagation(); setEditing(batch); }} onKeyDown={(event) => event.stopPropagation()}><Pencil size={17} aria-hidden="true" /></button>}</div></td></tr>; })}</tbody></table>{filtered.length === 0 && <p>Бүртгэл олдсонгүй.</p>}</div>}
    {viewing && <IntakeDialog key={`view-${viewing.id}`} batch={viewing} customers={customers} manager={manager} editable={false} onClose={() => setViewing(null)} onSaved={() => undefined} />}
    {editing && <IntakeDialog key={typeof editing === "string" ? editing : editing.id} batch={typeof editing === "string" ? null : editing} initialMetal={typeof editing === "string" ? editing : editing.metal} customers={customers} manager={manager} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} />}
    {tracking && <AssignmentDialog batch={tracking.batch} samples={tracking.samples} manager={manager} onClose={() => setTracking(null)} onSaved={refreshTracking} />}
    {creatingCustomer && <CreateCustomerDialog onClose={() => setCreatingCustomer(false)} onCreated={(customer) => { setCustomers((current) => [...current, { ...customer, registrationNumber: customer.registrationNumberMasked, province: customer.province ?? null, district: customer.district ?? null, origin: null }]); setCreatingCustomer(false); }} />}
    {jewelryRegistrationOpen && <JewelryRegistrationDialog customers={customers} onClose={() => setJewelryRegistrationOpen(false)} onSaved={(total) => { setJewelryRegistrationOpen(false); setJewelrySaveToast(total); void refreshJewelry(); }} />}
    {dailyChemistScheduleOpen && <DailyChemistScheduleDialog onClose={() => setDailyChemistScheduleOpen(false)} />}
    {jewelrySaveToast !== null && <div className="workspace-toast workspace-toast-success" role="status" aria-live="polite"><BadgeCheck size={20} aria-hidden="true" /><span><strong>Эдлэлийн бүртгэл хадгалагдлаа</strong><small>Нийт төлбөр: {jewelrySaveToast.toLocaleString()} ₮</small></span><button type="button" onClick={() => setJewelrySaveToast(null)} aria-label="Мэдэгдлийг хаах"><X size={18} aria-hidden="true" /></button></div>}
  </section>;
}

function JewelryRegistrationDialog({ customers, onClose, onSaved }: { customers: CustomerOption[]; onClose(): void; onSaved(total: number): void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [catalogue, setCatalogue] = useState<JewelryCatalogueItem[]>(fallbackJewelryCatalogue);
  const [receivedAt, setReceivedAt] = useState(centerToday);
  const [customerId, setCustomerId] = useState("");
  const [catalogueName, setCatalogueName] = useState("");
  const [weightBand, setWeightBand] = useState("");
  const [totalWeightGrams, setTotalWeightGrams] = useState("");
  const [count, setCount] = useState("1");
  const [markingService, setMarkingService] = useState<CreateJewelryIntakeInput["markingService"]>("none");
  const [qualityValue, setQualityValue] = useState("");
  const [priceRules, setPriceRules] = useState<JewelryServicePriceRule[]>(fallbackJewelryPriceRules);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ data: JewelryCatalogueItem[] }>("/api/v1/bullion/jewelry-catalogue", { cache: "no-store" })
      .then((result) => { if (active && result.data.length) setCatalogue(result.data); })
      .catch(() => undefined);
    void api<{ data: JewelryServicePriceRule[] }>("/api/v1/bullion/jewelry-price-rules", { cache: "no-store" })
      .then((result) => { if (active && result.data.length) setPriceRules(result.data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  const item = catalogue.find((candidate) => candidate.name === catalogueName);
  const metalLabel = item?.metal === "gold" ? "Алт" : item?.metal === "silver" ? "Мөнгө" : "";
  const qualityLabel = item?.metal === "silver" ? "Титр" : "Делта";
  const submittedCount = Number(count);
  const submittedTotalWeight = Number(totalWeightGrams);
  const serviceCode = item?.metal === "gold" ? "gold_jewelry_analysis" : "silver_jewelry_analysis";
  const matchedPriceRule = item && priceRules.find((rule) => rule.serviceCode === serviceCode && (rule.minWeightGrams === null || submittedTotalWeight >= rule.minWeightGrams) && (rule.maxWeightGrams === null || submittedTotalWeight <= rule.maxWeightGrams));
  const analysisPrice = matchedPriceRule?.priceMnt ?? 0;
  const hallmarkPrice = item ? priceRules.find((rule) => rule.serviceCode === `${item.metal}_hallmark`)?.priceMnt ?? 0 : 0;
  const laserPrice = item ? priceRules.find((rule) => rule.serviceCode === `${item.metal}_laser`)?.priceMnt ?? 0 : 0;
  const markingFee = submittedCount * ((markingService === "hallmark" || markingService === "both" ? hallmarkPrice : 0) + (markingService === "laser" || markingService === "both" ? laserPrice : 0));
  const calculatedServicePrice = analysisPrice + markingFee;
  const ready = customerId && item && receivedAt && weightBand && Number.isFinite(submittedTotalWeight) && submittedTotalWeight > 0 && Number.isInteger(submittedCount) && submittedCount > 0 && qualityValue.trim() !== "";
  function continueToSummary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerId) { setError("Харилцагч байгууллагыг жагсаалтаас сонгоно уу."); return; }
    if (!ready) { setError("Бүх шаардлагатай мэдээллийг оруулна уу."); return; }
    setError(""); setStep(2);
  }
  async function save() {
    if (!item || !ready) return;
    setSaving(true); setError("");
    const input: CreateJewelryIntakeInput = {
      customerId, receivedAt, itemName: item.name, metal: item.metal, spoonType: item.spoonType,
      qualityKind: item.metal === "gold" ? "delta" : "titer", qualityValue: Number(qualityValue), weightBand, totalWeightGrams: submittedTotalWeight, pieceCount: submittedCount, markingService,
    };
    try {
      await api("/api/v1/bullion/jewelry-intakes", { method: "POST", body: JSON.stringify(input) });
      onSaved(calculatedServicePrice);
    } catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  return <WorkspaceDialog title="Алт, мөнгөн эдлэл бүртгэх" onClose={() => { if (!saving) onClose(); }}>
    <div className="jewelry-stepper" aria-label="Бүртгэлийн алхам">
      <span className={step === 1 ? "is-current" : "is-complete"}><b>1</b>Бүртгэл</span>
      <span className={step === 2 ? "is-current" : ""}><b>2</b>Шинжилгээнд авсан мэдээлэл</span>
    </div>
    {step === 1 ? <form className="workspace-form jewelry-registration-form" onSubmit={continueToSummary}>
      <div className="workspace-form-grid jewelry-form-grid">
        <label>Огноо<CalendarDateInput name="jewelry-date" value={receivedAt} onChange={setReceivedAt} /></label>
        <label>Харилцагч байгууллага<CustomerCombobox inputId="jewelry-customer" customers={customers} value={customerId} onChange={(customer) => setCustomerId(customer?.id ?? "")} /></label>
        <label>Эдлэлийн нэр<select value={catalogueName} onChange={(event) => { const next = catalogue.find((candidate) => candidate.name === event.target.value); setCatalogueName(event.target.value); setQualityValue(next?.metal === "gold" ? "-0.03125" : next ? "5555.00" : ""); }} required><option value="">Сонгох</option>{catalogue.map((candidate) => <option key={candidate.name} value={candidate.name}>{candidate.name}</option>)}</select></label>
        <label>Металл<input className="intake-auto-number" readOnly value={metalLabel} placeholder="Эдлэлийн нэр сонгоно уу" /></label>
        <label>Халбагын төрөл<input className="intake-auto-number" readOnly value={item?.spoonType ?? ""} placeholder="Эдлэлийн нэр сонгоно уу" /></label>
        <label>{qualityLabel}<input type="number" inputMode="decimal" step="any" value={qualityValue} disabled={!item} placeholder={item?.metal === "silver" ? "Титр оруулна уу" : "Делта оруулна уу"} onChange={(event) => setQualityValue(event.target.value)} required /></label>
        <label>Жингийн ангилал<select value={weightBand} onChange={(event) => setWeightBand(event.target.value)} required><option value="">Сонгох</option>{jewelryWeightBands.map((band) => <option key={band} value={band}>{band}</option>)}</select></label>
        <label>Нийт жин /гр/<input type="number" min="0.001" step="0.001" inputMode="decimal" value={totalWeightGrams} onChange={(event) => setTotalWeightGrams(event.target.value)} required /></label>
        <label>Тоо ширхэг<input type="number" min="1" step="1" value={count} onChange={(event) => setCount(event.target.value)} required /></label>
        <label>Баталгааны тэмдэг<select value={markingService} onChange={(event) => setMarkingService(event.target.value as CreateJewelryIntakeInput["markingService"])}><option value="none">Хийлгэхгүй</option><option value="hallmark">Клейм</option><option value="laser">Лазер</option><option value="both">Клейм + Лазер</option></select></label>
      </div>
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="workspace-toolbar intake-form-actions"><button className="primary-button" type="submit">Дараах</button></div>
    </form> : <section className="jewelry-summary-step">
      <div className="jewelry-summary-copy"><strong>{item?.name}</strong><span>{metalLabel} · {weightBand} · {submittedTotalWeight.toLocaleString()} гр · {submittedCount} ширхэг</span></div>
      <div className="workspace-table-scroll"><table className="workspace-table jewelry-summary-table"><thead><tr><th>Үзүүлэлт</th><th>Алт</th><th>Мөнгө</th></tr></thead><tbody><tr><th scope="row">{jewelryWeightBands.indexOf(weightBand) + 1}. {weightBand}</th><td>{item?.metal === "gold" ? submittedCount : 0}</td><td>{item?.metal === "silver" ? submittedCount : 0}</td></tr></tbody><tfoot><tr><th>Бүгд</th><td>{item?.metal === "gold" ? submittedCount : 0}</td><td>{item?.metal === "silver" ? submittedCount : 0}</td></tr></tfoot></table></div>
      <div className="jewelry-price-summary"><span>Шинжилгээний үйлчилгээний үнэ</span><strong>{analysisPrice.toLocaleString()} ₮</strong>{markingService !== "none" && <><span>Баталгааны тэмдэг ({submittedCount} ширхэг)</span><strong>{markingFee.toLocaleString()} ₮</strong></>}<b>Нийт төлбөр</b><strong>{calculatedServicePrice.toLocaleString()} ₮</strong></div>
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="workspace-toolbar intake-form-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setStep(1)}>Буцах</button><button className="primary-button" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Хадгалж байна..." : "Хадгалах"}</button></div>
    </section>}
  </WorkspaceDialog>;
}

export function DailyChemistScheduleDialog({ onClose }: { onClose(): void }) {
  const [date, setDate] = useState(centerToday);
  const [schedule, setSchedule] = useState<DailyChemistSchedule | null>(null);
  const [goldChemistIds, setGoldChemistIds] = useState<string[]>([]);
  const [silverChemistIds, setSilverChemistIds] = useState<string[]>([]);
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
        setSchedule(data); setGoldChemistIds(data.goldChemistIds); setSilverChemistIds(data.silverChemistIds);
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
        setGoldChemistIds((current) => current.filter((id) => id !== chemistId));
        setSilverChemistIds((current) => current.filter((id) => id !== chemistId));
      }
      return next;
    });
  };
  const toggleChemist = (chemistId: string, metal: "gold" | "silver") => {
    const update = metal === "gold" ? setGoldChemistIds : setSilverChemistIds;
    update((current) => current.includes(chemistId) ? current.filter((id) => id !== chemistId) : [...current, chemistId]);
  };
  const eligible = schedule?.chemists.filter((chemist) => chemist.status === "active" && !vacationChemistIds.includes(chemist.id)) ?? [];
  async function save() {
    setSaving(true); setError("");
    try {
      await api("/api/v1/bullion/intakes/daily-chemist-assignment", { method: "PUT", body: JSON.stringify({ date, goldChemistIds, silverChemistIds, vacationChemistIds }) });
      onClose();
    } catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  return <WorkspaceDialog title="Химичийн өнөөдрийн хуваарь" onClose={() => { if (!saving) onClose(); }}>
    <div className="daily-chemist-schedule">
      <div className="daily-chemist-date"><span>Огноо:</span><CalendarDateInput name="daily-chemist-date" value={date} disabled={saving} onChange={setDate} /></div>
      {loading ? <WorkspaceLoadingSkeleton rows={3} /> : <>
        <div className="daily-chemist-panels">
          <div className="daily-chemist-defaults">
            <fieldset><legend>Алтан гулдмай</legend>{eligible.map((chemist) => <label key={chemist.id}><input type="checkbox" checked={goldChemistIds.includes(chemist.id)} disabled={saving} onChange={() => toggleChemist(chemist.id, "gold")} />{chemist.fullName}</label>)}{!eligible.length && <span>Сонгох боломжтой химич алга байна.</span>}</fieldset>
            <fieldset><legend>Мөнгөн гулдмай</legend>{eligible.map((chemist) => <label key={chemist.id}><input type="checkbox" checked={silverChemistIds.includes(chemist.id)} disabled={saving} onChange={() => toggleChemist(chemist.id, "silver")} />{chemist.fullName}</label>)}{!eligible.length && <span>Сонгох боломжтой химич алга байна.</span>}</fieldset>
          </div>
          <fieldset className="daily-chemist-roster" role="list" aria-label="Амралттай химичид">
            <legend>Амралттай химичид</legend>
            {schedule?.chemists.map((chemist) => <label key={chemist.id} className={vacationChemistIds.includes(chemist.id) ? "is-on-vacation" : ""}>
              <span><strong>{chemist.fullName}</strong><small>{chemist.status === "active" ? "Идэвхтэй" : "Идэвхгүй"}</small></span>
              <span className="daily-chemist-vacation"><input type="checkbox" checked={vacationChemistIds.includes(chemist.id)} disabled={saving || chemist.status !== "active"} onChange={() => toggleVacation(chemist.id)} />Амралттай</span>
            </label>)}
            {!schedule?.chemists.length && <p>Бүртгэлтэй химич алга байна.</p>}
          </fieldset>
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
          revisionNo: samples.find((sample) => sample.id === item.id)?.revisionNo ?? 0,
          status: samples.find((sample) => sample.id === item.id)?.status ?? "pending", examination: null,
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
  const signed = hasAllSamples && matchedSamples.every((sample) => sample.certificateSignatureStatus === "signed" || sample.certificateSignatureStatus === "cryptographically_verified");
  const handoffComplete = batch.status === "sample_taken";
  const currentStep = signed ? 5 : allApproved ? 5 : allSubmitted ? 4 : handoffComplete ? 3 : 2;
  const steps = [
    { title: "Бүртгэл", detail: "Металл хүлээн авсан", icon: PackageCheck, state: "complete" },
    { title: "Дээж авах", detail: "Химичид хуваарилсан", icon: ClipboardCheck, state: handoffComplete ? "complete" : currentStep === 2 ? "current" : "pending" },
    { title: "Шинжилгээ", detail: "Химич дүн илгээх", icon: FlaskConical, state: allSubmitted ? "complete" : currentStep === 3 ? "current" : "pending" },
    { title: "Лабораторын эрхлэгчийн хяналт", detail: "Химичийн дүнг батлах", icon: BadgeCheck, state: allApproved ? "complete" : currentStep === 4 ? "current" : "pending" },
    { title: "Тоон гарын үсэг", detail: "Лабораторын эрхлэгч eSign зурж, Монголбанкинд илгээх", icon: BadgeCheck, state: signed ? "complete" : currentStep === 5 ? "current" : "pending" },
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

export function IntakeDialog({ batch, initialMetal = "gold", customers, manager, editable = true, onClose, onSaved }: {
  batch: BullionIntakeBatchRecord | null; initialMetal?: "gold" | "silver"; customers: CustomerOption[]; manager: boolean; editable?: boolean;
  onClose(): void; onSaved(): void;
}) {
  const [rows, setRows] = useState<WeightRow[]>(batch ? batch.items.map((item) => ({ id: item.id, bullionNo: item.bullionNo ?? "", before: String(item.grossWeightBeforeGrams), after: item.grossWeightAfterGrams == null ? "" : String(item.grossWeightAfterGrams), slag: item.slagWeightGrams == null ? "" : String(item.slagWeightGrams), sample: item.sampleWeightMilligrams == null ? "" : String(item.sampleWeightMilligrams) })) : [newRow()]);
  const [quantity, setQuantity] = useState(() => String(batch?.items.length ?? 1));
  const [customerId, setCustomerId] = useState(batch?.customerId || "");
  const [initialBullionNumber, setInitialBullionNumber] = useState(batch?.initialBullionNumber ?? "");
  const [location, setLocation] = useState({ province: batch?.province ?? "", district: batch?.district ?? "", origin: batch?.dispatchReference ?? "" });
  const metal = batch?.metal ?? initialMetal;
  const [sequence, setSequence] = useState<{ customerId: string; nextNumber: string; nextActNumber: string; nextAnalysisNumber: string; prefix: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitItemIds, setSplitItemIds] = useState<string[]>([]);
  const [splitConfirmationOpen, setSplitConfirmationOpen] = useState(false);
  const [error, setError] = useState("");
  const locked = !!batch && (!editable || (!manager && batch.status !== "draft"));
  const canSplit = !!batch && manager && editable && batch.metal === "gold" && rows.length > 1;
  const busy = saving || splitting;
  const selectedSplitRows = rows.filter((row) => splitItemIds.includes(row.id));
  const meltingComplete = rows.every((row) => row.after.trim() !== "" && Number.isFinite(Number(row.after))
    && Number(row.after) > 0 && Number(row.after) <= Number(row.before));
  const sampleComplete = !manager || rows.every((row) => row.sample.trim() !== "" && Number.isFinite(Number(row.sample)) && Number(row.sample) > 0);
  const startNumber = batch?.initialBullionNumber || (sequence?.customerId === customerId ? sequence.nextNumber : "");
  const previewAnalysisNumber = (index: number) => {
    const start = sequence?.customerId === customerId ? Number(sequence.nextAnalysisNumber) : Number.NaN;
    return Number.isInteger(start) && start > 0 ? examinationNumber(String(start + index)) : "";
  };
  useEffect(() => {
    if (batch || !customerId) return;
    let active = true;
    void api<{ nextNumber: string; nextActNumber: string; nextAnalysisNumber: string; prefix: string }>(`/api/v1/bullion/intakes/next-number?customerId=${encodeURIComponent(customerId)}`)
      .then((result) => { if (active) { setSequence({ customerId, nextNumber: result.nextNumber, nextActNumber: result.nextActNumber, nextAnalysisNumber: result.nextAnalysisNumber, prefix: result.prefix ?? "" }); setError(""); } })
      .catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [batch, customerId]);
  function changeQuantity(value: string) {
    setQuantity(value);
    if (value === "") return;
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > 100) return;
    if (count < rows.length && rows.slice(count).some((row) => row.before || row.after || row.slag || row.sample)) {
      setError("Жин оруулсан мөрийг Хасах товчоор хасна уу."); setQuantity(String(rows.length)); return;
    }
    setRows((current) => count > current.length ? [...current, ...Array.from({ length: count - current.length }, newRow)] : current.slice(0, count));
  }
  function normalizeQuantity() {
    const count = Number(quantity);
    if (!Number.isInteger(count) || count < 1 || count > 100) setQuantity(String(rows.length));
  }
  function update(index: number, field: keyof WeightRow, value: string) { setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row)); }
  function updateInitialBullionNumber(value: string) {
    setInitialBullionNumber(value);
    if (!/^\d+$/.test(value)) return;
    setRows((current) => current.map((row, index) => ({ ...row, bullionNo: bullionNumber(value, index) })));
  }
  function toggleSplitItem(id: string, checked: boolean) {
    setSplitItemIds((current) => checked ? [...current, id] : current.filter((itemId) => itemId !== id));
  }
  function requestSplit() {
    if (!batch || !canSplit || !splitItemIds.length || splitItemIds.length >= rows.length) return;
    setSplitConfirmationOpen(true);
  }
  async function splitSelectedBullion() {
    if (!batch || !canSplit || !splitItemIds.length || splitItemIds.length >= rows.length) return;
    setSplitting(true); setError("");
    try {
      await api(`/api/v1/bullion/intakes/${batch.id}/split`, { method: "POST", body: JSON.stringify({ itemIds: splitItemIds }) });
      onSaved();
    } catch (error) { setError((error as Error).message); } finally { setSplitting(false); }
  }
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
        await api(`/api/v1/bullion/intakes/${batch.id}`, { method: "PATCH", body: JSON.stringify({ status, ...(manager ? { initialBullionNumber, } : {}), items: rows.map((row) => ({ id: row.id, grossWeightAfterGrams: optional(row.after), slagWeightGrams: optional(row.slag), ...(manager ? { bullionNo: row.bullionNo.trim(), grossWeightBeforeGrams: Number(row.before), sampleWeightMilligrams: optional(row.sample) } : {}) })) }) });
      } else {
        const input: CreateBullionIntakeInput = { customerId, metal: metal === "silver" ? "silver" : "gold", receivedAt: String(form.get("receivedAt")), branchName: String(form.get("branchName") || ""), province: String(form.get("province") || ""), district: String(form.get("district") || ""), dispatchReference: String(form.get("origin") || ""), actDate: String(form.get("receivedAt")), delta: metal === "silver" ? 0 : Number(form.get("delta")), silverTiter: metal === "silver" ? Number(form.get("silverTiter")) : undefined, status,
          items: rows.map((row) => ({ bullionNo: row.bullionNo.trim(), grossWeightBeforeGrams: Number(row.before), grossWeightAfterGrams: optional(row.after), slagWeightGrams: optional(row.slag), ...(manager ? { sampleWeightMilligrams: optional(row.sample) } : {}) })) };
        await api("/api/v1/bullion/intakes", { method: "POST", body: JSON.stringify(input) });
      }
      onSaved();
    } catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  return <WorkspaceDialog title={metal === "silver" ? "Мөнгөн гулдмайн дээж авах" : "Алтан гулдмайн дээж авах"} onClose={() => { if (!busy && !splitConfirmationOpen) onClose(); }} headerActions={batch ? <span className="intake-registration-summary">{batch.wasEdited && <span className="intake-registration-edited" title="Засварлагдсан" aria-label="Засварлагдсан"><PencilLine size={15} aria-hidden="true" /></span>}<span className="intake-registration-person">Бүртгэсэн: {batch.receivedByName || "-"}</span><time>{assignmentDate(batch.createdAt)}</time></span> : undefined}>
    <form onSubmit={submit} className="workspace-form"><fieldset disabled={busy || locked}>
      {!batch && <div className="workspace-form-grid">
        <label htmlFor="intake-date">Огноо<CalendarDateInput id="intake-date" name="receivedAt" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label htmlFor="intake-customer">Харилцагч байгууллага<CustomerCombobox inputId="intake-customer" customers={customers} value={customerId} onChange={(customer) => { const nextCustomerId = customer?.id ?? ""; if (nextCustomerId !== customerId) setSequence(null); setCustomerId(nextCustomerId); setLocation({ province: customer?.province ?? "", district: customer?.district ?? "", origin: customer?.origin ?? "" }); }} /></label>
        <label>Гулдмайн эхлэх дугаар<input className="intake-auto-number" readOnly aria-readonly="true" value={startNumber} placeholder={customerId && !startNumber ? "Ачаалж байна..." : ""} /></label>
        <div className="intake-secondary-fields"><label>Салбар байгууллага<input name="branchName" maxLength={255} /></label><label>Тоо ширхэг<input type="number" min="1" max="100" step="1" value={quantity} onChange={(event) => changeQuantity(event.target.value)} onBlur={normalizeQuantity} /></label>{metal === "silver" ? <label>Титр<input className="intake-auto-number" name="silverTiter" type="number" step="0.01" readOnly aria-readonly="true" defaultValue="5555.00" required /></label> : <label>Делта<input className="intake-auto-number" name="delta" type="number" step="0.000001" readOnly aria-readonly="true" defaultValue="-0.03125" required /></label>}</div>
        <div className="intake-location-fields"><label>Аймаг, хот<input name="province" maxLength={120} value={location.province} onChange={(event) => setLocation((current) => ({ ...current, province: event.target.value }))} /></label><label>Сум, дүүрэг<input name="district" maxLength={120} value={location.district} onChange={(event) => setLocation((current) => ({ ...current, district: event.target.value }))} /></label><label>Гарал, үүсэл<input name="origin" maxLength={120} value={location.origin} onChange={(event) => setLocation((current) => ({ ...current, origin: event.target.value }))} /></label></div>
      </div>}
      {batch && <div className="workspace-form-grid intake-existing-summary"><label>Харилцагч байгууллага<input readOnly value={batch.customerName} /></label><label>Актын №<input className="intake-auto-number" readOnly aria-readonly="true" value={batch.actNumber || "-"} /></label><label>Гулдмайн эхлэх дугаар<input className={manager && editable ? undefined : "intake-auto-number"} readOnly={!manager || !editable} aria-readonly={!manager || !editable} inputMode="numeric" maxLength={12} value={manager && editable ? initialBullionNumber : batch.initialBullionNumber || "-"} onChange={(event) => updateInitialBullionNumber(event.target.value)} /></label><label>Тоо ширхэг<input readOnly value={rows.length} /></label></div>}
      <div className="workspace-table-scroll"><table className="workspace-table weight-table"><thead><tr>{canSplit && <th rowSpan={2} className="weight-row-split">Тусгаарлах</th>}<th rowSpan={2}>Шинжилгээний №</th><th rowSpan={2}>Гулдмайн №</th><th colSpan={2}>Хайлалтын жин /гр/</th><th rowSpan={2}>Шлак /гр/</th><th rowSpan={2}>Хорогдол /гр/</th>{manager && <th rowSpan={2}>Дээжийн жин /мг/</th>}{!batch && <th rowSpan={2}>Үйлдэл</th>}</tr><tr><th>Өмнөх</th><th>Дараах</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>
        {canSplit && <td className="weight-row-split"><input type="checkbox" aria-label={`${index + 1}-р гулдмайг тусгаарлах`} checked={splitItemIds.includes(row.id)} onChange={(event) => toggleSplitItem(row.id, event.target.checked)} /></td>}
        <td><input className="intake-auto-number" aria-label={`Шинжилгээ ${index + 1} дугаар`} readOnly aria-readonly="true" value={batch?.items[index]?.analysisNo || previewAnalysisNumber(index)} placeholder={customerId ? "Ачаалж байна..." : ""} /></td>
        <td><input className="intake-auto-number" aria-label={`Гулдмай ${index + 1} дугаар`} readOnly aria-readonly="true" value={batch ? row.bullionNo : bullionNumber(startNumber, index)} /></td>
        {(["before", "after"] as const).map((field) => <td key={field}><FormattedNumberInput aria-label={`${index + 1} ${field}`} min="0.0001" max={field === "after" && row.before ? Number(row.before) : undefined} required={field === "before"} readOnly={!editable || (field === "before" && !!batch && !manager)} value={row[field] || ""} onValueChange={(value) => update(index, field, value)} /></td>)}
        <td><input aria-label={`${index + 1} Шлак`} type="number" min="0" max={row.before && row.after ? Math.max(0, Number(row.before) - Number(row.after)) : undefined} step="0.0001" value={row.slag} onChange={(event) => update(index, "slag", event.target.value)} /></td>
        <td><input aria-label={`${index + 1} Хорогдол`} type="number" readOnly data-calculated value={lossValue(row)} /></td>
        {manager && <td><FormattedNumberInput aria-label={`${index + 1} sample`} min="0.0001" required value={row.sample || ""} onValueChange={(value) => update(index, "sample", value)} /></td>}
        {!batch && <td className="weight-row-action"><div className="weight-row-actions">{index === rows.length - 1 && <button type="button" className="weight-row-icon-button" aria-label="Гулдмай нэмэх" title="Гулдмай нэмэх" disabled={rows.length >= 100} onClick={() => { setRows((current) => [...current, newRow()]); setQuantity(String(rows.length + 1)); }}><Plus aria-hidden="true" size={18} /></button>}{index > 0 && <button type="button" className="weight-row-icon-button weight-row-remove-button" aria-label="Гулдмай хасах" title="Гулдмай хасах" onClick={() => { setRows((current) => current.filter((_, rowIndex) => rowIndex !== index)); setQuantity(String(rows.length - 1)); }}><Minus aria-hidden="true" size={18} /></button>}</div></td>}
      </tr>)}</tbody></table></div>
      {!locked && <div className="workspace-toolbar intake-form-actions">{canSplit && <button className="secondary-button intake-split-button" type="button" disabled={!splitItemIds.length || splitItemIds.length >= rows.length} onClick={requestSplit}>Тусгаарлах</button>}<button className="primary-button" type="submit" value="draft" disabled={!batch && !startNumber}>Хадгалах</button>
        {!manager && <button className="secondary-button" type="submit" value="ready_for_sampling" disabled={(!batch && !startNumber) || !meltingComplete}>Эрхлэгчид илгээх</button>}
        {manager && <button className="secondary-button" type="submit" value="sample_taken" disabled={(!batch && !startNumber) || !meltingComplete || !sampleComplete}>Шинжилгээнд илгээх</button>}</div>}
    </fieldset>{error && <p className="login-error" role="alert">{error}</p>}</form>
    {splitConfirmationOpen && <div className="intake-split-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="intake-split-confirmation-title"><section className="intake-split-confirmation-panel"><h3 id="intake-split-confirmation-title">Гулдмай тусгаарлах</h3><p>Сонгосон гулдмайд шинэ акт болон гулдмайн дугаар үүснэ. Шинжилгээний дугаар, шинжилгээний түүх хэвээр үлдэнэ.</p><ul>{selectedSplitRows.map((row, index) => <li key={row.id}><strong>Гулдмай № {row.bullionNo}</strong><span>Шинжилгээний № {examinationNumber(batch?.items.find((item) => item.id === row.id)?.analysisNo || String(index + 1))}</span></li>)}</ul><div className="intake-split-confirmation-actions"><button type="button" className="secondary-button" disabled={splitting} onClick={() => setSplitConfirmationOpen(false)}>Болих</button><button type="button" className="primary-button" disabled={splitting} onClick={() => void splitSelectedBullion()}>{splitting ? "Тусгаарлаж байна..." : "Тусгаарлах"}</button></div></section></div>}
  </WorkspaceDialog>;
}
