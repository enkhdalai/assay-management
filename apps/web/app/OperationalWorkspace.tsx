"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Building2, ChartNoAxesCombined, FlaskConical, KeyRound, LayoutDashboard, LogOut, Settings, UsersRound, UserRoundCog, Inbox } from "lucide-react";
import type { AuthenticatedUser } from "../../../packages/security/src/session";
import type { CustomerRecord, ManagedUser } from "../../../packages/shared/src";
import { canManageStaff, isCenterManager, workspaceRoleLabels } from "../../../packages/shared/src/workspace-access";
import { CreateCustomerDialog, CustomersView } from "./CustomerComponents";
import { InviteUserForm } from "./users/invite/InviteUserForm";
import { IntakeWorkspace } from "./workspace/IntakeWorkspace";
import { SampleWorkspace } from "./workspace/SampleWorkspace";
import { OrganizationsWorkspace } from "./workspace/OrganizationsWorkspace";
import { IntegrationSettingsWorkspace } from "./workspace/IntegrationSettingsWorkspace";
import { WorkspaceLoadingSkeleton } from "./workspace/WorkspaceLoadingSkeleton";
import type { OrganizationRecord } from "../../../packages/shared/src/organization-types";
import { api } from "./workspace/api";
import "./workspace/workspace.css";

type View = "dashboard" | "intake" | "samples" | "customers" | "staff" | "reports" | "organizations" | "settings";
const labels: Record<View, string> = { dashboard: "Нүүр", intake: "Гулдмай хүлээн авах", samples: "Дээж", customers: "Харилцагчид", staff: "Ажилтнууд", reports: "Тайлан", organizations: "Байгууллагууд", settings: "Тохиргоо" };
const viewIcons: Record<View, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  intake: Inbox,
  samples: FlaskConical,
  customers: UsersRound,
  staff: UserRoundCog,
  reports: ChartNoAxesCombined,
  organizations: Building2,
  settings: Settings,
};

