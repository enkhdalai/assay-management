"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Eye, Pencil, Plus, RefreshCw } from "lucide-react";
import { organizationTypeLabels, type OrganizationConnections, type OrganizationRecord } from "../../../../packages/shared/src/organization-types";
import { WorkspaceDialog } from "../OperationalWorkspace";
import { api } from "./api";
import { WorkspaceLoadingSkeleton } from "./WorkspaceLoadingSkeleton";

export function OrganizationsWorkspace() {
  const [records, setRecords] = useState<OrganizationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<OrganizationRecord | null | undefined>(undefined);
  const [selected, setSelected] = useState<OrganizationRecord | null>(null);
  const refresh = useCallback(() => api<{ data: OrganizationRecord[] }>("/api/v1/organizations")
    .then(({ data }) => { setRecords(data); setError(""); })
    .catch(error => setError(error.message)).finally(() => setLoading(false)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const filtered = records.filter(record => `${record.name} ${record.code}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="workspace-section">
    <div className="workspace-toolbar">
      <input aria-label="Байгууллага хайх" placeholder="Байгууллага хайх" value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" className="secondary-button" title="Шинэчлэх" aria-label="Шинэчлэх" disabled={loading} onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={18} /></button>
      <button type="button" className="primary-button" title="Байгууллага нэмэх" aria-label="Байгууллага нэмэх" onClick={() => setEditing(null)}><Plus size={18} /></button>
    </div>
    {error && <p role="alert" className="login-error">{error}</p>}
    {loading ? <WorkspaceLoadingSkeleton /> : <div className="workspace-table-scroll"><table className="workspace-table">
      <thead><tr><th>№</th><th>Нэр</th><th>Код</th><th>Төрөл</th><th>Төлөв</th><th aria-label="Үйлдэл" /></tr></thead>
      <tbody>{filtered.map((record, index) => <tr key={record.id} className="organization-row" tabIndex={0} onClick={() => setSelected(record)} onKeyDown={event => {
        if ((event.key === "Enter" || event.key === " ") && !(event.target instanceof HTMLElement && event.target.closest("button"))) { event.preventDefault(); setSelected(record); }
      }}><td>{index + 1}</td><td>{record.name}</td><td>{record.code}</td><td>{organizationTypeLabels[record.type] ?? record.type}</td><td>{{ active: "Идэвхтэй", suspended: "Түдгэлзсэн", archived: "Архивласан" }[record.status] ?? record.status}</td><td className="organization-actions"><button type="button" className="secondary-button" title="Холболт харах" aria-label={`${record.name} холболт харах`} onClick={event => { event.stopPropagation(); setSelected(record); }}><Eye size={18} /></button><button type="button" className="secondary-button" title="Засах" aria-label={`${record.name} засах`} onClick={event => { event.stopPropagation(); setEditing(record); }}><Pencil size={18} /></button></td></tr>)}</tbody>
    </table>{filtered.length === 0 && <p>Байгууллага олдсонгүй.</p>}</div>}
    {editing !== undefined && <OrganizationDialog record={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void refresh(); }} />}
    {selected && <OrganizationConnectionsDialog record={selected} onClose={() => setSelected(null)} />}
  </section>;
}

function OrganizationConnectionsDialog({ record, onClose }: { record: OrganizationRecord; onClose(): void }) {
  const [data, setData] = useState<OrganizationConnections | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void api<{ data: OrganizationConnections }>(`/api/v1/organizations/${record.id}/connections`).then(({ data }) => setData(data)).catch(error => setError(error.message)); }, [record.id]);
  return <WorkspaceDialog title={`${record.name} · Холболтууд`} onClose={onClose}>
    {error && <p role="alert" className="login-error">{error}</p>}
    {!data && !error ? <WorkspaceLoadingSkeleton rows={3} /> : data && <>
      <dl className="organization-connection-summary"><div><dt>Бүртгэлтэй ажилтан</dt><dd>{data.staff.length}</dd></div><div><dt>Харилцагч</dt><dd>{data.customers.length}</dd></div></dl>
      <h3>Бүртгэлтэй ажилтнууд</h3><div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Нэр</th><th>Имэйл</th><th>Эрх</th><th>Төлөв</th></tr></thead><tbody>{data.staff.map(staff => <tr key={staff.id}><td>{staff.fullName}</td><td>{staff.email}</td><td>{staff.role}</td><td>{staff.status}</td></tr>)}</tbody></table>{data.staff.length === 0 && <p>Бүртгэлтэй ажилтан алга байна.</p>}</div>
      <h3>Энэ төвийн ажилтнаар бүртгэгдсэн харилцагчид</h3><div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Нэр</th><th>Төрөл</th><th>Дээжийн хүсэлт</th><th>Сүүлд хүлээн авсан</th></tr></thead><tbody>{data.customers.map(customer => <tr key={customer.id}><td>{customer.displayName}</td><td>{customer.type === "individual" ? "Иргэн" : "Байгууллага"}</td><td>{customer.intakeCount}</td><td>{customer.lastReceivedAt?.slice(0, 10) ?? "-"}</td></tr>)}</tbody></table>{data.customers.length === 0 && <p>Энэ төвд бүртгэгдсэн харилцагч алга байна.</p>}</div>
    </>}
  </WorkspaceDialog>;
}

function OrganizationDialog({ record, onClose, onSaved }: { record: OrganizationRecord | null; onClose(): void; onSaved(): void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true); setError("");
    try {
      await api(`/api/v1/organizations${record ? `/${record.id}` : ""}`, { method: record ? "PATCH" : "POST", body: JSON.stringify({ name: form.get("name"), code: form.get("code"), type: form.get("type"), bullionPrefix: form.get("bullionPrefix") === "auto" ? null : form.get("bullionPrefix"), ...(record ? { expectedUpdatedAt: record.updatedAt } : {}) }) });
      onSaved();
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  async function remove() {
    if (!record) return;
    setSaving(true); setError("");
    try { await api(`/api/v1/organizations/${record.id}`, { method: "DELETE" }); onSaved(); }
    catch (error) { setConfirmDelete(false); setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <WorkspaceDialog title={record ? "Байгууллага засах" : "Байгууллага нэмэх"} size="compact" onClose={() => { if (!saving) onClose(); }}>
    <form className="login-form" onSubmit={submit}><fieldset disabled={saving} className="organization-fields">
      <label>Нэр<input name="name" required minLength={2} maxLength={255} defaultValue={record?.name ?? ""} /></label>
      <label>Код<input name="code" required pattern="[A-Za-z0-9_-]{2,32}" maxLength={32} defaultValue={record?.code ?? ""} /></label>
      <label>Төрөл<select name="type" aria-label="Төрөл" required defaultValue={record?.type ?? ""}>
        <option value="" disabled>Сонгоно уу</option>
        <option value="private_assay_center">Хувийн сорьцын төв</option><option value="government_assay_center">Төрийн сорьцын төв</option>
        {record && !["private_assay_center", "government_assay_center"].includes(record.type) && <option value={record.type}>{organizationTypeLabels[record.type]}</option>}
      </select></label>
      <label>Гулдмайн бүртгэлийн дугаарлалт<select name="bullionPrefix" aria-label="Гулдмайн бүртгэлийн дугаарлалт" defaultValue={record?.bullionPrefix ?? "auto"}>
        <option value="auto">Төвийн төрлөөр</option><option value="">Төрийн төв · 0001</option>
        <option value="55">Хувийн төв · 550001</option><option value="22">Дархан · 220001</option><option value="27">Баянхонгор · 270001</option>
      </select></label>
    </fieldset>{error && <p role="alert" className="login-error">{error}</p>}
    {confirmDelete && <p className="organization-delete-confirmation" role="alert">Энэ хоосон сорьцын төвийг бүрмөсөн устгах уу? Буцаах боломжгүй.</p>}
    <div className="examination-actions">{record && !confirmDelete && <button type="button" className="danger-button" disabled={saving} onClick={() => setConfirmDelete(true)}>Устгах</button>}{record && confirmDelete && <><button type="button" className="secondary-button" disabled={saving} onClick={() => setConfirmDelete(false)}>Цуцлах</button><button type="button" className="danger-button" disabled={saving} onClick={() => void remove()}>Устгахыг батлах</button></>}<button type="submit" className="primary-button" disabled={saving || confirmDelete}>Хадгалах</button><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Хаах</button></div></form>
  </WorkspaceDialog>;
}
