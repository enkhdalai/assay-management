"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { RefreshCw } from "lucide-react";
import type { BullionIntakeBatchRecord, CreateBullionIntakeInput, CustomerRecord } from "../../../../packages/shared/src";
import { CreateCustomerDialog } from "../CustomerComponents";
import { WorkspaceDialog } from "../OperationalWorkspace";
import { api } from "./api";
import { CalendarDateInput } from "./CalendarDateInput";
import { previewBullionNumber } from "../../../../packages/shared/src/bullion-numbering";
import { WorkspaceLoadingSkeleton } from "./WorkspaceLoadingSkeleton";
import { CustomerCombobox, type IntakeCustomerOption } from "./CustomerCombobox";

type CustomerOption = IntakeCustomerOption;
type WeightRow = { id?: string; bullionNo: string; before: string; after: string; slag: string; sample: string };
const newRow = (): WeightRow => ({ bullionNo: "", before: "", after: "", slag: "", sample: "" });
const optional = (value: string) => value.trim() === "" ? undefined : Number(value);
const slagValue = (row: WeightRow) => row.before.trim() && row.after.trim()
  && Number.isFinite(Number(row.before)) && Number.isFinite(Number(row.after))
  ? String(Number((Number(row.before) - Number(row.after)).toFixed(4))) : "";
