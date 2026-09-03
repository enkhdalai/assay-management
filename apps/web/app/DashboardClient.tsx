"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import type {
  AssayApiRecord,
  AssayResultWorkItem,
  BankDirectoryRecord,
  BullionIntakeBatchRecord,
  CreateBullionIntakeInput,
  BankAllocation,
  CreateBankInput,
  CreateAssayInput,
  CreateCustomerInput,
  CustomerRecord,
  ManagedUser,
  MetalType,
  SubmitAssayResultInput,
  UserRole,
  UserStatus,
} from "../../../packages/shared/src";
import { LogoutButton } from "./LogoutButton";

type DashboardView = "dashboard" | "assayRecords" | "bullionIntake" | "customers" | "assayResults" | "bullionExamination" | "bankAccess" | "banks" | "auditLog" | "settings";

const navigationItems = [
  { label: "Хяналтын самбар", view: "dashboard" },
  { label: "Сорьцын бүртгэл", view: "assayRecords" },
  { label: "Гулдмай хүлээн авах", view: "bullionIntake" },
  { label: "Харилцагчид", view: "customers" },
  { label: "Шинжилгээний дүн", view: "assayResults" },
  { label: "Гулдмайн шинжилгээ", view: "bullionExamination" },
  { label: "Банк хуваарилалт", view: "bankAccess" },
  { label: "Арилжааны банкууд", view: "banks" },
  { label: "Тайлан", href: "#" },
  { label: "Аудит лог", view: "auditLog" },
  { label: "Хэрэглэгч урих", href: "/users/invite" },
  { label: "Тохиргоо", view: "settings" },
] satisfies Array<
  | { label: string; href: string; view?: never }
  | { label: string; href?: never; view: DashboardView }
>;

const statusLabels: Record<AssayApiRecord["status"], string> = {
  draft: "Ноорог",
  received: "Хүлээн авсан",
  in_analysis: "Шинжилгээнд",
  manager_review: "Эрхлэгч хянах",
  approved: "Баталгаажсан",
  bom_submitted: "Монголбанк руу",
  bom_confirmed: "Монголбанк баталсан",
  bank_assigned: "Банк хуваарилсан",
  settlement_pending: "Төлбөр хүлээгдэж буй",
  settled: "Төлбөр хийгдсэн",
  closed: "Хаагдсан",
  cancelled: "Цуцалсан",
};

const workflowStatuses: Array<{ label: string; statuses: AssayApiRecord["status"][] }> = [
  { label: "Хүлээн авсан", statuses: ["received"] },
  { label: "Шинжилгээнд", statuses: ["in_analysis"] },
  { label: "Эрхлэгч хянах", statuses: ["manager_review"] },
  { label: "Монголбанк руу", statuses: ["bom_submitted", "bom_confirmed"] },
  { label: "Банк хүлээн авсан", statuses: ["bank_assigned", "settlement_pending", "settled"] },
];

type BankAccessSummary = {
  bank: string;
  records: number;
  grams: number;
  permission: string;
};

type BankAllocationRow = {
  id: string;
  recordId: string;
  customerName: string;
  bankName: string;
  metal: MetalType;
  allocatedGrams: number;
  status: AssayApiRecord["status"];
  receivedAt: string | null;
};

type AuditEvent = {
  id: string;
  title: string;
  description: string;
  meta: string;
};