function formatSessionCountdown(expiresAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const minuteSecond = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${minuteSecond}` : minuteSecond;
}

export function OperationalWorkspace() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [loggingOut, setLoggingOut] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [sessionNow, setSessionNow] = useState(() => Date.now());
  const [sessionPromptOpen, setSessionPromptOpen] = useState(false);
  const [sessionSecondsRemaining, setSessionSecondsRemaining] = useState(10);
  const [extendingSession, setExtendingSession] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const extensionRequested = useRef(false);
  const accountMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    api<{ user: AuthenticatedUser; expiresAt: string }>("/api/auth/me").then(({ user, expiresAt }) => {
      if (!active) return;
      setUser(user);
      const expiration = Date.parse(expiresAt);
      setSessionExpiresAt(Number.isFinite(expiration) ? expiration : null);
      const requested = new URLSearchParams(window.location.search).get("view");
      setView(user.role === "chemist" ? "samples" : isCenterManager(user.role) && requested === "staff" ? "staff" : isCenterManager(user.role) ? "dashboard" : "intake");
    }).catch((error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);
  const logout = useCallback(async () => {
    setLoggingOut(true);
    try { await api("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }
    catch (error) { setError(error instanceof Error ? error.message : "Гарах үед алдаа гарлаа."); setLoggingOut(false); }
  }, []);
  const extendSession = useCallback(async () => {
    extensionRequested.current = true;
    setExtendingSession(true);
    try {
      const { expiresAt } = await api<{ expiresAt: string }>("/api/auth/session/extend", { method: "POST" });
      const expiration = Date.parse(expiresAt);
      if (!Number.isFinite(expiration)) throw new Error("Сессийн хугацааг шинэчлэх боломжгүй байна.");
      setSessionExpiresAt(expiration);
      setSessionPromptOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Сессийн хугацааг шинэчлэх боломжгүй байна.");
      await logout();
    } finally {
      setExtendingSession(false);
    }
  }, [logout]);
  useEffect(() => {
    if (!user || !sessionExpiresAt) return;

    let promptTimer: number | undefined;
    let logoutTimer: number | undefined;
    let countdownTimer: number | undefined;
    const endSession = () => { void logout(); };
    const showExtensionPrompt = () => {
      extensionRequested.current = false;
      setSessionSecondsRemaining(10);
      setSessionPromptOpen(true);
      const deadline = Date.now() + 10_000;
      countdownTimer = window.setInterval(() => setSessionSecondsRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))), 250);
      logoutTimer = window.setTimeout(() => {
        if (!extensionRequested.current) endSession();
      }, 10_000);
    };

    const remaining = sessionExpiresAt - Date.now();
    if (remaining <= 0) endSession();
    else promptTimer = window.setTimeout(showExtensionPrompt, Math.max(0, remaining - 60_000));

    return () => {
      if (promptTimer) window.clearTimeout(promptTimer);
      if (logoutTimer) window.clearTimeout(logoutTimer);
      if (countdownTimer) window.clearInterval(countdownTimer);
    };
  }, [logout, sessionExpiresAt, user]);
  useEffect(() => {
    if (!sessionExpiresAt) return;

    setSessionNow(Date.now());
    const timer = window.setInterval(() => setSessionNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [sessionExpiresAt]);
  useEffect(() => {
    if (!accountMenuOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!accountMenu.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountMenuOpen]);
  const manager = user && isCenterManager(user.role);
  const allowed = user && (manager || user.role === "chemist" || user.role === "intake_officer");
  const views: View[] = manager ? ["dashboard", "intake", "samples", "customers", "staff", "reports"] : user?.role === "chemist" ? ["samples"] : ["intake"];
  if (user?.role === "system_admin") views.push("organizations", "settings");
  return <div className={`workspace-shell ${manager ? "with-navigation" : ""}`}>
    {manager && <aside className="workspace-nav"><a className="workspace-brand" href="/"><img src="/favicon.svg" alt="" width="42" height="42" /><span>Сорьцын төв</span></a>
      <nav aria-label="Үндсэн цэс">{views.map((item) => { const Icon = viewIcons[item]; return <button type="button" key={item} aria-current={view === item ? "page" : undefined} onClick={() => { setView(item); setError(""); }}><Icon aria-hidden="true" size={18} strokeWidth={1.9} /><span>{labels[item]}</span></button>; })}</nav>
      <p className="workspace-nav-footer">Сорьцын төвийн удирдлага</p>
    </aside>}
    <main className="workspace-main">
      <header className="workspace-header"><div>{!manager && <img src="/favicon.svg" alt="" width="36" height="36" />}<h1>{user && allowed ? user.role === "chemist" ? "Алт, мөнгөн гулдмайн шинжилгээ" : labels[view] : "Сорьцын төвийн удирдлага"}</h1></div>
        {user && <div className="workspace-account">{sessionExpiresAt && <span className="session-timer" aria-label={`Сесс дуусах хүртэл ${formatSessionCountdown(sessionExpiresAt, sessionNow)}`}>Холболт салгах: <strong>{formatSessionCountdown(sessionExpiresAt, sessionNow)}</strong></span>}<div className="workspace-account-menu" ref={accountMenu}><button className="workspace-avatar" type="button" onClick={() => setAccountMenuOpen((open) => !open)} aria-label="Хэрэглэгчийн цэс" aria-expanded={accountMenuOpen} aria-haspopup="menu">{user.fullName.trim().charAt(0).toLocaleUpperCase()}</button>{accountMenuOpen && <div className="workspace-account-dropdown" role="menu"><div className="workspace-account-summary"><strong>{user.fullName}</strong><span>{workspaceRoleLabels[user.role] ?? user.role}</span></div><button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setChangePasswordOpen(true); }}><KeyRound aria-hidden="true" size={17} />Нууц үг солих</button><button type="button" role="menuitem" onClick={() => { setAccountMenuOpen(false); setAccountSettingsOpen(true); }}><Settings aria-hidden="true" size={17} />Бүртгэлийн тохиргоо</button><button type="button" role="menuitem" className="account-menu-logout" onClick={logout} disabled={loggingOut}><LogOut aria-hidden="true" size={17} />Гарах</button></div>}</div></div>}
      </header>
      <div className="workspace-content-frame">
        {error && <p role="alert" className="login-error">{error}</p>}
        {!user && !error && <WorkspaceLoadingSkeleton variant="page" />}
        {user && !allowed && <p>Таны эрхэд зориулсан портал одоогоор нээгдээгүй байна.</p>}
        {user && allowed && <>
        {manager && view === "dashboard" && <DashboardWorkspace />}
        {view === "intake" && <IntakeWorkspace manager={!!manager} />}
        {view === "samples" && <SampleWorkspace manager={!!manager} centerType={user.organizationType} />}
        {manager && view === "customers" && <CustomerWorkspace showAssayCenter={user.role === "system_admin"} />}
        {manager && view === "staff" && <StaffWorkspace user={user} />}
        {user.role === "system_admin" && view === "organizations" && <OrganizationsWorkspace />}
        {user.role === "system_admin" && view === "settings" && <IntegrationSettingsWorkspace />}
        {manager && view === "reports" && <ReportsWorkspace organizationName={user.role === "system_admin" ? "Бүх төв" : user.organizationName} />}
        </>}
      </div>
    </main>
    {sessionPromptOpen && <div className="session-extension-backdrop" role="presentation">
      <section className="session-extension-dialog" role="dialog" aria-modal="true" aria-labelledby="session-extension-title">
        <h2 id="session-extension-title">Сессийн хугацаа дуусах гэж байна</h2>
        <p>Таны сесс нэг минутын дараа дуусна. Үргэлжлүүлэх үү?</p>
        <p className="session-extension-countdown">Хариу өгөх хугацаа: {sessionSecondsRemaining} секунд</p>
        <div className="session-extension-actions">
          <button type="button" className="secondary-button" onClick={logout} disabled={extendingSession}>Гарах</button>
          <button type="button" className="primary-button" onClick={() => { void extendSession(); }} disabled={extendingSession}>{extendingSession ? "Шинэчилж байна..." : "Үргэлжлүүлэх"}</button>
        </div>
      </section>
    </div>}
    {changePasswordOpen && <ChangePasswordDialog onClose={() => setChangePasswordOpen(false)} />}
    {accountSettingsOpen && user && <AccountSettingsDialog user={user} onClose={() => setAccountSettingsOpen(false)} />}
  </div>;
}

function ChangePasswordDialog({ onClose }: { onClose(): void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) { setError("Шинэ нууц үг давтан оруулсан утгатай таарахгүй байна."); return; }

    setSaving(true);
    setError("");
    try {
      await api("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
      setSuccess(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Нууц үгийг шинэчлэх боломжгүй байна.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="account-dialog-backdrop" role="presentation"><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="change-password-title"><h2 id="change-password-title">Нууц үг солих</h2>{success ? <><p className="account-dialog-success">Нууц үг амжилттай шинэчлэгдлээ.</p><div className="account-dialog-actions"><button type="button" className="primary-button" onClick={onClose}>Хаах</button></div></> : <form onSubmit={submit}><label>Одоогийн нууц үг<input name="currentPassword" type="password" autoComplete="current-password" required disabled={saving} /></label><label>Шинэ нууц үг<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required disabled={saving} /></label><label>Шинэ нууц үг давтах<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required disabled={saving} /></label>{error && <p className="account-dialog-error" role="alert">{error}</p>}<div className="account-dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Болих</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Хадгалж байна..." : "Нууц үг солих"}</button></div></form>}</section></div>;
}

function AccountSettingsDialog({ user, onClose }: { user: AuthenticatedUser; onClose(): void }) {
  return <div className="account-dialog-backdrop" role="presentation"><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-settings-title"><h2 id="account-settings-title">Бүртгэлийн тохиргоо</h2><dl className="account-details"><div><dt>Нэр</dt><dd>{user.fullName}</dd></div><div><dt>Имэйл</dt><dd>{user.email}</dd></div><div><dt>Эрх</dt><dd>{workspaceRoleLabels[user.role] ?? user.role}</dd></div><div><dt>Байгууллага</dt><dd>{user.organizationName}</dd></div></dl><div className="account-dialog-actions"><button type="button" className="primary-button" onClick={onClose}>Хаах</button></div></section></div>;
}

type DashboardSummary = {
  goldReceivedToday: number;
  silverReceivedToday: number;
  withChemistCount: number;
  todayInExaminationCount: number;
  totalGoldGrams: number;
  totalSilverGrams: number;
  userCount: number;
  individualCustomers: number;
  companyCustomers: number;
};
type DashboardPeriod = "day" | "month" | "year";

const dashboardPeriods: Record<DashboardPeriod, { heading: string; possessive: string; detail: string }> = {
  day: { heading: "Өнөөдрийн тойм", possessive: "Өнөөдөр", detail: "Өнөөдрийн" },
  month: { heading: "Сарын тойм", possessive: "Энэ сар", detail: "Энэ сарын" },
  year: { heading: "Жилийн тойм", possessive: "Энэ жил", detail: "Энэ жилийн" },
};

const mass = (grams: number) => grams >= 1000
  ? `${(grams / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} кг`
  : `${grams.toLocaleString(undefined, { maximumFractionDigits: 2 })} гр`;

function DashboardWorkspace() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<DashboardPeriod>("day");
  const refresh = useCallback(() => {
    setLoading(true);
    return api<{ data: DashboardSummary }>(`/api/v1/reports/summary?period=${period}`)
      .then(({ data }) => { setSummary(data); setError(""); })
      .catch((error) => setError(error.message))
      .finally(() => setLoading(false));
  }, [period]);
  useEffect(() => { void refresh(); }, [refresh]);
  const copy = dashboardPeriods[period];
  const cards = summary ? [
    [`${copy.possessive} хүлээн авсан алт`, `${summary.goldReceivedToday} гулдмай`, `${copy.detail} бүртгэл`],
    [`${copy.possessive} хүлээн авсан мөнгө`, `${summary.silverReceivedToday} гулдмай`, `${copy.detail} бүртгэл`],
    ["Химич дээр", `${summary.withChemistCount} дээж`, "Одоогийн дуусаагүй шинжилгээ"],
    [`${copy.possessive} шинжилгээнд`, `${summary.todayInExaminationCount} дээж`, `${copy.detail} хүлээн авснаас`],
    [`${copy.possessive} алт`, mass(summary.totalGoldGrams), `${copy.detail} хүлээн авсан жин`],
    [`${copy.possessive} мөнгө`, mass(summary.totalSilverGrams), `${copy.detail} хүлээн авсан жин`],
    ["Хэрэглэгч", `${summary.userCount}`, `${copy.detail} бүртгүүлсэн ажилтан`],
    ["Хувь хүн", `${summary.individualCustomers}`, `${copy.detail} бүртгүүлсэн харилцагч`],
    ["Байгууллага", `${summary.companyCustomers}`, `${copy.detail} бүртгүүлсэн харилцагч`],
  ] as const : [];
  return <section className="workspace-section dashboard-workspace" aria-label="Үйл ажиллагааны тойм">
    <div className="dashboard-heading"><div><h2>{copy.heading}</h2><p>Хүлээн авалт, шинжилгээ болон харилцагчийн нэгдсэн мэдээлэл</p></div><div className="dashboard-actions"><select aria-label="Тоймын хугацаа" value={period} disabled={loading} onChange={(event) => setPeriod(event.target.value as DashboardPeriod)}><option value="day">Өнөөдөр</option><option value="month">Энэ сар</option><option value="year">Энэ жил</option></select><button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>Шинэчлэх</button></div></div>
    {error && <p className="login-error" role="alert">{error}</p>}
    {loading ? <WorkspaceLoadingSkeleton variant="cards" /> : <div className="dashboard-summary-grid">{cards.map(([label, value, detail]) => <article className="dashboard-summary-card" key={label}><p>{label}</p><strong>{value}</strong><small>{detail}</small></article>)}</div>}
  </section>;
}

function CustomerWorkspace({ showAssayCenter }: { showAssayCenter: boolean }) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(() => api<{ data: CustomerRecord[] }>("/api/v1/customers")
    .then(({ data }) => { setCustomers(data); setError(""); })
    .catch((error) => setError(error.message)).finally(() => setLoading(false)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <><CustomersView customers={customers} error={error} isLoading={loading} showAssayCenter={showAssayCenter} onRefresh={refresh} onOpenCreate={() => setCreating(true)} />
    {creating && <CreateCustomerDialog onClose={() => setCreating(false)} onCreated={() => { setCreating(false); void refresh(); }} />}</>;
}

function StaffWorkspace({ user }: { user: AuthenticatedUser }) {
  const [organizationRecords, setOrganizationRecords] = useState<OrganizationRecord[]>([]);
  const [staff, setStaff] = useState<ManagedUser[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [inviting, setInviting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [organizationId, setOrganizationId] = useState(user.organizationId);
  useEffect(() => {
    if (user.role === "system_admin") void api<{ data: OrganizationRecord[] }>("/api/v1/organizations")
      .then(({ data }) => {
        const assayCenters = data.filter((record) => record.type === "private_assay_center" || record.type === "government_assay_center");
        setOrganizationRecords(assayCenters);
        if (assayCenters.length) setOrganizationId((current) => assayCenters.some((record) => record.id === current) ? current : assayCenters[0].id);
      }).catch(error => setError(error.message));
  }, [user.role]);
  const refresh = useCallback(() => api<{ data: ManagedUser[] }>("/api/v1/users")
    .then(({ data }) => setStaff(data)).catch((error) => setError(error.message)).finally(() => setLoading(false)), []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return; setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/v1/users/${editing.id}`, { method: "PATCH", body: JSON.stringify(Object.fromEntries(form)) });
      setEditing(null); await refresh();
    } catch (error) { setError((error as Error).message); } finally { setSaving(false); }
  }
  const organizations = user.role === "system_admin"
    ? organizationRecords.map((record) => ({ id: record.id, name: record.name }))
    : [{ id: user.organizationId, name: user.organizationName }];
  return <section className="workspace-section">
    <div className="workspace-toolbar"><input aria-label="Ажилтан хайх" placeholder="Нэр, имэйлээр хайх" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="primary-button" type="button" onClick={() => { setError(""); setInviting(true); }}>Ажилтан урих</button></div>
    {error && <p className="login-error" role="alert">{error}</p>}
    {loading ? <WorkspaceLoadingSkeleton /> : <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Нэр</th><th>Имэйл</th><th>Эрх</th>{user.role === "system_admin" && <th>Төв</th>}<th>Төлөв</th><th>Үйлдэл</th></tr></thead><tbody>
      {staff.filter((person) => `${person.fullName} ${person.email}`.toLowerCase().includes(search.trim().toLowerCase())).map((person) => <tr key={person.id}><td>{person.fullName}</td><td>{person.email}</td><td>{workspaceRoleLabels[person.role] ?? person.role}</td>{user.role === "system_admin" && <td>{person.organizationName}</td>}<td>{person.status === "active" ? "Идэвхтэй" : person.status === "disabled" ? "Идэвхгүй" : person.status === "locked" ? "Түгжээтэй" : "Уригдсан"}</td><td>{canManageStaff(user, person) && <button className="secondary-button" type="button" onClick={() => { setError(""); setEditing(person); }}>Засах</button>}</td></tr>)}
    </tbody></table></div>}
    {inviting && <WorkspaceDialog title="Ажилтан урих" size="compact" onClose={() => setInviting(false)}>
      <InviteUserForm key={organizationId} isSuperAdmin={user.role === "system_admin"} organizationId={organizationId} organizations={organizations} onOrganizationChange={setOrganizationId} />
    </WorkspaceDialog>}
    {editing && <WorkspaceDialog title="Ажилтны мэдээлэл" size="compact" onClose={() => { if (!saving) setEditing(null); }}>
      <form className="login-form" onSubmit={save}><label>Овог, нэр<input name="fullName" minLength={2} maxLength={200} defaultValue={editing.fullName} required /></label>
        <label>Эрх<select name="role" defaultValue={editing.role}><option value="chemist">Химич</option><option value="intake_officer">Хайлагч</option></select></label>
        <label>Төлөв<select name="status" defaultValue={editing.status === "disabled" ? "disabled" : "active"}><option value="active">Идэвхтэй</option><option value="disabled">Идэвхгүй</option></select></label>
        <label>Өөрчлөлтийн шалтгаан<input name="reason" required minLength={3} maxLength={1000} /></label>
        {error && <p className="login-error" role="alert">{error}</p>}<button className="primary-button" disabled={saving} type="submit">Хадгалах</button>
      </form>
    </WorkspaceDialog>}
  </section>;
}