const intakeStatus = (status: BullionIntakeBatchRecord["status"]) => status === "sample_taken" ? "Дээж илгээсэн" : status === "ready_for_sampling" ? "Эрхлэгчид илгээсэн" : "Хүлээн авалт / хайлалт";
const examinationNumber = (value?: string) => value ? value.padStart(4, "0") : "-";
const intakeDateFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" });
function intakeDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "-";
  const parts = intakeDateFormatter.formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function IntakeWorkspace({ manager }: { manager: boolean }) {
  const [batches, setBatches] = useState<BullionIntakeBatchRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<BullionIntakeBatchRecord | "gold" | "silver" | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const refresh = useCallback(() => Promise.all([api<{ data: BullionIntakeBatchRecord[] }>("/api/v1/bullion/intakes"), api<{ data: CustomerOption[] }>("/api/v1/customers/lookup")])
    .then(([intakes, lookup]) => { setBatches(intakes.data); setCustomers(lookup.data); setError(""); })
    .catch((error) => setError(error.message)).finally(() => setLoading(false)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const filtered = batches.filter((batch) => `${batch.publicId} ${batch.customerName} ${batch.items.map((item) => item.bullionNo).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  const tracking = batches.find((batch) => batch.id === trackingId);
  return <section className="workspace-section">
    <div className="workspace-toolbar"><input aria-label="Бүртгэл хайх" placeholder="Дугаар, харилцагчаар хайх" value={search} onChange={(event) => setSearch(event.target.value)} />
      <button type="button" className="secondary-button intake-refresh-button" aria-label="Шинэчлэх" title="Шинэчлэх" disabled={loading} onClick={refresh}><RefreshCw size={20} aria-hidden="true" /></button>
      <button type="button" className="primary-button" onClick={() => setEditing("gold")}>Алтан гулдмай бүртгэх</button>
      <button type="button" className="primary-button" onClick={() => setEditing("silver")}>Мөнгөн гулдмай бүртгэх</button></div>
    {error && <p role="alert" className="login-error">{error}</p>}
    {loading ? <WorkspaceLoadingSkeleton /> : <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Бүртгэл №</th><th>Харилцагч</th><th>Огноо</th><th>Металл</th><th>Гулдмай</th><th>Бүртгэсэн ажилтан</th><th>Төлөв</th></tr></thead><tbody>{filtered.map((batch) => <tr key={batch.id}><td><button className="workspace-link registration-number-button" onClick={() => setEditing(batch)} type="button">{batch.publicId}</button></td><td>{batch.customerName}</td><td>{intakeDate(batch.receivedAt || batch.createdAt)}</td><td>{batch.metal === "gold" ? "Алт" : "Мөнгө"}</td><td>{batch.pieceCount}</td><td>{batch.receivedByName || "-"}</td><td><button type="button" className="secondary-button intake-status-button" onClick={() => setTrackingId(batch.id)}>{intakeStatus(batch.status)}</button></td></tr>)}</tbody></table>{filtered.length === 0 && <p>Бүртгэл олдсонгүй.</p>}</div>}
    {editing && <IntakeDialog key={typeof editing === "string" ? editing : editing.id} batch={typeof editing === "string" ? null : editing} initialMetal={typeof editing === "string" ? editing : editing.metal} customers={customers} manager={manager} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh(); }} onCustomer={(customer) => setCustomers((current) => [...current, customer])} />}
    {tracking && <AssignmentDialog batch={tracking} onClose={() => setTrackingId(null)} />}
  </section>;
}

function AssignmentDialog({ batch, onClose }: { batch: BullionIntakeBatchRecord; onClose(): void }) {
  return <WorkspaceDialog title={`${batch.publicId} · Дээжийн хуваарилалт`} onClose={onClose}>
    <p>{intakeStatus(batch.status)}</p>
    <div className="workspace-table-scroll"><table className="workspace-table">
      <thead><tr><th>Гулдмайн №</th><th>Шинжилгээний №</th><th>Хариуцсан химич</th><th>Хуваарилсан огноо</th></tr></thead>
      <tbody>{batch.items.map((item) => <tr key={item.id}><td>{item.bullionNo}</td><td>{examinationNumber(item.analysisNo)}</td>
        <td>{item.assignedChemistName || (batch.status === "sample_taken" ? "Химич хуваарилаагүй" : batch.status === "ready_for_sampling" ? "Лабораторийн эрхлэгч хүлээн авна" : "Хайлалт хүлээгдэж байна")}</td>
        <td>{item.assignedAt ? new Date(item.assignedAt).toLocaleString("mn-MN") : "-"}</td></tr>)}</tbody>
    </table></div>
  </WorkspaceDialog>;
}

export function IntakeDialog({ batch, initialMetal = "gold", customers, manager, onClose, onSaved, onCustomer }: {
  batch: BullionIntakeBatchRecord | null; initialMetal?: "gold" | "silver"; customers: CustomerOption[]; manager: boolean;
  onClose(): void; onSaved(): void; onCustomer(customer: CustomerOption): void;
}) {
  const [rows, setRows] = useState<WeightRow[]>(batch ? batch.items.map((item) => ({ id: item.id, bullionNo: item.bullionNo, before: String(item.grossWeightBeforeGrams), after: item.grossWeightAfterGrams == null ? "" : String(item.grossWeightAfterGrams), slag: item.slagWeightGrams == null ? "" : String(item.slagWeightGrams), sample: item.sampleWeightMilligrams == null ? "" : String(item.sampleWeightMilligrams) })) : [newRow()]);
  const [customerId, setCustomerId] = useState(batch?.customerId || "");
  const [location, setLocation] = useState({ province: batch?.province ?? "", district: batch?.district ?? "", origin: batch?.dispatchReference ?? "" });
  const metal = batch?.metal ?? initialMetal;
  const [sequence, setSequence] = useState<{ customerId: string; nextNumber: string; prefix: string } | null>(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const locked = !!batch && batch.status !== "draft" && !(manager && batch.status === "ready_for_sampling");
  const meltingComplete = rows.every((row) => row.after.trim() !== "" && Number.isFinite(Number(row.after))
    && Number(row.after) > 0 && Number(row.after) <= Number(row.before));
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
  return <WorkspaceDialog title={metal === "silver" ? "Мөнгөн гулдмайн дээж авах" : "Алтан гулдмайн дээж авах"} onClose={() => { if (!saving) onClose(); }}
    headerActions={!batch && <button className="secondary-button intake-add-customer" type="button" disabled={saving} onClick={() => setCreatingCustomer(true)}>Харилцагч нэмэх</button>}>
    <form onSubmit={submit} className="workspace-form"><fieldset disabled={saving || locked}>
      {!batch && <div className="workspace-form-grid">
        <label htmlFor="intake-date">Огноо<CalendarDateInput id="intake-date" name="receivedAt" defaultValue={new Date().toISOString().slice(0, 10)} /></label>
        <label>Харилцагч байгууллага<CustomerCombobox customers={customers} value={customerId} onChange={(customer) => { setSequence(null); setCustomerId(customer?.id ?? ""); setLocation({ province: customer?.province ?? "", district: customer?.district ?? "", origin: customer?.origin ?? "" }); }} /></label>
        <label>Гулдмайн эхлэх дугаар<input readOnly value={startNumber} placeholder={customerId && !startNumber ? "Ачаалж байна..." : ""} /></label>
        <div className="intake-secondary-fields"><label>Салбар байгууллага<input name="branchName" maxLength={255} /></label><label>Тоо ширхэг<input type="number" min="1" max="100" step="1" value={rows.length} onChange={(event) => changeQuantity(event.target.value)} /></label><label>Делта<input name="delta" type="number" step="0.000001" defaultValue="-0.03125" required /></label></div>
        <div className="intake-location-fields"><label>Аймаг, хот<input name="province" maxLength={120} value={location.province} onChange={(event) => setLocation((current) => ({ ...current, province: event.target.value }))} /></label><label>Сум, дүүрэг<input name="district" maxLength={120} value={location.district} onChange={(event) => setLocation((current) => ({ ...current, district: event.target.value }))} /></label><label>Гарал, үүсэл<input name="origin" maxLength={120} value={location.origin} onChange={(event) => setLocation((current) => ({ ...current, origin: event.target.value }))} /></label></div>
      </div>}
      {batch && <div className="workspace-form-grid"><label>Харилцагч байгууллага<input readOnly value={batch.customerName} /></label><label>Гулдмайн эхлэх дугаар<input readOnly value={startNumber || rows[0]?.bullionNo || ""} /></label><label>Тоо ширхэг<input readOnly value={rows.length} /></label></div>}
      <div className="workspace-table-scroll"><table className="workspace-table weight-table"><thead><tr><th rowSpan={2}>Шинжилгээний №</th><th rowSpan={2}>Гулдмайн №</th><th colSpan={2}>Хайлалтын жин /гр/</th><th rowSpan={2}>Шлак /гр/</th>{manager && <th rowSpan={2}>Дээжийн жин /мг/</th>}{!batch && <th rowSpan={2}>Үйлдэл</th>}</tr><tr><th>Өмнөх</th><th>Дараах</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>
        <td><input aria-label={`Шинжилгээ ${index + 1} дугаар`} readOnly value={batch?.items[index]?.analysisNo || ""} placeholder="Автомат" /></td>
        <td><input aria-label={`Гулдмай ${index + 1} дугаар`} readOnly value={batch ? row.bullionNo : startNumber ? previewBullionNumber(startNumber, sequence?.prefix ?? "", index) : ""} /></td>
        {(["before", "after", "slag", ...(manager ? ["sample"] : [])] as const).map((field) => <td key={field}><input aria-label={`${index + 1} ${field}`} type="number" min={field === "before" || field === "sample" || field === "after" ? "0.0001" : "0"} max={field === "after" && row.before ? Number(row.before) : undefined} step="0.0001" required={field === "before"} readOnly={field === "slag" || (field === "before" && !!batch)} value={field === "slag" ? slagValue(row) : row[field as keyof WeightRow] || ""} onChange={(event) => update(index, field as keyof WeightRow, event.target.value)} /></td>)}
        {!batch && <td className="weight-row-action"><button type="button" className="workspace-link" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Хасах</button></td>}
      </tr>)}</tbody></table></div>
      {!locked && <div className="workspace-toolbar">{!batch && <button type="button" className="secondary-button" disabled={rows.length >= 100} onClick={() => setRows((current) => [...current, newRow()])}>Гулдмай нэмэх</button>}
        <button className="primary-button" type="submit" value="draft" disabled={!batch && !startNumber}>Хадгалах</button>
        {!manager && <button className="secondary-button" type="submit" value="ready_for_sampling" disabled={(!batch && !startNumber) || !meltingComplete}>Эрхлэгчид илгээх</button>}
        {manager && <button className="secondary-button" type="submit" value="sample_taken" disabled={(!batch && !startNumber) || !meltingComplete}>Дээж авах</button>}</div>}
    </fieldset>{error && <p className="login-error" role="alert">{error}</p>}</form>
    {creatingCustomer && <div className="workspace-nested-customer"><CreateCustomerDialog onClose={() => setCreatingCustomer(false)} onCreated={(customer) => {
      const option = { ...customer, registrationNumber: customer.registrationNumberMasked, province: customer.province ?? null, district: customer.district ?? null, origin: null };
      onCustomer(option); setCustomerId(option.id); setLocation({ province: option.province ?? "", district: option.district ?? "", origin: "" }); setCreatingCustomer(false);
    }} /></div>}
  </WorkspaceDialog>;
}
