"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { CreateCustomerInput, CustomerDetail, CustomerRecord } from "../../../packages/shared/src";
import { WorkspaceLoadingSkeleton } from "./workspace/WorkspaceLoadingSkeleton";
import { api } from "./workspace/api";

export function CustomersView({
  customers,
  error,
  isLoading,
  onOpenCreate,
  onRefresh,
}: {
  customers: CustomerRecord[];
  error: string;
  isLoading: boolean;
  onOpenCreate(): void;
  onRefresh(): void;
}) {
  const individuals = customers.filter((customer) => customer.type === "individual").length;
  const legalEntities = customers.filter((customer) => customer.type === "legal_entity").length;
  const totalWeight = customers.reduce((sum, customer) => sum + customer.totalGrossWeightGrams, 0);
  const [typeFilter, setTypeFilter] = useState<CustomerRecord["type"] | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const filteredCustomers = useMemo(
    () =>
      customers.filter((customer) => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        const matchesType = typeFilter === "all" || customer.type === typeFilter;
        const matchesSearch = normalizedQuery.length === 0 || [
          customer.displayName,
          customer.type === "individual" ? "иргэн" : "байгууллага",
          customer.registrationNumberMasked ?? "",
          customer.phoneMasked ?? "",
          customer.emailMasked ?? "",
        ].some((value) => value.toLowerCase().includes(normalizedQuery));

        return matchesType && matchesSearch;
      }),
    [customers, searchQuery, typeFilter],
  );

  return (
    <>
      <section className="settings-summary" aria-label="Харилцагчийн товч үзүүлэлт">
        <article className="stat-card blue">
          <span>Нийт харилцагч</span>
          <strong>{isLoading ? "-" : customers.length}</strong>
        </article>
        <article className="stat-card green">
          <span>Иргэн</span>
          <strong>{isLoading ? "-" : individuals}</strong>
        </article>
        <article className="stat-card amber">
          <span>Байгууллага</span>
          <strong>{isLoading ? "-" : legalEntities}</strong>
        </article>
        <article className="stat-card slate">
          <span>Нийт авчирсан жин</span>
          <strong>{isLoading ? "-" : formatWeight(totalWeight)}</strong>
        </article>
      </section>

      <section className="panel records-main">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Харилцагчийн бүртгэл</p>
            <h2>Харилцагчид</h2>
          </div>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={onRefresh} disabled={isLoading}>
              Шинэчлэх
            </button>
            <button className="primary-button" type="button" onClick={onOpenCreate}>
              Шинэ харилцагч бүртгэх
            </button>
          </div>
        </div>

        <div className="filter-row records-filter">
          <select
            aria-label="Харилцагчийн төрөл"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.currentTarget.value as CustomerRecord["type"] | "all")}
          >
            <option value="all">Бүх төрөл</option>
            <option value="individual">Иргэн</option>
            <option value="legal_entity">Байгууллага</option>
          </select>
          <input
            aria-label="Хайлт"
            placeholder="Нэр, регистрийн masked утгаар хайх"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </div>

        {error ? <p className="login-error">{error}</p> : null}

        <div className="record-table customer-table" role="table" aria-label="Харилцагчид">
          <div className="table-row table-head" role="row">
            <span>Нэр</span>
            <span>Төрөл</span>
            <span>Регистр</span>
            <span>Холбоо барих</span>
            <span>Сорьц</span>
            <span>Нийт жин</span>
            <span>Сүүлд ирсэн</span>
          </div>
          {isLoading ? (
            <WorkspaceLoadingSkeleton />
          ) : customers.length === 0 ? (
            <div className="empty-state">
              <strong>Харилцагч бүртгээгүй байна.</strong>
              <span>Эхний харилцагчийг гараар нэмэх эсвэл шинэ сорьц бүртгэх үед үүсгэнэ.</span>
            </div>
          ) : filteredCustomers.length === 0 ? (
            <div className="empty-state">
              <strong>Илэрц олдсонгүй.</strong>
              <span>Харилцагчийн төрөл эсвэл хайлтын утгаа өөрчлөөд дахин шалгана уу.</span>
            </div>
          ) : (
            filteredCustomers.map((customer) => (
              <div className="table-row customer-record-row" role="row" key={customer.id} tabIndex={0} onClick={() => setSelectedCustomerId(customer.id)} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedCustomerId(customer.id); }
              }}>
                <span className="customer-name">{customer.displayName}</span>
                <span>{customer.type === "individual" ? "Иргэн" : "Байгууллага"}</span>
                <span>{customer.registrationNumberMasked ?? "-"}</span>
                <span>{formatMaskedContact(customer)}</span>
                <span>{customer.totalAssays}</span>
                <span>{formatWeight(customer.totalGrossWeightGrams)}</span>
                <span>{formatDateTime(customer.lastAssayAt)}</span>
              </div>
            ))
          )}
        </div>

        <p className="muted-text records-note">
          Одоогоор регистр, утас, имэйл нь masked байдлаар хадгалагдана. Бүрэн encrypted contact хадгалалт нэмсний дараа засах боломж нээгдэнэ.
        </p>
      </section>
      {selectedCustomerId && <CustomerDetailsDialog customerId={selectedCustomerId} onClose={() => setSelectedCustomerId(null)} onUpdated={onRefresh} />}
    </>
  );
}