type ReportRow = { metal: string; bullionCount: number; sampleCount: number; receivedGrams: number; afterGrams: number; submittedCount: number };
function ReportsWorkspace({ organizationName }: { organizationName: string }) {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 8) + "01");
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api<{ data: ReportRow[] }>(`/api/v1/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(({ data }) => { if (active) setRows(data); }).catch((error) => { if (active) setError(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);
  return <section className="workspace-section report-sheet"><h2>{organizationName}</h2><div className="workspace-toolbar no-print">
    <label>Эхлэх огноо<input type="date" value={from} max={to} onChange={(event) => { setLoading(true); setError(""); setFrom(event.target.value); }} /></label>
    <label>Дуусах огноо<input type="date" value={to} min={from} onChange={(event) => { setLoading(true); setError(""); setTo(event.target.value); }} /></label>
    <button className="secondary-button" type="button" disabled={loading || !!error} onClick={() => window.print()}>Хэвлэх / PDF</button>
  </div><p>{from} - {to}</p>{error && <p className="login-error" role="alert">{error}</p>}
    {loading ? <WorkspaceLoadingSkeleton rows={3} /> : !error && <div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Металл</th><th>Гулдмай</th><th>Дээж</th><th>Хүлээн авсан /гр/</th><th>Хайлалтын дараах /гр/</th><th>Хяналтад илгээсэн</th></tr></thead><tbody>{rows.map((row) => <tr key={row.metal}><td>{row.metal === "gold" ? "Алт" : "Мөнгө"}</td><td>{row.bullionCount}</td><td>{row.sampleCount}</td><td>{row.receivedGrams.toLocaleString()}</td><td>{row.afterGrams.toLocaleString()}</td><td>{row.submittedCount}</td></tr>)}</tbody></table>{rows.length === 0 && <p>Энэ хугацаанд бүртгэл байхгүй байна.</p>}</div>}
  </section>;
}

export function WorkspaceDialog({ title, onClose, children, headerActions, titleBadge, size = "wide" }: { title: string; onClose(): void; children: React.ReactNode; headerActions?: React.ReactNode; titleBadge?: React.ReactNode; size?: "wide" | "compact" | "examination" }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialogRef} className={`workspace-dialog${size === "wide" ? "" : ` workspace-dialog-${size}`}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="workspace-dialog-heading"><div className="workspace-dialog-title"><h2>{title}</h2>{titleBadge}</div><div className="workspace-dialog-actions">{headerActions}<button type="button" className="secondary-button" onClick={onClose}>Хаах</button></div></div>{children}</dialog>;
}