export function DashboardClient() {
  const [activeView, setActiveView] = useState<DashboardView>("dashboard");
  const [records, setRecords] = useState<AssayApiRecord[]>([]);
  const [resultItems, setResultItems] = useState<AssayResultWorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isResultsLoading, setIsResultsLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultsError, setResultsError] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCustomerCreateOpen, setIsCustomerCreateOpen] = useState(false);
  const [trackingRecord, setTrackingRecord] = useState<AssayApiRecord | null>(null);
  const [selectedResultItem, setSelectedResultItem] = useState<AssayResultWorkItem | null>(null);
  const [trackingItem, setTrackingItem] = useState<AssayResultWorkItem | null>(null);
  const [isResultHelpOpen, setIsResultHelpOpen] = useState(false);
  const [isIntegrityHelpOpen, setIsIntegrityHelpOpen] = useState(false);
  const [approvingResultId, setApprovingResultId] = useState("");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isUsersLoading, setIsUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [hasLoadedUsers, setHasLoadedUsers] = useState(false);
  const [hasLoadedResults, setHasLoadedResults] = useState(false);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [isCustomersLoading, setIsCustomersLoading] = useState(false);
  const [customersError, setCustomersError] = useState("");
  const [hasLoadedCustomers, setHasLoadedCustomers] = useState(false);
  const [banks, setBanks] = useState<BankDirectoryRecord[]>([]);
  const [isBanksLoading, setIsBanksLoading] = useState(false);
  const [banksError, setBanksError] = useState("");
  const [hasLoadedBanks, setHasLoadedBanks] = useState(false);
  const [bullionBatches, setBullionBatches] = useState<BullionIntakeBatchRecord[]>([]);
  const [isBullionLoading, setIsBullionLoading] = useState(false);
  const [bullionError, setBullionError] = useState("");
  const [hasLoadedBullion, setHasLoadedBullion] = useState(false);

  async function loadRecords() {
    setError("");
    const response = await fetch("/api/v1/assays", {
      headers: { accept: "application/json" },
    });
    const body = await response.json().catch(() => null);

    if (!response.ok || !Array.isArray(body?.data)) {
      throw new Error(body?.message ?? "Сорьцын мэдээлэл татах үед алдаа гарлаа.");
    }

    setRecords(body.data);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadRecords()
        .catch((loadError: unknown) => {
          setError(loadError instanceof Error ? loadError.message : "Сүлжээний алдаа гарлаа.");
        })
        .finally(() => setIsLoading(false));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function loadUsers() {
    setUsersError("");
    setIsUsersLoading(true);

    try {
      const response = await fetch("/api/v1/users", {
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !Array.isArray(body?.data)) {
        throw new Error(body?.message ?? "Хэрэглэгчийн мэдээлэл татах үед алдаа гарлаа.");
      }

      setUsers(body.data);
      setHasLoadedUsers(true);
    } catch (loadError) {
      setUsersError(loadError instanceof Error ? loadError.message : "Сүлжээний алдаа гарлаа.");
    } finally {
      setIsUsersLoading(false);
    }
  }

  async function loadCustomers() {
    setCustomersError("");
    setIsCustomersLoading(true);

    try {
      const response = await fetch("/api/v1/customers", {
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !Array.isArray(body?.data)) {
        throw new Error(body?.message ?? "Харилцагчийн мэдээлэл татах үед алдаа гарлаа.");
      }

      setCustomers(body.data);
      setHasLoadedCustomers(true);
    } catch (loadError) {
      setCustomersError(loadError instanceof Error ? loadError.message : "Сүлжээний алдаа гарлаа.");
    } finally {
      setIsCustomersLoading(false);
    }
  }

  async function loadResultItems() {
    setResultsError("");
    setIsResultsLoading(true);

    try {
      const response = await fetch("/api/v1/assay-results", {
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !Array.isArray(body?.data)) {
        throw new Error(body?.message ?? "Шинжилгээний дүн татах үед алдаа гарлаа.");
      }

      setResultItems(body.data);
      setHasLoadedResults(true);
    } catch (loadError) {
      setResultsError(loadError instanceof Error ? loadError.message : "Сүлжээний алдаа гарлаа.");
    } finally {
      setIsResultsLoading(false);
    }
  }

  async function loadBanks() {
    setBanksError("");
    setIsBanksLoading(true);

    try {
      const response = await fetch("/api/v1/banks", {
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.data)) {
        throw new Error(body?.message ?? "Банкны лавлах татах үед алдаа гарлаа.");
      }
      setBanks(body.data);
      setHasLoadedBanks(true);
    } catch (loadError) {
      setBanksError(loadError instanceof Error ? loadError.message : "Сүлжээний алдаа гарлаа.");
    } finally {
      setIsBanksLoading(false);
    }
  }

  async function loadBullionIntakes() {
    setBullionError("");
    setIsBullionLoading(true);
    try {
      const response = await fetch("/api/v1/bullion/intakes", { headers: { accept: "application/json" } });
      const body = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(body?.data)) {
        throw new Error(body?.message ?? "Гулдмайн бүртгэл татах үед алдаа гарлаа.");
      }
      setBullionBatches(body.data);
      setHasLoadedBullion(true);
    } catch (loadError) {
      setBullionError(loadError instanceof Error ? loadError.message : "Сүлжээний алдаа гарлаа.");
    } finally {
      setIsBullionLoading(false);
    }
  }

  function openView(view: DashboardView) {
    setActiveView(view);
    if (view === "settings" && !hasLoadedUsers && !isUsersLoading) {
      void loadUsers();
    }
    if (view === "assayResults" && !hasLoadedResults && !isResultsLoading) {
      void loadResultItems();
    }
    if (view === "customers" && !hasLoadedCustomers && !isCustomersLoading) {
      void loadCustomers();
    }
    if (view === "banks" && !hasLoadedBanks && !isBanksLoading) {
      void loadBanks();
    }
    if ((view === "bullionIntake" || view === "bullionExamination") && !hasLoadedBullion && !isBullionLoading) {
      void loadBullionIntakes();
    }
    if ((view === "bullionIntake" || view === "bullionExamination") && !hasLoadedCustomers && !isCustomersLoading) {
      void loadCustomers();
    }
  }

  const stats = useMemo(
    () => [
      { label: "Идэвхтэй сорьц", value: records.length, tone: "blue" },
      {
        label: "Баталгаажуулах",
        value: records.filter((record) => record.status === "manager_review").length,
        tone: "amber",
      },
      {
        label: "Банкуудад илгээсэн",
        value: records.filter((record) => record.allocations.length > 0).length,
        tone: "green",
      },
      {
        label: "Түгжээтэй бичилт",
        value: records.filter((record) => record.status === "approved").length,
        tone: "slate",
      },
    ],
    [records],
  );

  const workflow = workflowStatuses.map((step) => ({
    label: step.label,
    count: records.filter((record) => step.statuses.includes(record.status)).length,
  }));

  const bankAccess = useMemo(() => summarizeBankAccess(records), [records]);
  const bankPreview = bankAccess.slice(0, 4);
  const auditEvents = useMemo(() => buildAuditEvents(records), [records]);
  const auditPreview = auditEvents.slice(0, 4);

  async function handleCreated(record: AssayApiRecord) {
    setRecords((currentRecords) => [record, ...currentRecords]);
    if (hasLoadedResults) {
      await loadResultItems();
    }
    if (hasLoadedCustomers) {
      await loadCustomers();
    }
    setIsCreateOpen(false);
  }

  function openCreateAssay() {
    setIsCreateOpen(true);
    if (!hasLoadedCustomers && !isCustomersLoading) void loadCustomers();
    if (!hasLoadedBanks && !isBanksLoading) void loadBanks();
  }

  function handleCustomerCreated(record: CustomerRecord) {
    setCustomers((currentCustomers) => [record, ...currentCustomers]);
    setIsCustomerCreateOpen(false);
  }

  function handleResultChanged(item: AssayResultWorkItem) {
    setResultItems((currentItems) =>
      currentItems.map((currentItem) => currentItem.id === item.id ? item : currentItem),
    );
    setRecords((currentRecords) =>
      currentRecords.map((currentRecord) => currentRecord.id === item.id ? item : currentRecord),
    );
  }

  async function approveResult(item: AssayResultWorkItem) {
    setResultsError("");
    setApprovingResultId(item.id);

    try {
      const response = await fetch(`/api/v1/assay-results/${encodeURIComponent(item.id)}/approve`, {
        method: "POST",
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.record) {
        setResultsError(body?.message ?? "Шинжилгээний дүн батлах үед алдаа гарлаа.");
        return;
      }

      handleResultChanged(body.record);
    } catch {
      setResultsError("Сүлжээний холболтыг шалгаад дахин оролдоно уу.");
    } finally {
      setApprovingResultId("");
    }
  }

  const viewHeader = getViewHeader(activeView);

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Үндсэн цэс">
        <div className="brand-block">
          <div className="brand-mark">
            <img alt="" src="/favicon.svg" />
          </div>
          <div>
            <strong>Сорьцын төв</strong>
            <span>Хувийн удирдлага</span>
          </div>
        </div>

        <nav className="nav-list">
          {navigationItems.map((item) => {
            const isActive = Boolean(item.view && item.view === activeView);
            const content = (
              <>
                <span className="nav-icon">{item.label.slice(0, 1)}</span>
                {item.label}
              </>
            );

            return item.view ? (
              <button
                className={isActive ? "nav-item active" : "nav-item"}
                key={item.label}
                type="button"
                onClick={() => openView(item.view)}
              >
                {content}
              </button>
            ) : (
              <a className="nav-item" href={item.href} key={item.label}>
                {content}
              </a>
            );
          })}
        </nav>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">{viewHeader.eyebrow}</p>
            <h1>{viewHeader.title}</h1>
          </div>
          <div className="top-actions">
            <button aria-label="Тусламж">?</button>
            <button aria-label="Мэдэгдэл">!</button>
            <div className="user-menu">Супер админ</div>
            <LogoutButton />
          </div>
        </header>

        {activeView === "dashboard" ? (
          <>
            <section className="stats-grid" aria-label="Товч үзүүлэлтүүд">
              {stats.map((item) => (
                <article className={`stat-card ${item.tone}`} key={item.label}>
                  <span>{item.label}</span>
                  <strong>{isLoading ? "-" : item.value}</strong>
                </article>
              ))}
            </section>

            <section className="dashboard-grid">
              <article className="panel wide report-span">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Ерөнхий тайлан</p>
                    <h2>Сорьцын урсгал</h2>
                  </div>
                  <div className="settings-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Өгөгдлийн бүрэн бүтэн байдлын дүрэм харах"
                      onClick={() => setIsIntegrityHelpOpen(true)}
                    >
                      i
                    </button>
                    <button className="primary-button" type="button" onClick={openCreateAssay}>
                      Шинэ сорьц бүртгэх
                    </button>
                  </div>
                </div>
                <div className="workflow">
                  {workflow.map((step) => (
                    <div className="workflow-step" key={step.label}>
                      <strong>{isLoading ? "-" : step.count}</strong>
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="dashboard-grid bottom">
              <button
                className="panel summary-panel"
                type="button"
                onClick={() => openView("bankAccess")}
                aria-label="Банк хуваарилалтын дэлгэрэнгүй харах"
              >
                <div className="panel-header compact">
                  <div>
                    <p className="eyebrow">Арилжааны банк</p>
                    <h2>Унших эрхийн хязгаарлалт</h2>
                  </div>
                </div>
                <div className="bank-list compact-list">
                  {bankAccess.length === 0 ? (
                    <p className="muted-text">Банкны хуваарилалт бүртгэгдээгүй байна.</p>
                  ) : (
                    <>
                      {bankPreview.slice(0, 3).map((bank) => (
                        <div className="bank-item" key={bank.bank}>
                          <div>
                            <strong>{bank.bank}</strong>
                            <span>{bank.permission}</span>
                          </div>
                          <div>
                            <strong>{bank.records}</strong>
                            <span>{formatWeight(bank.grams)}</span>
                          </div>
                        </div>
                      ))}
                      {bankPreview[3] ? (
                        <div className="bank-item preview-blur" aria-hidden="true">
                          <div>
                            <strong>{bankPreview[3].bank}</strong>
                            <span>{bankPreview[3].permission}</span>
                          </div>
                          <div>
                            <strong>{bankPreview[3].records}</strong>
                            <span>{formatWeight(bankPreview[3].grams)}</span>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
                {bankAccess.length > 3 ? <span className="summary-more">Дэлгэрэнгүй харах</span> : null}
              </button>

              <button
                className="panel summary-panel"
                type="button"
                onClick={() => openView("auditLog")}
                aria-label="Аудит логийн дэлгэрэнгүй харах"
              >
                <div className="panel-header compact">
                  <div>
                    <p className="eyebrow">Аудит</p>
                    <h2>Сүүлийн үйлдлүүд</h2>
                  </div>
                </div>
                {auditEvents.length === 0 ? (
                  <p className="muted-text">Шинэ бүртгэл үүсэхэд аудитын мөр энд харагдана.</p>
                ) : (
                  <ol className="audit-list">
                    {auditPreview.slice(0, 3).map((event) => (
                      <li key={event.id}>{event.title}</li>
                    ))}
                    {auditPreview[3] ? (
                      <li className="preview-blur" key={auditPreview[3].id} aria-hidden="true">
                        {auditPreview[3].title}
                      </li>
                    ) : null}
                  </ol>
                )}
                {auditEvents.length > 3 ? <span className="summary-more">Дэлгэрэнгүй харах</span> : null}
              </button>
            </section>
          </>
        ) : activeView === "assayRecords" ? (
          <AssayRecordsView
            error={error}
            isLoading={isLoading}
            onOpenTracking={setTrackingRecord}
            records={records}
            onOpenCreate={openCreateAssay}
            onRefresh={loadRecords}
          />
        ) : activeView === "bullionIntake" ? (
          <BullionIntakeView
            customers={customers}
            error={bullionError || customersError}
            isLoading={isBullionLoading || isCustomersLoading}
            onCreated={(record) => setBullionBatches((current) => [record, ...current])}
            batches={bullionBatches}
          />
        ) : activeView === "customers" ? (
          <CustomersView
            customers={customers}
            error={customersError}
            isLoading={isCustomersLoading}
            onOpenCreate={() => setIsCustomerCreateOpen(true)}
            onRefresh={loadCustomers}
          />
        ) : activeView === "assayResults" ? (
          <AssayResultsView
            approvingResultId={approvingResultId}
            error={resultsError}
            isLoading={isResultsLoading}
            items={resultItems}
            onApprove={approveResult}
            onOpenHelp={() => setIsResultHelpOpen(true)}
            onOpenEntry={setSelectedResultItem}
            onOpenTracking={setTrackingItem}
            onRefresh={loadResultItems}
          />
        ) : activeView === "bullionExamination" ? (
          <BullionExaminationView
            batches={bullionBatches}
            error={bullionError}
            isLoading={isBullionLoading}
          />
        ) : activeView === "bankAccess" ? (
          <BankAccessView
            bankAccess={bankAccess}
            isLoading={isLoading}
            onRefresh={loadRecords}
            records={records}
          />
        ) : activeView === "banks" ? (
          <BanksView
            banks={banks}
            error={banksError}
            isLoading={isBanksLoading}
            onRefresh={loadBanks}
          />
        ) : activeView === "auditLog" ? (
          <AuditLogView
            events={auditEvents}
            isLoading={isLoading}
            onRefresh={loadRecords}
          />
        ) : (
          <SettingsView
            error={usersError}
            isLoading={isUsersLoading}
            onRefresh={loadUsers}
            users={users}
          />
        )}
      </section>

      {isCreateOpen ? (
        <CreateAssayDialog
          banks={banks}
          customers={customers}
          isBanksLoading={isBanksLoading}
          isCustomersLoading={isCustomersLoading}
          onClose={() => setIsCreateOpen(false)}
          onCreated={handleCreated}
        />
      ) : null}

      {isCustomerCreateOpen ? (
        <CreateCustomerDialog
          onClose={() => setIsCustomerCreateOpen(false)}
          onCreated={handleCustomerCreated}
        />
      ) : null}

      {trackingRecord ? (
        <AssayRecordTrackingDialog
          record={trackingRecord}
          onClose={() => setTrackingRecord(null)}
        />
      ) : null}

      {selectedResultItem ? (
        <ResultEntryDialog
          item={selectedResultItem}
          onClose={() => setSelectedResultItem(null)}
          onSubmitted={(item) => {
            handleResultChanged(item);
            setSelectedResultItem(null);
          }}
        />
      ) : null}

      {trackingItem ? (
        <ResultTrackingDialog
          item={trackingItem}
          onClose={() => setTrackingItem(null)}
          onEdit={(item) => {
            setTrackingItem(null);
            setSelectedResultItem(item);
          }}
        />
      ) : null}

      {isResultHelpOpen ? (
        <ResultHelpDialog onClose={() => setIsResultHelpOpen(false)} />
      ) : null}

      {isIntegrityHelpOpen ? (
        <IntegrityHelpDialog onClose={() => setIsIntegrityHelpOpen(false)} />
      ) : null}
    </main>
  );
}

function AssayRecordsView({
  error,
  isLoading,
  onOpenCreate,
  onOpenTracking,
  onRefresh,
  records,
}: {
  error: string;
  isLoading: boolean;
  onOpenCreate(): void;
  onOpenTracking(record: AssayApiRecord): void;
  onRefresh(): void;
  records: AssayApiRecord[];
}) {
  const totalWeight = records.reduce((sum, record) => sum + record.grossWeightGrams, 0);
  const pendingResults = records.filter((record) => record.purityPercent === null).length;
  const allocatedRecords = records.filter((record) => record.allocations.length > 0).length;
  const [statusFilter, setStatusFilter] = useState<AssayApiRecord["status"] | "all">("all");
  const [metalFilter, setMetalFilter] = useState<MetalType | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const filteredRecords = useMemo(
    () =>
      records.filter((record) => {
        const normalizedQuery = searchQuery.trim().toLowerCase();
        const matchesStatus = statusFilter === "all" || record.status === statusFilter;
        const matchesMetal = metalFilter === "all" || record.metal === metalFilter;
        const matchesSearch = normalizedQuery.length === 0 || [
          record.id,
          record.customerName,
          record.metal === "gold" ? "алт" : "мөнгө",
          statusLabels[record.status],
          formatAllocations(record.allocations),
        ].some((value) => value.toLowerCase().includes(normalizedQuery));

        return matchesStatus && matchesMetal && matchesSearch;
      }),
    [metalFilter, records, searchQuery, statusFilter],
  );

  return (
    <>
      <section className="settings-summary" aria-label="Сорьцын бүртгэлийн товч үзүүлэлт">
        <article className="stat-card blue">
          <span>Нийт бүртгэл</span>
          <strong>{isLoading ? "-" : records.length}</strong>
        </article>
        <article className="stat-card amber">
          <span>Дүн хүлээгдэж буй</span>
          <strong>{isLoading ? "-" : pendingResults}</strong>
        </article>
        <article className="stat-card green">
          <span>Банк хуваарилсан</span>
          <strong>{isLoading ? "-" : allocatedRecords}</strong>
        </article>
        <article className="stat-card slate">
          <span>Нийт жин</span>
          <strong>{isLoading ? "-" : formatWeight(totalWeight)}</strong>
        </article>
      </section>

      <section className="panel records-main">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Хүлээн авсан сорьцууд</p>
            <h2>Сорьцын бүртгэл</h2>
          </div>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={onRefresh} disabled={isLoading}>
              Шинэчлэх
            </button>
            <button className="primary-button" type="button" onClick={onOpenCreate}>
              Шинэ сорьц бүртгэх
            </button>
          </div>
        </div>

        <div className="filter-row records-filter">
          <select
            aria-label="Төлөв"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.currentTarget.value as AssayApiRecord["status"] | "all")}
          >
            <option value="all">Бүх төлөв</option>
            {Object.entries(statusLabels).map(([status, label]) => (
              <option key={status} value={status}>{label}</option>
            ))}
          </select>
          <select
            aria-label="Металл"
            value={metalFilter}
            onChange={(event) => setMetalFilter(event.currentTarget.value as MetalType | "all")}
          >
            <option value="all">Алт, мөнгө</option>
            <option value="gold">Алт</option>
            <option value="silver">Мөнгө</option>
          </select>
          <input
            aria-label="Хайлт"
            placeholder="№, харилцагч, банкаар хайх"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
          />
        </div>

        {error ? <p className="login-error">{error}</p> : null}

        <div className="record-table" role="table" aria-label="Сорьцын бүртгэл">
          <div className="table-row table-head" role="row">
            <span>№</span>
            <span>Харилцагч</span>
            <span>Металл</span>
            <span>Жин</span>
            <span>Сорьц</span>
            <span>Цэвэр жин</span>
            <span>Банкны хуваарилалт</span>
            <span>Төлөв</span>
          </div>
          {isLoading ? (
            <div className="empty-state">Сорьцын мэдээлэл ачаалж байна...</div>
          ) : records.length === 0 ? (
            <div className="empty-state">
              <strong>Бүртгэсэн сорьц алга байна.</strong>
              <span>“Шинэ сорьц бүртгэх” товчоор эхний сорьцыг бүртгэнэ.</span>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="empty-state">
              <strong>Илэрц олдсонгүй.</strong>
              <span>Шүүлтүүрийн утгаа өөрчлөөд дахин шалгана уу.</span>
            </div>
          ) : (
            filteredRecords.map((record) => (
              <div className="table-row" role="row" key={record.id}>
                <strong>{record.id}</strong>
                <span>{record.customerName}</span>
                <span>{record.metal === "gold" ? "Алт" : "Мөнгө"}</span>
                <span>{formatWeight(record.grossWeightGrams)}</span>
                <span>{record.purityPercent === null ? "Хүлээгдэж байна" : `${formatNumber(record.purityPercent)}%`}</span>
                <span>{record.fineWeightGrams === null ? "-" : formatWeight(record.fineWeightGrams)}</span>
                <span>{formatAllocations(record.allocations)}</span>
                <button
                  className={`status-pill status-action ${record.status}`}
                  type="button"
                  onClick={() => onOpenTracking(record)}
                  aria-label={`${record.id} сорьцын явцын түүх харах`}
                >
                  {statusLabels[record.status]}
                </button>
              </div>
            ))
          )}
        </div>

        <p className="muted-text records-note">
          Шинэ сорьц бүртгэхэд тухайн сорьц шууд “Хүлээн авсан” төлөвтэй болж, шинжилгээний дүн оруулах дараалалд орно.
        </p>
      </section>
    </>
  );
}

function CustomersView({
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
            <div className="empty-state">Харилцагчийн мэдээлэл ачаалж байна...</div>
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
              <div className="table-row" role="row" key={customer.id}>
                <strong>{customer.displayName}</strong>
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
    </>
  );
}

function BankAccessView({
  bankAccess,
  isLoading,
  onRefresh,
  records,
}: {
  bankAccess: BankAccessSummary[];
  isLoading: boolean;
  onRefresh(): void;
  records: AssayApiRecord[];
}) {
  const allocationRows = buildBankAllocationRows(records);
  const totalGrams = bankAccess.reduce((sum, bank) => sum + bank.grams, 0);

  return (
    <>
      <section className="settings-summary" aria-label="Банк хуваарилалтын товч үзүүлэлт">
        <article className="stat-card blue">
          <span>Банк</span>
          <strong>{isLoading ? "-" : bankAccess.length}</strong>
        </article>
        <article className="stat-card green">
          <span>Хуваарилалт</span>
          <strong>{isLoading ? "-" : allocationRows.length}</strong>
        </article>
        <article className="stat-card slate">
          <span>Нийт грамм</span>
          <strong>{isLoading ? "-" : formatWeight(totalGrams)}</strong>
        </article>
      </section>

      <section className="panel records-main">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Арилжааны банкны эрх</p>
            <h2>Банк хуваарилалт</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={isLoading}>
            Шинэчлэх
          </button>
        </div>

        {bankAccess.length === 0 ? (
          <div className="empty-state">
            <strong>Банканд хуваарилсан сорьц алга байна.</strong>
            <span>Шинэ сорьц бүртгэх үед банк тус бүрийн граммыг сонгосноор энд харагдана.</span>
          </div>
        ) : (
          <div className="bank-list bank-overview">
            {bankAccess.map((bank) => (
              <div className="bank-item" key={bank.bank}>
                <div>
                  <strong>{bank.bank}</strong>
                  <span>{bank.permission}</span>
                </div>
                <div>
                  <strong>{bank.records}</strong>
                  <span>{formatWeight(bank.grams)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel records-main">
        <div className="panel-header compact">
          <div>
            <p className="eyebrow">Сорьц бүрээр</p>
            <h2>Банканд харагдах мөрүүд</h2>
          </div>
        </div>
        <div className="record-table bank-table" role="table" aria-label="Банк хуваарилалтын мөрүүд">
          <div className="table-row table-head" role="row">
            <span>№</span>
            <span>Харилцагч</span>
            <span>Банк</span>
            <span>Металл</span>
            <span>Хэмжээ</span>
            <span>Төлөв</span>
          </div>
          {isLoading ? (
            <div className="empty-state">Банк хуваарилалтын мэдээлэл ачаалж байна...</div>
          ) : allocationRows.length === 0 ? (
            <div className="empty-state">Хуваарилалтын мөр алга байна.</div>
          ) : (
            allocationRows.map((row) => (
              <div className="table-row" role="row" key={row.id}>
                <strong>{row.recordId}</strong>
                <span>{row.customerName}</span>
                <span>{row.bankName}</span>
                <span>{row.metal === "gold" ? "Алт" : "Мөнгө"}</span>
                <span>{formatWeight(row.allocatedGrams)}</span>
                <span className={`status-pill ${row.status}`}>{statusLabels[row.status]}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function BanksView({
  banks,
  error,
  isLoading,
  onRefresh,
}: {
  banks: BankDirectoryRecord[];
  error: string;
  isLoading: boolean;
  onRefresh(): void;
}) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState("");
  const activeBanks = banks.filter((bank) => bank.status === "active").length;
  const totalGrams = banks.reduce((sum, bank) => sum + bank.allocatedGrams, 0);

  async function updateStatus(bank: BankDirectoryRecord) {
    setUpdatingId(bank.id);
    try {
      const response = await fetch(`/api/v1/banks/${encodeURIComponent(bank.id)}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ status: bank.status === "active" ? "suspended" : "active" }),
      });
      if (!response.ok) throw new Error();
      onRefresh();
    } finally {
      setUpdatingId("");
    }
  }

  return (
    <>
      <section className="settings-summary" aria-label="Банкны лавлахын товч үзүүлэлт">
        <article className="stat-card blue"><span>Нийт банк</span><strong>{isLoading ? "-" : banks.length}</strong></article>
        <article className="stat-card green"><span>Идэвхтэй</span><strong>{isLoading ? "-" : activeBanks}</strong></article>
        <article className="stat-card amber"><span>Нийт хуваарилалт</span><strong>{isLoading ? "-" : banks.reduce((sum, bank) => sum + bank.allocationCount, 0)}</strong></article>
        <article className="stat-card slate"><span>Хуваарилсан жин</span><strong>{isLoading ? "-" : formatWeight(totalGrams)}</strong></article>
      </section>

      <section className="panel records-main">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Хуваарилалтын лавлах</p>
            <h2>Арилжааны банкууд</h2>
          </div>
          <div className="settings-actions">
            <button className="secondary-button" type="button" onClick={onRefresh} disabled={isLoading}>Шинэчлэх</button>
            <button className="primary-button" type="button" onClick={() => setIsCreateOpen(true)}>Банк бүртгэх</button>
          </div>
        </div>

        {error ? <p className="login-error">{error}</p> : null}
        <div className="record-table bank-directory-table" role="table" aria-label="Банкны лавлах">
          <div className="table-row table-head" role="row">
            <span>Банк</span><span>Төрөл</span><span>Код</span><span>Хуваарилалт</span><span>Нийт жин</span><span>Төлөв</span><span>Үйлдэл</span>
          </div>
          {isLoading ? <div className="empty-state">Банкны лавлах ачаалж байна...</div> : null}
          {!isLoading && banks.length === 0 ? (
            <div className="empty-state"><strong>Банк бүртгээгүй байна.</strong><span>Сорьц бүртгэхийн өмнө Монголбанк болон ашиглах арилжааны банкуудыг нэмнэ.</span></div>
          ) : null}
          {!isLoading ? banks.map((bank) => (
            <div className="table-row" role="row" key={bank.id}>
              <strong>{bank.name}</strong>
              <span>{bank.type === "bank_of_mongolia" ? "Монголбанк" : "Арилжааны банк"}</span>
              <span>{bank.code}</span>
              <span>{bank.allocationCount}</span>
              <span>{formatWeight(bank.allocatedGrams)}</span>
              <span className={`status-pill ${bank.status === "active" ? "approved" : "cancelled"}`}>{bank.status === "active" ? "Идэвхтэй" : "Идэвхгүй"}</span>
              <button className="secondary-button" type="button" disabled={updatingId === bank.id} onClick={() => void updateStatus(bank)}>
                {updatingId === bank.id ? "Хадгалж байна..." : bank.status === "active" ? "Идэвхгүй болгох" : "Идэвхжүүлэх"}
              </button>
            </div>
          )) : null}
        </div>
      </section>

      {isCreateOpen ? <CreateBankDialog onClose={() => setIsCreateOpen(false)} onCreated={() => { setIsCreateOpen(false); onRefresh(); }} /> : null}
    </>
  );
}

function CreateBankDialog({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    const payload: CreateBankInput = {
      type: readFormText(form, "type") === "bank_of_mongolia" ? "bank_of_mongolia" : "commercial_bank",
      code: readFormText(form, "code"),
      name: readFormText(form, "name"),
    };
    try {
      const response = await fetch("/api/v1/banks", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.record) {
        setError(body?.message ?? "Банк бүртгэх үед алдаа гарлаа.");
        return;
      }
      onCreated();
    } catch {
      setError("Сүлжээний холболтыг шалгаад дахин оролдоно уу.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" aria-modal="true" role="dialog" aria-labelledby="create-bank-title">
        <div className="modal-header"><div><p className="eyebrow">Банкны лавлах</p><h2 id="create-bank-title">Банк бүртгэх</h2></div><button className="secondary-button" type="button" onClick={onClose}>Хаах</button></div>
        <form className="assay-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label><span>Байгууллагын төрөл</span><select name="type"><option value="commercial_bank">Арилжааны банк</option><option value="bank_of_mongolia">Монголбанк</option></select></label>
            <label><span>Банкны код</span><input name="code" required maxLength={32} placeholder="Жишээ: KHAN" type="text" /></label>
            <label className="full-field"><span>Банкны нэр</span><input name="name" required maxLength={255} placeholder="Жишээ: Хаан банк" type="text" /></label>
          </div>
          <p className="muted-text security-hint">Идэвхгүй болсон банк шинэ сорьцын хуваарилалтад сонгогдохгүй. Өмнөх аудит, хуваарилалтын мөрүүд хадгалагдана.</p>
          {error ? <p className="login-error">{error}</p> : null}
          <div className="form-actions"><button className="secondary-button" type="button" onClick={onClose}>Болих</button><button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? "Хадгалж байна..." : "Банк хадгалах"}</button></div>
        </form>
      </section>
    </div>
  );
}

function AuditLogView({
  events,
  isLoading,
  onRefresh,
}: {
  events: AuditEvent[];
  isLoading: boolean;
  onRefresh(): void;
}) {
  return (
    <section className="panel records-main">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Өөрчлөлтийн мөр</p>
          <h2>Аудит лог</h2>
        </div>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={isLoading}>
          Шинэчлэх
        </button>
      </div>

      <div className="record-table audit-table" role="table" aria-label="Аудит лог">
        <div className="table-row table-head" role="row">
          <span>Үйлдэл</span>
          <span>Тайлбар</span>
          <span>Огноо</span>
        </div>
        {isLoading ? (
          <div className="empty-state">Аудитын мэдээлэл ачаалж байна...</div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <strong>Аудитын мөр алга байна.</strong>
            <span>Сорьц бүртгэх, дүн батлах, банк хуваарилах үед энд мөр нэмэгдэнэ.</span>
          </div>
        ) : (
          events.map((event) => (
            <div className="table-row" role="row" key={event.id}>
              <strong>{event.title}</strong>
              <span>{event.description}</span>
              <span>{event.meta}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function AssayResultsView({
  approvingResultId,
  error,
  isLoading,
  items,
  onApprove,
  onOpenHelp,
  onOpenEntry,
  onOpenTracking,
  onRefresh,
}: {
  approvingResultId: string;
  error: string;
  isLoading: boolean;
  items: AssayResultWorkItem[];
  onApprove(item: AssayResultWorkItem): void;
  onOpenHelp(): void;
  onOpenEntry(item: AssayResultWorkItem): void;
  onOpenTracking(item: AssayResultWorkItem): void;
  onRefresh(): void;
}) {
  const waitingCount = items.filter((item) => !item.latestResult).length;
  const reviewCount = items.filter((item) => item.latestResult?.status === "submitted").length;
  const approvedCount = items.filter((item) => item.latestResult?.status === "approved").length;
  const fineWeightTotal = items.reduce((sum, item) => sum + (item.latestResult?.fineWeightGrams ?? 0), 0);

  return (
    <>
      <section className="settings-summary" aria-label="Шинжилгээний товч үзүүлэлт">
        <article className="stat-card blue">
          <span>Дүн хүлээгдэж буй</span>
          <strong>{isLoading ? "-" : waitingCount}</strong>
        </article>
        <article className="stat-card amber">
          <span>Эрхлэгч хянах</span>
          <strong>{isLoading ? "-" : reviewCount}</strong>
        </article>
        <article className="stat-card green">
          <span>Баталгаажсан</span>
          <strong>{isLoading ? "-" : approvedCount}</strong>
        </article>
        <article className="stat-card slate">
          <span>Цэвэр жин</span>
          <strong>{isLoading ? "-" : formatWeight(fineWeightTotal)}</strong>
        </article>
      </section>

      <section className="panel result-main">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Лабораторийн ажилбар</p>
              <h2>Шинжилгээний дүн</h2>
            </div>
            <div className="settings-actions">
              <button className="icon-button" type="button" aria-label="Баталгаажуулах дүрэм харах" onClick={onOpenHelp}>
                i
              </button>
              <button className="secondary-button" type="button" onClick={onRefresh} disabled={isLoading}>
                Шинэчлэх
              </button>
            </div>
          </div>

          {error ? <p className="login-error">{error}</p> : null}

          <div className="result-table" role="table" aria-label="Шинжилгээний дүн">
            <div className="result-row result-head" role="row">
              <span>Сорьц</span>
              <span>Харилцагч</span>
              <span>Металл</span>
              <span>Жин</span>
              <span>Арга</span>
              <span>Сорьц</span>
              <span>Цэвэр жин</span>
              <span>Хянах төлөв</span>
              <span>Үйлдэл</span>
            </div>

            {isLoading ? (
              <div className="empty-state">Шинжилгээний мэдээлэл ачаалж байна...</div>
            ) : items.length === 0 && !error ? (
              <div className="empty-state">
                <strong>Шинжилгээ хийх сорьц алга байна.</strong>
                <span>Хүлээн авсан сорьц бүртгэгдсэний дараа энд дүн оруулах боломжтой болно.</span>
              </div>
            ) : (
              items.map((item) => (
                <div
                  className="result-row clickable"
                  role="row"
                  key={item.id}
                  tabIndex={0}
                  onClick={() => onOpenTracking(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpenTracking(item);
                    }
                  }}
                >
                  <span className="user-name">{item.id}</span>
                  <span>{item.customerName}</span>
                  <span>{item.metal === "gold" ? "Алт" : "Мөнгө"}</span>
                  <span>{formatWeight(item.grossWeightGrams)}</span>
                  <span>{item.latestResult?.methodName ?? "-"}</span>
                  <span>{item.latestResult ? `${formatNumber(item.latestResult.purityPercent)}%` : "Хүлээгдэж байна"}</span>
                  <span>{item.latestResult ? formatWeight(item.latestResult.fineWeightGrams) : "-"}</span>
                  <span className={`status-pill result-status ${item.latestResult?.status ?? "draft"}`}>
                    {item.latestResult ? resultStatusLabels[item.latestResult.status] : "Дүн оруулах"}
                  </span>
                  <span className="result-actions">
                    {item.latestResult?.status === "submitted" ? (
                      <>
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenEntry(item);
                          }}
                        >
                          Засах
                        </button>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={approvingResultId === item.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            onApprove(item);
                          }}
                        >
                          {approvingResultId === item.id ? "Баталж байна..." : "Батлах"}
                        </button>
                      </>
                    ) : item.latestResult?.status === "approved" ? (
                      <span className="muted-text">Түгжээтэй</span>
                    ) : (
                      <button
                        className="primary-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenEntry(item);
                        }}
                      >
                        Дүн оруулах
                      </button>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
      </section>
    </>
  );
}

function ResultEntryDialog({
  item,
  onClose,
  onSubmitted,
}: {
  item: AssayResultWorkItem;
  onClose(): void;
  onSubmitted(item: AssayResultWorkItem): void;
}) {
  const latestResult = item.latestResult;
  const [methodName, setMethodName] = useState<SubmitAssayResultInput["methodName"]>(
    isSubmitMethod(latestResult?.methodName) ? latestResult.methodName : "XRF",
  );
  const [grossWeight, setGrossWeight] = useState(String(latestResult?.grossWeightGrams ?? item.grossWeightGrams));
  const [purityPercent, setPurityPercent] = useState(
    latestResult ? String(latestResult.purityPercent) : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fineWeight = calculateFineWeight(Number(grossWeight), Number(purityPercent));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload: SubmitAssayResultInput = {
      methodName,
      instrumentName: readFormText(form, "instrumentName"),
      grossWeightGrams: Number(grossWeight),
      purityPercent: Number(purityPercent),
      resultNotes: readFormText(form, "resultNotes"),
    };

    try {
      const response = await fetch(`/api/v1/assay-results/${encodeURIComponent(item.id)}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.record) {
        setError(body?.message ?? "Шинжилгээний дүн хадгалах үед алдаа гарлаа.");
        return;
      }

      onSubmitted(body.record);
    } catch {
      setError("Сүлжээний холболтыг шалгаад дахин оролдоно уу.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" aria-modal="true" role="dialog" aria-labelledby="result-entry-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Шинжилгээний дүн</p>
            <h2 id="result-entry-title">{item.id} {latestResult?.status === "submitted" ? "дүн засах" : "дүн оруулах"}</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Хаах
          </button>
        </div>

        <form className="assay-form" onSubmit={handleSubmit}>
          <div className="result-context">
            <span>{item.customerName}</span>
            <span>{item.metal === "gold" ? "Алт" : "Мөнгө"}</span>
            <span>Хүлээн авсан: {formatWeight(item.grossWeightGrams)}</span>
            <span>{formatAllocations(item.allocations)}</span>
          </div>

          <div className="form-grid">
            <label>
              <span>Шинжилгээний арга</span>
              <select
                value={methodName}
                onChange={(event) => setMethodName(event.currentTarget.value as SubmitAssayResultInput["methodName"])}
              >
                <option value="XRF">XRF</option>
                <option value="Fire assay">Fire assay</option>
                <option value="ICP">ICP</option>
                <option value="Бусад">Бусад</option>
              </select>
            </label>
            <label>
              <span>Төхөөрөмж</span>
              <input
                name="instrumentName"
                placeholder="Жишээ: XRF-01"
                type="text"
                defaultValue={latestResult?.instrumentName ?? ""}
              />
            </label>
            <label>
              <span>Шинжилсэн жин /гр/</span>
              <input
                min="0.0001"
                required
                step="0.0001"
                type="number"
                value={grossWeight}
                onChange={(event) => setGrossWeight(event.currentTarget.value)}
              />
            </label>
            <label>
              <span>Сорьцын хувь /%/</span>
              <input
                min="0.0001"
                max="100"
                required
                step="0.0001"
                type="number"
                value={purityPercent}
                onChange={(event) => setPurityPercent(event.currentTarget.value)}
              />
            </label>
          </div>

          <div className="calculation-box">
            <span>Тооцоолсон цэвэр жин</span>
            <strong>{Number.isFinite(fineWeight) ? formatWeight(fineWeight) : "-"}</strong>
          </div>

          <label className="full-field">
            <span>Тайлбар</span>
            <textarea
              name="resultNotes"
              rows={3}
              placeholder="Шинжилгээний нөхцөл, дахин хэмжилт, зөрүүний тайлбар"
              defaultValue={latestResult?.resultNotes ?? ""}
            />
          </label>

          {error ? <p className="login-error">{error}</p> : null}

          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Болих
            </button>
            <button className="primary-button" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Илгээж байна..." : latestResult?.status === "submitted" ? "Засварыг илгээх" : "Эрхлэгчид илгээх"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ResultTrackingDialog({
  item,
  onClose,
  onEdit,
}: {
  item: AssayResultWorkItem;
  onClose(): void;
  onEdit(item: AssayResultWorkItem): void;
}) {
  const timeline = buildResultTimeline(item);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel tracking-panel" aria-modal="true" role="dialog" aria-labelledby="tracking-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Явцын мэдээлэл</p>
            <h2 id="tracking-title">{item.id} сорьцын замнал</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Хаах
          </button>
        </div>

        <div className="tracking-summary">
          <div>
            <span>Харилцагч</span>
            <strong>{item.customerName}</strong>
          </div>
          <div>
            <span>Металл</span>
            <strong>{item.metal === "gold" ? "Алт" : "Мөнгө"}</strong>
          </div>
          <div>
            <span>Хүлээн авсан жин</span>
            <strong>{formatWeight(item.grossWeightGrams)}</strong>
          </div>
          <div>
            <span>Цэвэр жин</span>
            <strong>{item.latestResult ? formatWeight(item.latestResult.fineWeightGrams) : "-"}</strong>
          </div>
        </div>

        <div className="timeline">
          {timeline.map((step) => (
            <div className={`timeline-step ${step.state}`} key={step.label}>
              <div className="timeline-dot" aria-hidden="true" />
              <div>
                <span>{step.label}</span>
                <p>{step.description}</p>
                <small>{step.meta}</small>
              </div>
            </div>
          ))}
        </div>

        <div className="tracking-footer">
          <div>
            <span>Банкны хуваарилалт</span>
            <p>{formatAllocations(item.allocations)}</p>
          </div>
          {item.latestResult?.status === "submitted" ? (
            <button className="secondary-button" type="button" onClick={() => onEdit(item)}>
              Дүн засах
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function AssayRecordTrackingDialog({
  onClose,
  record,
}: {
  onClose(): void;
  record: AssayApiRecord;
}) {
  const timeline = buildAssayRecordTimeline(record);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel tracking-panel" aria-modal="true" role="dialog" aria-labelledby="record-tracking-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Явцын түүх</p>
            <h2 id="record-tracking-title">{record.id} сорьцын төлөв</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Хаах
          </button>
        </div>

        <div className="tracking-summary">
          <div>
            <span>Харилцагч</span>
            <strong>{record.customerName}</strong>
          </div>
          <div>
            <span>Металл</span>
            <strong>{record.metal === "gold" ? "Алт" : "Мөнгө"}</strong>
          </div>
          <div>
            <span>Хүлээн авсан жин</span>
            <strong>{formatWeight(record.grossWeightGrams)}</strong>
          </div>
          <div>
            <span>Одоогийн төлөв</span>
            <strong>{statusLabels[record.status]}</strong>
          </div>
        </div>

        <div className="timeline">
          {timeline.map((step) => (
            <div className={`timeline-step ${step.state}`} key={step.label}>
              <div className="timeline-dot" aria-hidden="true" />
              <div>
                <span>{step.label}</span>
                <p>{step.description}</p>
                <small>{step.meta}</small>
              </div>
            </div>
          ))}
        </div>

        <div className="tracking-footer">
          <div>
            <span>Банкны хуваарилалт</span>
            <p>{formatAllocations(record.allocations)}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function ResultHelpDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel help-panel" aria-modal="true" role="dialog" aria-labelledby="result-help-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Maker-checker</p>
            <h2 id="result-help-title">Баталгаажуулах дүрэм</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Хаах
          </button>
        </div>
        <ul className="check-list">
          <li>Химич дүн оруулж эрхлэгчид илгээнэ.</li>
          <li>Дүн оруулсан хэрэглэгч өөрөө батлахгүй.</li>
          <li>Эрхлэгч батлахаас өмнө илгээсэн дүнг засаж болно.</li>
          <li>Баталгаажсан дүн шууд засагдахгүй, дараа нь засварын хүсэлтээр шинэ хувилбар үүснэ.</li>
          <li>BOM болон банкны харах өгөгдөл зөвхөн баталгаажсан дүн дээр суурилна.</li>
        </ul>
      </section>
    </div>
  );
}

function IntegrityHelpDialog({ onClose }: { onClose(): void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel help-panel" aria-modal="true" role="dialog" aria-labelledby="integrity-help-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Хамгаалалт</p>
            <h2 id="integrity-help-title">Өгөгдлийн бүрэн бүтэн байдал</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Хаах
          </button>
        </div>
        <ul className="check-list">
          <li>Баталгаажсан дүнг шууд засахгүй, шинэ хувилбар үүсгэнэ.</li>
          <li>Жин, сорьц, банкны хуваарилалт бүр аудит логтой.</li>
          <li>Оруулсан хэрэглэгч өөрөө эцсийн батлахгүй.</li>
        </ul>
      </section>
    </div>
  );
}

function CreateAssayDialog({
  banks,
  customers,
  isBanksLoading,
  isCustomersLoading,
  onClose,
  onCreated,
}: {
  banks: BankDirectoryRecord[];
  customers: CustomerRecord[];
  isBanksLoading: boolean;
  isCustomersLoading: boolean;
  onClose(): void;
  onCreated(record: AssayApiRecord): void;
}) {
  const activeBanks = banks.filter((bank) => bank.status === "active");
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    customers.length > 0 ? "existing" : "new",
  );
  const [selectedCustomerId, setSelectedCustomerId] = useState(customers[0]?.id ?? "");
  const [allocations, setAllocations] = useState<BankAllocation[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;

  useEffect(() => {
    if (!selectedCustomerId && customers[0]) {
      const timer = setTimeout(() => setSelectedCustomerId(customers[0].id), 0);
      return () => clearTimeout(timer);
    }
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    if (allocations.length === 0 && activeBanks[0]) {
      const bank = activeBanks[0];
      const timer = setTimeout(() => {
        setAllocations([{ bankId: bank.id, bankName: bank.name, allocatedGrams: 0 }]);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [activeBanks, allocations.length]);

  const totalAllocated = allocations.reduce(
    (sum, allocation) => sum + Number(allocation.allocatedGrams || 0),
    0,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const form = new FormData(event.currentTarget);
    const payload: CreateAssayInput = {
      customerId: customerMode === "existing" ? selectedCustomerId : undefined,
      customerName: customerMode === "existing" ? selectedCustomer?.displayName ?? "" : readFormText(form, "customerName"),
      customerType: customerMode === "existing"
        ? selectedCustomer?.type ?? "individual"
        : readFormText(form, "customerType") === "legal_entity" ? "legal_entity" : "individual",
      customerRegistrationNumber: customerMode === "new" ? readFormText(form, "customerRegistrationNumber") : undefined,
      customerEmail: customerMode === "new" ? readFormText(form, "customerEmail") : undefined,
      customerPhone: customerMode === "new" ? readFormText(form, "customerPhone") : undefined,
      metal: readFormText(form, "metal") === "silver" ? "silver" : "gold",
      declaredWeightGrams: readFormNumber(form, "declaredWeightGrams"),
      receivedWeightGrams: readFormNumber(form, "receivedWeightGrams"),
      customerInstruction: readFormText(form, "customerInstruction"),
      allocations: allocations
        .filter((allocation) => allocation.bankName.trim())
        .map((allocation) => ({
          bankId: allocation.bankId,
          bankName: allocation.bankName.trim(),
          allocatedGrams: Number(allocation.allocatedGrams),
        })),
    };

    try {
      const response = await fetch("/api/v1/assays", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.record) {
        setError(body?.message ?? "Сорьц бүртгэх үед алдаа гарлаа.");
        return;
      }

      onCreated(body.record);
    } catch {
      setError("Сүлжээний холболтыг шалгаад дахин оролдоно уу.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateAllocation(index: number, nextAllocation: BankAllocation) {
    setAllocations((currentAllocations) =>
      currentAllocations.map((allocation, allocationIndex) =>
        allocationIndex === index ? nextAllocation : allocation,
      ),
    );
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-panel" aria-modal="true" role="dialog" aria-labelledby="create-assay-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Хүлээн авах бүртгэл</p>
            <h2 id="create-assay-title">Шинэ сорьц бүртгэх</h2>
          </div>
          <button className="secondary-button" type="button" onClick={onClose}>
            Хаах
          </button>
        </div>

        <form className="assay-form" onSubmit={handleSubmit}>
          <div className="customer-choice">
            <div className="customer-choice-header">
              <span>Харилцагч</span>
              <div className="segmented-control" role="group" aria-label="Харилцагч сонгох төрөл">
                <button className={customerMode === "existing" ? "active" : ""} type="button" onClick={() => setCustomerMode("existing")}>
                  Бүртгэлтэй
                </button>
                <button className={customerMode === "new" ? "active" : ""} type="button" onClick={() => setCustomerMode("new")}>
                  Шинэ
                </button>
              </div>
            </div>
            {customerMode === "existing" ? (
              <label className="full-field">
                <span>Бүртгэлтэй харилцагч</span>
                <select
                  value={selectedCustomerId}
                  disabled={isCustomersLoading || customers.length === 0}
                  onChange={(event) => setSelectedCustomerId(event.currentTarget.value)}
                >
                  {customers.length === 0 ? <option value="">Харилцагчийн бүртгэл хоосон байна</option> : null}
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.displayName} ({customer.type === "individual" ? "Иргэн" : "Байгууллага"})
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="form-grid">
                <label>
                  <span>Харилцагчийн төрөл</span>
                  <select name="customerType">
                    <option value="individual">Иргэн</option>
                    <option value="legal_entity">Байгууллага</option>
                  </select>
                </label>
                <label>
                  <span>Харилцагчийн нэр</span>
                  <input name="customerName" required type="text" />
                </label>
                <label>
                  <span>Регистр / байгууллагын дугаар</span>
                  <input name="customerRegistrationNumber" type="text" />
                </label>
                <label>
                  <span>Имэйл</span>
                  <input name="customerEmail" type="email" />
                </label>
                <label>
                  <span>Утас</span>
                  <input name="customerPhone" inputMode="tel" type="text" />
                </label>
              </div>
            )}
          </div>

          <div className="form-grid">
            <label>
              <span>Металл</span>
              <select name="metal">
                <option value="gold">Алт</option>
                <option value="silver">Мөнгө</option>
              </select>
            </label>
            <label>
              <span>Мэдүүлсэн жин /гр/</span>
              <input min="0.0001" name="declaredWeightGrams" required step="0.0001" type="number" />
            </label>
            <label>
              <span>Хүлээн авсан жин /гр/</span>
              <input min="0.0001" name="receivedWeightGrams" required step="0.0001" type="number" />
            </label>
          </div>

          <label className="full-field">
            <span>Харилцагчийн заавар</span>
            <textarea name="customerInstruction" rows={3} placeholder="Жишээ: Хаан банк 70 гр, Голомт банк 56.45 гр" />
          </label>

          <div className="allocation-editor">
            <div className="allocation-header">
              <div>
                <p className="eyebrow">Банкны хуваарилалт</p>
                <strong>Нийт: {formatWeight(totalAllocated)}</strong>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setAllocations((currentAllocations) => [
                  ...currentAllocations,
                  activeBanks[0]
                    ? { bankId: activeBanks[0].id, bankName: activeBanks[0].name, allocatedGrams: 0 }
                    : { bankName: "", allocatedGrams: 0 },
                ])}
                disabled={activeBanks.length === 0}
              >
                Банк нэмэх
              </button>
            </div>

            {allocations.map((allocation, index) => (
              <div className="allocation-row" key={`${allocation.bankName}-${index}`}>
                <label>
                  <span>Банк</span>
                  <select
                    value={allocation.bankId ?? ""}
                    disabled={isBanksLoading || activeBanks.length === 0}
                    onChange={(event) =>
                      {
                        const bank = activeBanks.find((candidate) => candidate.id === event.currentTarget.value);
                        updateAllocation(index, {
                          ...allocation,
                          bankId: bank?.id,
                          bankName: bank?.name ?? "",
                        });
                      }
                    }
                  >
                    {activeBanks.length === 0 ? <option value="">Идэвхтэй банк бүртгээгүй байна</option> : null}
                    {activeBanks.map((bank) => (
                      <option key={bank.id} value={bank.id}>{bank.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Жин /гр/</span>
                  <input
                    min="0.0001"
                    step="0.0001"
                    type="number"
                    value={allocation.allocatedGrams || ""}
                    onChange={(event) =>
                      updateAllocation(index, {
                        ...allocation,
                        allocatedGrams: Number(event.currentTarget.value),
                      })
                    }
                  />
                </label>
                <button
                  className="secondary-button danger"
                  disabled={allocations.length === 1}
                  type="button"
                  onClick={() =>
                    setAllocations((currentAllocations) =>
                      currentAllocations.filter((_, allocationIndex) => allocationIndex !== index),
                    )
                  }
                >
                  Хасах
                </button>
              </div>
            ))}
          </div>

          {error ? <p className="login-error">{error}</p> : null}

          <div className="form-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Болих
            </button>
            <button className="primary-button" disabled={isSubmitting || (customerMode === "existing" && !selectedCustomerId) || activeBanks.length === 0} type="submit">
              {isSubmitting ? "Хадгалж байна..." : "Сорьц хадгалах"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function BullionIntakeView({
  batches,
  customers,
  error,
  isLoading,
  onCreated,
}: {
  batches: BullionIntakeBatchRecord[];
  customers: CustomerRecord[];
  error: string;
  isLoading: boolean;
  onCreated(record: BullionIntakeBatchRecord): void;
}) {
  const [metal, setMetal] = useState<MetalType>("gold");
  const [rows, setRows] = useState([{ analysisNo: "", bullionNo: "", grossWeightBeforeGrams: "", grossWeightAfterGrams: "", slagWeightGrams: "", sampleWeightMilligrams: "" }]);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateRow(index: number, key: string, value: string) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row));
  }
  async function submit(event: FormEvent<HTMLFormElement>, status: "draft" | "sample_taken") {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const payload: CreateBullionIntakeInput = {
      customerId: readFormText(form, "customerId"), metal, receivedAt: readFormText(form, "receivedAt"),
      initialBullionNumber: readFormText(form, "initialBullionNumber"), branchName: readFormText(form, "branchName"),
      province: readFormText(form, "province"), district: readFormText(form, "district"), dispatchReference: readFormText(form, "dispatchReference"),
      delta: readFormNumber(form, "delta"), status,
      items: rows.map((row) => ({ analysisNo: row.analysisNo, bullionNo: row.bullionNo, grossWeightBeforeGrams: Number(row.grossWeightBeforeGrams), grossWeightAfterGrams: optionalNumber(row.grossWeightAfterGrams), slagWeightGrams: optionalNumber(row.slagWeightGrams), sampleWeightMilligrams: optionalNumber(row.sampleWeightMilligrams) })),
    };
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/v1/bullion/intakes", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.record) throw new Error(body?.message ?? "Гулдмайн бүртгэл хадгалах үед алдаа гарлаа.");
      onCreated(body.record);
      setMessage(status === "sample_taken" ? "Дээж авахад бэлэн гулдмайн бүртгэл үүслээ." : "Ноорог гулдмайн бүртгэл хадгалагдлаа.");
      setRows([{ analysisNo: "", bullionNo: "", grossWeightBeforeGrams: "", grossWeightAfterGrams: "", slagWeightGrams: "", sampleWeightMilligrams: "" }]);
    } catch (submitError) { setMessage(submitError instanceof Error ? submitError.message : "Сүлжээний алдаа гарлаа."); }
    finally { setIsSubmitting(false); }
  }

  return <>
    <section className="panel bullion-panel">
      <div className="panel-header"><div><p className="eyebrow">Нэг хүлээн авалтад олон гулдмай</p><h2>{metal === "gold" ? "Алтан гулдмай хүлээн авах" : "Мөнгөн гулдмай хүлээн авах"}</h2></div><select aria-label="Металл" value={metal} onChange={(event) => setMetal(event.target.value as MetalType)}><option value="gold">Алт</option><option value="silver">Мөнгө</option></select></div>
      <form className="assay-form" onSubmit={(event) => submit(event, "draft")}>
        <div className="form-grid bullion-details">
          <label><span>Огноо</span><input name="receivedAt" defaultValue={new Date().toISOString().slice(0, 10)} type="date" /></label>
          <label><span>Харилцагч</span><select name="customerId" required disabled={isLoading}><option value="">Сонгоно уу</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</select></label>
          <label><span>Гулдмайн эхлэх дугаар</span><input name="initialBullionNumber" /></label>
          <label><span>Салбар</span><input name="branchName" /></label>
          <label><span>Аймаг, хот</span><input name="province" /></label>
          <label><span>Сум, дүүрэг</span><input name="district" /></label>
          <label><span>Гарал, хүсэл</span><input name="dispatchReference" /></label>
          <label><span>Делта</span><input name="delta" defaultValue="0" inputMode="decimal" /></label>
        </div>
        <div className="bullion-grid" role="table" aria-label="Гулдмайн мөрүүд"><div className="bullion-grid-head" role="row"><span>Шинжилгээ №</span><span>Гулдмай №</span><span>Хүлээн авсан жин /гр/</span><span>Дараах жин /гр/</span><span>Шлак /гр/</span><span>Дээжийн жин /мг/</span><span /></div>{rows.map((row, index) => <div className="bullion-grid-row" role="row" key={index}><input value={row.analysisNo} onChange={(event) => updateRow(index, "analysisNo", event.target.value)} /><input value={row.bullionNo} onChange={(event) => updateRow(index, "bullionNo", event.target.value)} required /><input value={row.grossWeightBeforeGrams} inputMode="decimal" onChange={(event) => updateRow(index, "grossWeightBeforeGrams", event.target.value)} required /><input value={row.grossWeightAfterGrams} inputMode="decimal" onChange={(event) => updateRow(index, "grossWeightAfterGrams", event.target.value)} /><input value={row.slagWeightGrams} inputMode="decimal" onChange={(event) => updateRow(index, "slagWeightGrams", event.target.value)} /><input value={row.sampleWeightMilligrams} inputMode="decimal" onChange={(event) => updateRow(index, "sampleWeightMilligrams", event.target.value)} /><button className="icon-button" type="button" aria-label="Мөр устгах" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>-</button></div>)}</div>
        <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setRows((current) => [...current, { analysisNo: "", bullionNo: "", grossWeightBeforeGrams: "", grossWeightAfterGrams: "", slagWeightGrams: "", sampleWeightMilligrams: "" }])}>Гулдмай нэмэх</button><span className="muted-text">Жин оруулах талбарт курсор байрлуулахад keyboard-wedge жин автоматаар орно.</span><button className="secondary-button" disabled={isSubmitting} type="button" onClick={(event) => { const form = event.currentTarget.form; if (form) void submit({ preventDefault: () => undefined, currentTarget: form } as FormEvent<HTMLFormElement>, "sample_taken"); }}>Дээж авах</button><button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? "Хадгалж байна..." : "Хадгалах"}</button></div>
        {error || message ? <p className={error || message.includes("алдаа") ? "login-error" : "success-message"}>{error || message}</p> : null}
      </form>
    </section>
    <section className="panel bullion-list"><div className="panel-header"><div><p className="eyebrow">Сүүлийн хүлээн авалт</p><h2>Гулдмайн бүртгэл</h2></div></div>{batches.length === 0 ? <p className="muted-text">Хадгалсан гулдмайн бүртгэл одоогоор байхгүй байна.</p> : <div className="record-table bullion-records"><div className="record-head"><span>№</span><span>Харилцагч</span><span>Металл</span><span>Ширхэг</span><span>Төлөв</span></div>{batches.map((batch) => <div className="record-row" key={batch.id}><strong>{batch.publicId}</strong><span>{batch.customerName}</span><span>{batch.metal === "gold" ? "Алт" : "Мөнгө"}</span><span>{batch.pieceCount}</span><span className="status-pill draft">{batch.status === "sample_taken" ? "Дээж авах" : "Ноорог"}</span></div>)}</div>}</section>
  </>;
}

function BullionExaminationView({ batches, error, isLoading }: { batches: BullionIntakeBatchRecord[]; error: string; isLoading: boolean }) {
  const items = batches.flatMap((batch) => batch.items.map((item) => ({ ...item, batch })));
  const [selectedItemId, setSelectedItemId] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>, status: "draft" | "submitted") {
    event.preventDefault(); setMessage(""); const form = new FormData(event.currentTarget); setIsSubmitting(true);
    const measurementLabels = ["Чек мөнгө", "Дээжийн үлдэгдэл жин", "Шинжилгээний хорогдол", "Королок, корточка"];
    const payload = { bullionItemId: selectedItemId, examinationNo: readFormText(form, "examinationNo"), sampleWeightGrams: readFormNumber(form, "sampleWeightGrams"), delta: readFormNumber(form, "delta"), status, goldResult: optionalNumber(readFormText(form, "goldResult")), silverResult: optionalNumber(readFormText(form, "silverResult")), reexaminationRequested: form.get("reexaminationRequested") === "on", notes: readFormText(form, "notes"), weightEntries: Array.from({ length: 5 }, (_, index) => ({ receivedWeightGrams: readFormNumber(form, `received-${index}`), calculation: readFormText(form, `calculation-${index}`) || "no", outputWeightGrams: readFormNumber(form, `output-${index}`) })), measurementEntries: measurementLabels.map((label, index) => ({ label, reading: readFormNumber(form, `reading-${index}`), goldAssay: optionalNumber(readFormText(form, `gold-${index}`)), silverAssay: optionalNumber(readFormText(form, `silver-${index}`)) })) };
    try { const response = await fetch("/api/v1/bullion/examinations", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload) }); const body = await response.json().catch(() => null); if (!response.ok) throw new Error(body?.message ?? "Шинжилгээ хадгалах үед алдаа гарлаа."); setMessage(status === "submitted" ? "Шинжилгээ эрхлэгчийн хяналтад илгээгдлээ." : "Шинжилгээний ноорог хадгалагдлаа."); } catch (submitError) { setMessage(submitError instanceof Error ? submitError.message : "Сүлжээний алдаа гарлаа."); } finally { setIsSubmitting(false); }
  }
  return <section className="panel bullion-panel"><div className="panel-header"><div><p className="eyebrow">Гулдмайн шинжилгээ</p><h2>Шинжилгээний дүн оруулах</h2></div></div><form className="assay-form" onSubmit={(event) => submit(event, "draft")}><div className="form-grid bullion-details"><label><span>Гулдмай</span><select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)} required disabled={isLoading}><option value="">Сонгоно уу</option>{items.map((item) => <option value={item.id} key={item.id}>{item.batch.publicId} / {item.bullionNo}</option>)}</select></label><label><span>Шинжилгээний №</span><input name="examinationNo" required /></label><label><span>Дээжийн жин /гр/</span><input name="sampleWeightGrams" inputMode="decimal" required /></label><label><span>Делта</span><input name="delta" defaultValue="0" inputMode="decimal" /></label></div><div className="examination-grid"><div><h3>Жингийн тооцоолол</h3>{Array.from({ length: 5 }, (_, index) => <div className="exam-row" key={index}><input name={`received-${index}`} defaultValue="0" inputMode="decimal" aria-label="Авсан жин" /><select name={`calculation-${index}`} aria-label="Бодлого"><option value="yes">Тийм</option><option value="no">Үгүй</option><option value="addition">Нэмэлт</option></select><input name={`output-${index}`} defaultValue="0" inputMode="decimal" aria-label="Гарсан жин" /></div>)}</div><div><h3>Хэмжилт</h3>{["Чек мөнгө", "Дээжийн үлдэгдэл жин", "Шинжилгээний хорогдол", "Королок, корточка"].map((label, index) => <div className="exam-row measurement" key={label}><span>{label}</span><input name={`reading-${index}`} defaultValue="0" inputMode="decimal" aria-label={`${label} үзүүлэлт`} /><input name={`gold-${index}`} defaultValue="0" inputMode="decimal" aria-label={`${label} алтны сорьц`} /><input name={`silver-${index}`} defaultValue="0" inputMode="decimal" aria-label={`${label} мөнгөний сорьц`} /></div>)}</div></div><div className="form-grid bullion-details"><label><span>Алтны сорьцын дүн</span><input name="goldResult" inputMode="decimal" /></label><label><span>Мөнгөний сорьцын дүн</span><input name="silverResult" inputMode="decimal" /></label><label className="checkbox-label"><input name="reexaminationRequested" type="checkbox" />Дахин шинжилгээ хийх</label><label><span>Тэмдэглэл</span><input name="notes" /></label></div><div className="form-actions"><button className="secondary-button" disabled={isSubmitting} type="button" onClick={(event) => { const form = event.currentTarget.form; if (form) void submit({ preventDefault: () => undefined, currentTarget: form } as FormEvent<HTMLFormElement>, "submitted"); }}>Шалгах</button><button className="primary-button" disabled={isSubmitting} type="submit">{isSubmitting ? "Хадгалж байна..." : "Хадгалах"}</button></div>{error || message ? <p className={error || message.includes("алдаа") ? "login-error" : "success-message"}>{error || message}</p> : null}</form></section>;
}

function CreateCustomerDialog({
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

          <p className="muted-text security-hint">
            Регистр, утас, имэйлийг одоогоор masked байдлаар хадгална. Бүрэн encryption нэмсний дараа raw contact мэдээлэл хадгалах боломжийг тусад нь нээнэ.
          </p>

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

function SettingsView({
  error,
  isLoading,
  onRefresh,
  users,
}: {
  error: string;
  isLoading: boolean;
  onRefresh(): void;
  users: ManagedUser[];
}) {
  const activeUsers = users.filter((user) => user.status === "active").length;
  const lockedUsers = users.filter((user) => user.status === "locked").length;
  const disabledUsers = users.filter((user) => user.status === "disabled").length;

  return (
    <>
      <section className="settings-summary" aria-label="Хэрэглэгчийн товч үзүүлэлт">
        <article className="stat-card blue">
          <span>Нийт хэрэглэгч</span>
          <strong>{isLoading ? "-" : users.length}</strong>
        </article>
        <article className="stat-card green">
          <span>Идэвхтэй</span>
          <strong>{isLoading ? "-" : activeUsers}</strong>
        </article>
        <article className="stat-card amber">
          <span>Түгжигдсэн</span>
          <strong>{isLoading ? "-" : lockedUsers}</strong>
        </article>
        <article className="stat-card slate">
          <span>Идэвхгүй</span>
          <strong>{isLoading ? "-" : disabledUsers}</strong>
        </article>
      </section>

      <section className="settings-grid">
        <article className="panel settings-main">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Супер админы хэсэг</p>
              <h2>Хэрэглэгчийн удирдлага</h2>
            </div>
            <div className="settings-actions">
              <button className="secondary-button" type="button" onClick={onRefresh} disabled={isLoading}>
                Шинэчлэх
              </button>
              <a className="primary-button" href="/users/invite">
                Хэрэглэгч урих
              </a>
            </div>
          </div>

          <p className="muted-text settings-intro">
            Одоогоор зөвхөн супер админ бүх байгууллагын хэрэглэгчийг харна. Админ нь зөвхөн өөрийн
            сорьцын төвийн хэрэглэгч, ажилбарын эрхийг удирдах түвшинд ажиллана.
          </p>

          {error ? <p className="login-error">{error}</p> : null}

          <div className="user-table" role="table" aria-label="Хэрэглэгчийн жагсаалт">
            <div className="user-row user-head" role="row">
              <span>Хэрэглэгч</span>
              <span>Байгууллага</span>
              <span>Эрх</span>
              <span>Төлөв</span>
              <span>MFA</span>
              <span>Сүүлд нэвтэрсэн</span>
            </div>

            {isLoading ? (
              <div className="empty-state">Хэрэглэгчийн мэдээлэл ачаалж байна...</div>
            ) : users.length === 0 && !error ? (
              <div className="empty-state">
                <strong>Хэрэглэгч бүртгэгдээгүй байна.</strong>
                <span>Эхний супер админ эсвэл урилгаар орсон хэрэглэгчид энд харагдана.</span>
              </div>
            ) : (
              users.map((user) => (
                <div className="user-row" role="row" key={user.id}>
                  <span>
                    <span className="user-name">{user.fullName}</span>
                    <span className="user-email">{user.email}</span>
                  </span>
                  <span>
                    <span>{user.organizationName}</span>
                    <span className="user-email">{organizationTypeLabels[user.organizationType]}</span>
                  </span>
                  <span>{roleLabels[user.role]}</span>
                  <span className={`status-pill user-status ${user.status}`}>{statusLabelsForUsers[user.status]}</span>
                  <span>{user.mfaEnabled ? "Идэвхтэй" : "Идэвхгүй"}</span>
                  <span>{formatDateTime(user.lastLoginAt)}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <aside className="panel settings-side">
          <div className="panel-header compact">
            <div>
              <p className="eyebrow">Тохиргооны бүтэц</p>
              <h2>Дараагийн хэсгүүд</h2>
            </div>
          </div>
          <div className="settings-list">
            <div>
              <span>Байгууллагын мэдээлэл</span>
              <p>Сорьцын төвийн нэр, код, холбоо барих мэдээлэл.</p>
            </div>
            <div>
              <span>Хамгаалалтын бодлого</span>
              <p>Session хугацаа, түгжих дүрэм, MFA шаардлага.</p>
            </div>
            <div>
              <span>Аудит ба хадгалалт</span>
              <p>Лог хадгалах хугацаа, экспорт, tamper-check тайлан.</p>
            </div>
          </div>
        </aside>
      </section>
    </>
  );
}

function summarizeBankAccess(records: AssayApiRecord[]): BankAccessSummary[] {
  const banks = new Map<string, BankAccessSummary>();

  for (const record of records) {
    for (const allocation of record.allocations) {
      const current = banks.get(allocation.bankName) ?? {
        bank: allocation.bankName,
        records: 0,
        grams: 0,
        permission: "Зөвхөн өөрт хуваарилсан",
      };

      current.records += 1;
      current.grams += allocation.allocatedGrams;
      banks.set(allocation.bankName, current);
    }
  }

  return [...banks.values()].sort((left, right) => right.grams - left.grams);
}

function buildBankAllocationRows(records: AssayApiRecord[]): BankAllocationRow[] {
  return records.flatMap((record) =>
    record.allocations.map((allocation) => ({
      id: `${record.id}-${allocation.bankName}`,
      recordId: record.id,
      customerName: record.customerName,
      bankName: allocation.bankName,
      metal: record.metal,
      allocatedGrams: allocation.allocatedGrams,
      status: record.status,
      receivedAt: record.receivedAt,
    })),
  );
}

function buildAuditEvents(records: AssayApiRecord[]): AuditEvent[] {
  return records.flatMap((record) => {
    const events: AuditEvent[] = [
      {
        id: `${record.id}-received`,
        title: `${record.id} сорьц бүртгэгдлээ`,
        description: `${record.customerName} харилцагчийн ${record.metal === "gold" ? "алт" : "мөнгө"} хүлээн авсан.`,
        meta: formatDateTime(record.receivedAt),
      },
    ];

    if (record.allocations.length > 0) {
      events.push({
        id: `${record.id}-allocations`,
        title: `${record.id} банкны хуваарилалт хадгалагдлаа`,
        description: formatAllocations(record.allocations),
        meta: formatDateTime(record.receivedAt),
      });
    }

    if (record.purityPercent !== null) {
      events.push({
        id: `${record.id}-result`,
        title: `${record.id} шинжилгээний дүн бүртгэгдлээ`,
        description: `${formatNumber(record.purityPercent)}% сорьц, ${record.fineWeightGrams === null ? "-" : formatWeight(record.fineWeightGrams)} цэвэр жин.`,
        meta: formatDateTime(record.receivedAt),
      });
    }

    if (record.status === "approved") {
      events.push({
        id: `${record.id}-approved`,
        title: `${record.id} дүн баталгаажлаа`,
        description: "Баталгаажсан дүн түгжигдэж, засвар зөвхөн шинэ хувилбараар хийгдэнэ.",
        meta: formatDateTime(record.receivedAt),
      });
    }

    return events;
  });
}

function formatAllocations(allocations: BankAllocation[]): string {
  if (allocations.length === 0) return "-";

  return allocations
    .map((allocation) => `${allocation.bankName} ${formatWeight(allocation.allocatedGrams)}`)
    .join(", ");
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

function calculateFineWeight(grossWeightGrams: number, purityPercent: number): number {
  return Number(((grossWeightGrams * purityPercent) / 100).toFixed(4));
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

function readFormNumber(form: FormData, key: string): number {
  const value = form.get(key);
  return typeof value === "string" ? Number(value) : 0;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getViewHeader(view: DashboardView): { eyebrow: string; title: string } {
  if (view === "assayRecords") {
    return {
      eyebrow: "Хүлээн авсан алт, мөнгөний бүртгэл",
      title: "Сорьцын бүртгэл",
    };
  }

  if (view === "bullionIntake") {
    return { eyebrow: "Алт, мөнгөн гулдмайн хүлээн авалт", title: "Гулдмай хүлээн авах" };
  }

  if (view === "customers") {
    return {
      eyebrow: "Иргэн, байгууллагын бүртгэл",
      title: "Харилцагчид",
    };
  }

  if (view === "assayResults") {
    return {
      eyebrow: "Лабораторийн дүн ба баталгаажуулалт",
      title: "Шинжилгээний дүн",
    };
  }

  if (view === "bullionExamination") {
    return { eyebrow: "Лабораторийн нарийвчилсан шинжилгээ", title: "Гулдмайн шинжилгээ" };
  }

  if (view === "bankAccess") {
    return {
      eyebrow: "Арилжааны банкны унших эрх",
      title: "Банк хуваарилалт",
    };
  }

  if (view === "banks") {
    return {
      eyebrow: "Хуваарилалтад ашиглах банкны лавлах",
      title: "Арилжааны банкууд",
    };
  }

  if (view === "auditLog") {
    return {
      eyebrow: "Өөрчлөлт ба хяналтын мөр",
      title: "Аудит лог",
    };
  }

  if (view === "settings") {
    return {
      eyebrow: "Эрх, хамгаалалтын тохиргоо",
      title: "Тохиргоо",
    };
  }

  return {
    eyebrow: "Алт, мөнгөний сорьцын бүртгэл",
    title: "Сорьцын төвийн удирдлага",
  };
}

function formatMaskedContact(customer: CustomerRecord): string {
  const parts = [customer.phoneMasked, customer.emailMasked].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "-";
}

function buildResultTimeline(item: AssayResultWorkItem) {
  const latestResult = item.latestResult;

  return [
    {
      label: "Сорьц хүлээн авсан",
      description: `${item.intakeOfficerName ?? "Хүлээн авах ажилтан"} сорьц бүртгэсэн.`,
      meta: formatDateTime(item.receivedAt),
      state: "done",
    },
    {
      label: "Шинжилгээний дүн",
      description: latestResult
        ? `${latestResult.enteredByName} ${latestResult.methodName} аргаар дүн оруулсан.`
        : "Химич дүн оруулах хүлээгдэж байна.",
      meta: latestResult?.submittedAt ? formatDateTime(latestResult.submittedAt) : "Хүлээгдэж байна",
      state: latestResult ? "done" : "current",
    },
    {
      label: "Эрхлэгчийн баталгаажуулалт",
      description: latestResult?.status === "approved"
        ? `${latestResult.approvedByName ?? "Эрхлэгч"} дүн баталгаажуулсан.`
        : latestResult?.status === "submitted"
          ? "Эрхлэгч хянаж батлах хүлээгдэж байна."
          : "Дүн ирсний дараа эрхлэгч хянана.",
      meta: latestResult?.approvedAt ? formatDateTime(latestResult.approvedAt) : "Хүлээгдэж байна",
      state: latestResult?.status === "approved" ? "done" : latestResult?.status === "submitted" ? "current" : "waiting",
    },
    {
      label: "Монголбанк руу илгээх",
      description: item.status === "bom_submitted" || item.status === "bom_confirmed"
        ? "Баталгаажсан дүн Монголбанк руу илгээгдсэн."
        : "BOM API хэсэг нэмэгдсэний дараа энд илгээсэн төлөв харагдана.",
      meta: item.status === "bom_submitted" || item.status === "bom_confirmed" ? statusLabels[item.status] : "Дараагийн шат",
      state: item.status === "bom_submitted" || item.status === "bom_confirmed" ? "done" : "waiting",
    },
    {
      label: "Банканд харагдах",
      description: item.status === "bank_assigned"
        ? "Арилжааны банк өөрт хуваарилсан хэмжээг харж байна."
        : "Зөвхөн хуваарилагдсан банк өөрийн граммын мэдээллийг харна.",
      meta: item.allocations.length > 0 ? formatAllocations(item.allocations) : "Хуваарилалтгүй",
      state: item.status === "bank_assigned" ? "done" : "waiting",
    },
  ] satisfies Array<{
    label: string;
    description: string;
    meta: string;
    state: "done" | "current" | "waiting";
  }>;
}

function buildAssayRecordTimeline(record: AssayApiRecord) {
  const resultPurity = record.purityPercent;
  const resultFineWeight = record.fineWeightGrams;
  const hasResult = resultPurity !== null && resultFineWeight !== null;
  const isManagerReview = record.status === "manager_review";
  const isApproved = [
    "approved",
    "bom_submitted",
    "bom_confirmed",
    "bank_assigned",
    "settlement_pending",
    "settled",
    "closed",
  ].includes(record.status);
  const isBomSubmitted = record.status === "bom_submitted" || record.status === "bom_confirmed";
  const isBankVisible = ["bank_assigned", "settlement_pending", "settled", "closed"].includes(record.status);
  const resultDescription = hasResult
    ? `${formatNumber(resultPurity)}% сорьц, ${formatWeight(resultFineWeight)} цэвэр жин бүртгэгдсэн.`
    : "Химич шинжилгээний дүн оруулах хүлээгдэж байна.";

  return [
    {
      label: "Сорьц хүлээн авсан",
      description: `${record.customerName} харилцагчийн ${record.metal === "gold" ? "алт" : "мөнгө"} бүртгэгдсэн.`,
      meta: formatDateTime(record.receivedAt),
      state: "done",
    },
    {
      label: "Банкны хуваарилалт",
      description: record.allocations.length > 0
        ? formatAllocations(record.allocations)
        : "Банкны хуваарилалт бүртгэгдээгүй байна.",
      meta: record.allocations.length > 0 ? "Хадгалагдсан" : "Хүлээгдэж байна",
      state: record.allocations.length > 0 ? "done" : "waiting",
    },
    {
      label: "Шинжилгээний дүн",
      description: resultDescription,
      meta: hasResult ? "Дүн бүртгэгдсэн" : "Хүлээгдэж байна",
      state: hasResult ? "done" : "current",
    },
    {
      label: "Эрхлэгчийн хяналт",
      description: isApproved
        ? "Эрхлэгч баталгаажуулж, дүн түгжигдсэн."
        : isManagerReview
          ? "Эрхлэгчийн баталгаажуулалт хүлээгдэж байна."
          : "Шинжилгээний дүн ирсний дараа эрхлэгч хянана.",
      meta: isApproved ? "Баталгаажсан" : isManagerReview ? "Хянагдаж байна" : "Хүлээгдэж байна",
      state: isApproved ? "done" : isManagerReview ? "current" : "waiting",
    },
    {
      label: "Монголбанк руу илгээх",
      description: isBomSubmitted
        ? "Баталгаажсан мэдээлэл Монголбанк руу илгээгдсэн."
        : "Баталгаажсан дүн дээр үндэслэн дараагийн интеграцийн алхам хийгдэнэ.",
      meta: isBomSubmitted ? statusLabels[record.status] : "Дараагийн шат",
      state: isBomSubmitted ? "done" : isApproved ? "current" : "waiting",
    },
    {
      label: "Банканд харагдах",
      description: isBankVisible
        ? "Арилжааны банк өөрт хуваарилагдсан мэдээллийг харж байна."
        : "Зөвхөн баталгаажсан болон хуваарилагдсан мэдээлэл банканд харагдана.",
      meta: isBankVisible ? statusLabels[record.status] : "Хүлээгдэж байна",
      state: isBankVisible ? "done" : "waiting",
    },
  ] satisfies Array<{
    label: string;
    description: string;
    meta: string;
    state: "done" | "current" | "waiting";
  }>;
}

function isSubmitMethod(value: string | undefined): value is SubmitAssayResultInput["methodName"] {
  return value === "XRF" || value === "Fire assay" || value === "ICP" || value === "Бусад";
}

const roleLabels: Record<UserRole, string> = {
  system_admin: "Супер админ",
  assay_admin: "Админ",
  intake_officer: "Хүлээн авах ажилтан",
  chemist: "Химич",
  lab_manager: "Лабораторийн эрхлэгч",
  bom_officer: "Монголбанкны ажилтан",
  commercial_bank_user: "Арилжааны банк",
  auditor: "Аудитор",
};

const statusLabelsForUsers: Record<UserStatus, string> = {
  invited: "Уригдсан",
  active: "Идэвхтэй",
  locked: "Түгжигдсэн",
  disabled: "Идэвхгүй",
};

const resultStatusLabels = {
  draft: "Дүн оруулах",
  submitted: "Эрхлэгч хянах",
  approved: "Баталгаажсан",
  superseded: "Шинэ хувилбартай",
  rejected: "Буцаасан",
} satisfies Record<AssayResultWorkItem["latestResult"] extends infer Result
  ? Result extends null
    ? never
    : Result extends { status: infer Status }
      ? Status
      : never
  : never, string>;

const organizationTypeLabels = {
  private_assay_center: "Хувийн сорьцын төв",
  government_assay_center: "Улсын сорьцын төв",
  bank_of_mongolia: "Монголбанк",
  commercial_bank: "Арилжааны банк",
  system_operator: "Систем оператор",
} satisfies Record<ManagedUser["organizationType"], string>;