function CustomerDetailsDialog({ customerId, onClose, onUpdated }: { customerId: string; onClose(): void; onUpdated(): void }) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ data: CustomerDetail }>(`/api/v1/customers/${customerId}`).then(({ data }) => {
      if (active) { setCustomer(data); setError(""); }
    }).catch((error) => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [customerId]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!customer) return;
    const form = new FormData(event.currentTarget);
    const type = readFormText(form, "type") === "legal_entity" ? "legal_entity" : "individual";
    const payload: CreateCustomerInput = {
      type, displayName: readFormText(form, "displayName"), registrationNumber: readFormText(form, "registrationNumber"),
      email: readFormText(form, "email"), phone: readFormText(form, "phone"), address: readFormText(form, "address"),
      province: readFormText(form, "province"), district: readFormText(form, "district"),
      organizationProfile: profileFromForm(form),
    };
    setSaving(true); setError("");
    try {
      const { data } = await api<{ data: CustomerDetail }>(`/api/v1/customers/${customer.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      setCustomer(data); setEditing(false); onUpdated();
    } catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  return <div className="modal-backdrop" role="presentation"><section className="modal-panel customer-detail-modal" aria-modal="true" role="dialog" aria-labelledby="customer-details-title">
    <div className="modal-header"><div><p className="eyebrow">Харилцагчийн мэдээлэл</p><h2 id="customer-details-title">{customer?.displayName || "Харилцагч"}</h2></div><div className="settings-actions">{customer && !editing && <button className="primary-button" type="button" onClick={() => setEditing(true)}>Засах</button>}<button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Хаах</button></div></div>
    {loading ? <WorkspaceLoadingSkeleton /> : error && !customer ? <p className="login-error" role="alert">{error}</p> : customer && (editing ? <CustomerEditForm customer={customer} error={error} saving={saving} onCancel={() => setEditing(false)} onSubmit={save} /> : <CustomerDetailView customer={customer} />)}
    {!loading && error && customer && !editing && <p className="login-error" role="alert">{error}</p>}
    {!loading && customer && !editing && <div className="form-actions"><button className="secondary-button" type="button" onClick={onClose}>Хаах</button></div>}
  </section></div>;
}

function CustomerDetailView({ customer }: { customer: CustomerDetail }) {
  const profile = customer.organizationProfile ?? {};
  const fields: Array<[string, string | undefined | null]> = [
    ["Харилцагчийн төрөл", customer.type === "individual" ? "Иргэн" : "Байгууллага"], ["Регистр", customer.registrationNumber],
    ["Имэйл", customer.email], ["Утас", customer.phone], ["Хаяг", customer.address], ["Ордын нэр", profile.depositName],
    ["Байгууллагын төрөл", profile.organizationKind], ["Банкны нэр", profile.bankName], ["Банкны данс", profile.bankAccount],
    ["Аймаг, хот", profile.province ?? customer.province], ["Сум, дүүрэг", profile.district ?? customer.district], ["Баг, хороо", profile.bag],
    ["Салбар байгууллага", profile.branchName], ["Гулдмайн эхний дугаар", profile.mineInitialNumber],
    ["Харилцах албан хаагч", profile.contactName], ["Харилцах албан хаагчийн утас", profile.contactPhone], ["Тайлбар", profile.notes],
  ];
  return <div className="customer-detail-grid">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "-"}</dd></div>)}</div>;
}

function CustomerEditForm({ customer, error, saving, onCancel, onSubmit }: { customer: CustomerDetail; error: string; saving: boolean; onCancel(): void; onSubmit(event: FormEvent<HTMLFormElement>): void }) {
  const profile = customer.organizationProfile ?? {};
  return <form className="assay-form" onSubmit={onSubmit}><fieldset disabled={saving}><div className="form-grid">
    <label><span>Харилцагчийн төрөл</span><select name="type" defaultValue={customer.type}><option value="individual">Иргэн</option><option value="legal_entity">Байгууллага</option></select></label>
    <label><span>Нэр</span><input name="displayName" required defaultValue={customer.displayName} /></label>
    <label><span>Регистр / байгууллагын дугаар</span><input name="registrationNumber" defaultValue={customer.registrationNumber ?? ""} /></label>
    <label><span>Имэйл</span><input name="email" type="email" defaultValue={customer.email ?? ""} /></label>
    <label><span>Утас</span><input name="phone" inputMode="tel" defaultValue={customer.phone ?? ""} /></label>
    <label><span>Хаяг / байршил</span><input name="address" defaultValue={customer.address ?? ""} /></label>
    <label><span>Ордын нэр</span><input name="depositName" defaultValue={profile.depositName ?? ""} /></label>
    <label><span>Байгууллагын төрөл</span><input name="organizationKind" defaultValue={profile.organizationKind ?? ""} /></label>
    <label><span>Банкны нэр</span><input name="bankName" defaultValue={profile.bankName ?? ""} /></label>
    <label><span>Банкны данс</span><input name="bankAccount" defaultValue={profile.bankAccount ?? ""} /></label>
    <label><span>Аймаг / хот</span><input name="province" maxLength={120} defaultValue={profile.province ?? customer.province ?? ""} /></label>
    <label><span>Сум / дүүрэг</span><input name="district" maxLength={120} defaultValue={profile.district ?? customer.district ?? ""} /></label>
    <label><span>Баг / хороо</span><input name="bag" defaultValue={profile.bag ?? ""} /></label>
    <label><span>Салбар байгууллага</span><input name="branchName" defaultValue={profile.branchName ?? ""} /></label>
    <label><span>Гулдмайн эхний дугаар</span><input name="mineInitialNumber" defaultValue={profile.mineInitialNumber ?? ""} /></label>
    <label><span>Харилцах албан хаагч</span><input name="contactName" defaultValue={profile.contactName ?? ""} /></label>
    <label><span>Харилцах албан хаагчийн утас</span><input name="contactPhone" inputMode="tel" defaultValue={profile.contactPhone ?? ""} /></label>
    <label><span>Тайлбар / онцлог</span><input name="notes" defaultValue={profile.notes ?? ""} /></label>
  </div></fieldset>{error && <p className="login-error" role="alert">{error}</p>}<div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>Болих</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "Хадгалж байна..." : "Өөрчлөлт хадгалах"}</button></div></form>;
}

export function CreateCustomerDialog({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(record: CustomerRecord): void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [customerType, setCustomerType] = useState<"individual" | "legal_entity">("individual");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload: CreateCustomerInput = {
      type: customerType,
      displayName: readFormText(form, "displayName"),
      registrationNumber: readFormText(form, "registrationNumber"),
      email: readFormText(form, "email"),
      phone: readFormText(form, "phone"),
      address: readFormText(form, "address"),
      province: customerType === "individual" ? readFormText(form, "province") : undefined,
      district: customerType === "individual" ? readFormText(form, "district") : undefined,
      organizationProfile: customerType === "legal_entity" ? {
        depositName: readFormText(form, "depositName"),
        branchName: readFormText(form, "branchName"),
        organizationKind: readFormText(form, "organizationKind"),
        bankName: readFormText(form, "bankName"),
        bankAccount: readFormText(form, "bankAccount"),
        province: readFormText(form, "province"),
        district: readFormText(form, "district"),
        bag: readFormText(form, "bag"),
        mineInitialNumber: readFormText(form, "mineInitialNumber"),
        contactName: readFormText(form, "contactName"),
        contactPhone: readFormText(form, "contactPhone"),
        notes: readFormText(form, "notes"),
      } : undefined,
    };

    try {
      const response = await fetch("/api/v1/customers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.record) {
        setError(body?.message ?? "Харилцагч бүртгэх үед алдаа гарлаа.");
        return;
      }

      onCreated(body.record);
    } catch {
      setError("Сүлжээний холболтыг шалгаад дахин оролдоно уу.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" aria-modal="true" role="dialog" aria-labelledby="create-customer-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Харилцагчийн бүртгэл</p>
            <h2 id="create-customer-title">Шинэ харилцагч бүртгэх</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Хаах
          </button>
        </div>

        <form className="assay-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              <span>Харилцагчийн төрөл</span>
              <select name="type" value={customerType} onChange={(event) => setCustomerType(event.target.value as "individual" | "legal_entity")}>
                <option value="individual">Иргэн</option>
                <option value="legal_entity">Байгууллага</option>
              </select>
            </label>
            <label>
              <span>Нэр</span>
              <input name="displayName" required type="text" />
            </label>
            <label>
              <span>Регистр / байгууллагын дугаар</span>
              <input name="registrationNumber" type="text" />
            </label>
            <label>
              <span>Имэйл</span>
              <input name="email" type="email" />
            </label>
            <label>
              <span>Утас</span>
              <input name="phone" inputMode="tel" type="text" />
            </label>
            {customerType === "individual" && <>
              <label><span>Аймаг / хот</span><input name="province" type="text" maxLength={120} /></label>
              <label><span>Сум / дүүрэг</span><input name="district" type="text" maxLength={120} /></label>
            </>}
            {customerType === "legal_entity" ? <>
              <label><span>Ордын нэр</span><input name="depositName" type="text" /></label>
              <label><span>Байгууллагын төрөл</span><input name="organizationKind" type="text" /></label>
              <label><span>Банкны нэр</span><input name="bankName" type="text" /></label>
              <label><span>Банкны данс</span><input name="bankAccount" type="text" /></label>
              <label><span>Аймаг / нийслэл</span><input name="province" type="text" /></label>
              <label><span>Сум / дүүрэг</span><input name="district" type="text" /></label>
              <label><span>Баг</span><input name="bag" type="text" /></label>
              <label><span>Хаяг / байршил</span><input name="address" type="text" /></label>
              <label><span>Салбар байгууллага</span><input name="branchName" type="text" /></label>
              <label><span>Гулдмайн эхний дугаар</span><input name="mineInitialNumber" type="text" /></label>
              <label><span>Харилцах албан хаагч</span><input name="contactName" type="text" /></label>
              <label><span>Харилцах албан хаагчийн утас</span><input name="contactPhone" inputMode="tel" type="text" /></label>
              <label><span>Тайлбар / онцлог</span><input name="notes" type="text" /></label>
            </> : null}
          </div>

          {error ? <p className="login-error">{error}</p> : null}

          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Болих
            </button>
            <button className="primary-button" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Хадгалж байна..." : "Харилцагч хадгалах"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function formatWeight(value: number): string {
  return `${formatNumber(value)} гр`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("mn-MN", {
    maximumFractionDigits: 4,
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";

  return new Intl.DateTimeFormat("mn-MN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function readFormText(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function profileFromForm(form: FormData) {
  return {
    depositName: readFormText(form, "depositName"), branchName: readFormText(form, "branchName"),
    organizationKind: readFormText(form, "organizationKind"), bankName: readFormText(form, "bankName"),
    bankAccount: readFormText(form, "bankAccount"), province: readFormText(form, "province"),
    district: readFormText(form, "district"), bag: readFormText(form, "bag"),
    mineInitialNumber: readFormText(form, "mineInitialNumber"), contactName: readFormText(form, "contactName"),
    contactPhone: readFormText(form, "contactPhone"), notes: readFormText(form, "notes"),
  };
}

function formatMaskedContact(customer: CustomerRecord): string {
  const parts = [customer.phoneMasked, customer.emailMasked].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "-";
}
