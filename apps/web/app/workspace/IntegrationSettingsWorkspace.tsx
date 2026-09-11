"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PlugZap, RefreshCw, Save } from "lucide-react";
import { api } from "./api";
import { WorkspaceLoadingSkeleton } from "./WorkspaceLoadingSkeleton";
import type { OrganizationRecord } from "../../../../packages/shared/src/organization-types";

type IntegrationClient = {
  id: string;
  name: string;
  clientId: string;
  status: string;
  scopes: string[];
  allowedIpCidrs: string[];
  lastUsedAt: string | null;
  organizationName: string;
  organizationCode: string;
  organizationType: string;
};

export function IntegrationSettingsWorkspace() {
  const [clients, setClients] = useState<IntegrationClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [organizations, setOrganizations] = useState<OrganizationRecord[]>([]);
  const refresh = useCallback(() => api<{ data: IntegrationClient[] }>("/api/v1/integration-clients")
    .then(({ data }) => { setClients(data); setError(""); })
    .catch((error) => setError(error.message)).finally(() => setLoading(false)), []);
  useEffect(() => { void refresh(); void api<{ data: OrganizationRecord[] }>("/api/v1/organizations").then(({ data }) => setOrganizations(data)).catch((error) => setError(error.message)); }, [refresh]);

  return <section className="workspace-section integration-settings">
    <div className="workspace-section-heading"><div><h2>Гадаад API хамгаалалт</h2><p>Зөвхөн зөвшөөрөгдсөн IP хаяг эсвэл CIDR сүлжээнээс BOM болон арилжааны банкны API хандах боломжтой.</p></div>
      <button type="button" className="secondary-button" title="Шинэчлэх" aria-label="Шинэчлэх" disabled={loading} onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={18} /></button>
    </div>
    {error && <p role="alert" className="login-error">{error}</p>}
    {loading ? <WorkspaceLoadingSkeleton rows={3} /> : <>
      <MonPassLaunchTest />
      <EsignLaunchTest />
      <CreateIntegrationClient organizations={organizations} onCreated={(client) => setClients((current) => [...current, client])} />
      {clients.length === 0 ? <p className="empty-state">BOM эсвэл арилжааны банкны API client бүртгэгдээгүй байна.</p> : <div className="integration-client-list">
      {clients.map((client) => <IntegrationClientCard key={client.id} client={client} onSaved={(updated) => setClients((current) => current.map((entry) => entry.id === updated.id ? updated : entry))} />)}
      </div>}
    </>}
  </section>;
}

function MonPassLaunchTest() {
  const [connection, setConnection] = useState<"idle" | "connecting" | "connected" | "unavailable">("idle");
  function testLocalAgent() {
    setConnection("connecting");
    let opened = false;
    let settled = false;
    const socket = new WebSocket("wss://127.0.0.1:43871/socket");
    const finish = (next: "connected" | "unavailable") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      setConnection(next);
    };
    const timeout = window.setTimeout(() => { finish("unavailable"); socket.close(); }, 5000);
    socket.onopen = () => { opened = true; finish("connected"); socket.close(1000, "Connection test complete"); };
    socket.onerror = () => finish("unavailable");
    socket.onclose = () => { if (!opened) finish("unavailable"); };
  }
  return <section className="monpass-launch-test" aria-labelledby="monpass-launch-title">
    <div><p className="eyebrow">Тоон гарын үсгийн холболт</p><h3 id="monpass-launch-title">MonPass Client туршилт</h3>
      <p>Windows дээр MonPass Client суусан эсэхийг шалгана. Зөвхөн туршилтын мэдээлэл илгээнэ.</p></div>
    <div className="monpass-launch-actions">
      <button type="button" className="secondary-button" disabled={connection === "connecting"} onClick={testLocalAgent}><PlugZap size={18} />{connection === "connecting" ? "Холбогдож байна" : "Local agent шалгах"}</button>
      <code>WSS: wss://127.0.0.1:43871/socket</code>
    </div>
    {connection === "connected" && <p className="monpass-connection connected" role="status">MonPass local agent-т амжилттай холбогдлоо.</p>}
    {connection === "unavailable" && <p className="monpass-connection unavailable" role="alert">Холболт амжилтгүй боллоо. MonPass Client ажиллаж, token холбогдсон эсэхийг шалгана уу.</p>}
  </section>;
}

function EsignLaunchTest() {
  const [data, setData] = useState("assay-center-esign-test");
  const [connection, setConnection] = useState<"idle" | "connecting" | "waiting" | "connected" | "unavailable">("idle");
  const [result, setResult] = useState("");

  function signWithEsign() {
    const value = data.trim();
    if (!value) { setResult("Гарын үсэг зурах утгаа оруулна уу."); return; }
    if (value.length > 131072) { setResult("Утгын хэмжээ 131072 тэмдэгтээс хэтэрсэн байна."); return; }

    setConnection("connecting");
    setResult("");
    let receivedResponse = false;
    let socket: WebSocket | null = null;
    const timeout = window.setTimeout(() => {
      if (!receivedResponse) setConnection("unavailable");
      socket?.close();
    }, 60_000);
    const finish = () => window.clearTimeout(timeout);

    try {
      socket = new WebSocket("ws://127.0.0.1:59001");
      socket.onopen = () => {
        setConnection("waiting");
        socket?.send(JSON.stringify({ type: "055a3cb74cc69e86", data: value }));
      };
      socket.onmessage = (event) => {
        receivedResponse = true;
        finish();
        const response = typeof event.data === "string" ? event.data : "eSign Client хариу илгээлээ.";
        try { setResult(JSON.stringify(JSON.parse(response), null, 2)); }
        catch { setResult(response); }
        setConnection("connected");
        socket?.close(1000, "Response received");
      };
      socket.onerror = () => { if (!receivedResponse) { finish(); setConnection("unavailable"); } };
      socket.onclose = () => { if (!receivedResponse && connection !== "unavailable") { finish(); setConnection("unavailable"); } };
    } catch {
      finish();
      setConnection("unavailable");
    }
  }

  return <section className="monpass-launch-test" aria-labelledby="esign-launch-title">
    <div><p className="eyebrow">Тоон гарын үсгийн холболт</p><h3 id="esign-launch-title">TridumKey eSign туршилт</h3>
      <p>Токены ПИН болон сертификат сонгох цонх eSign Client дээр нээгдэнэ. Энэ туршилтын хариу серверт хадгалагдахгүй.</p></div>
    <label>Гарын үсэг зурах утга<textarea value={data} onChange={(event) => setData(event.target.value)} maxLength={131072} rows={3} disabled={connection === "connecting" || connection === "waiting"} /></label>
    <div className="monpass-launch-actions">
      <button type="button" className="secondary-button" disabled={connection === "connecting" || connection === "waiting"} onClick={signWithEsign}><PlugZap size={18} />{connection === "connecting" ? "Холбогдож байна" : connection === "waiting" ? "eSign Client дээр баталгаажуулна уу" : "eSign-аар гарын үсэг зурах"}</button>
      <code>WS: ws://127.0.0.1:59001</code>
    </div>
    {connection === "connected" && <p className="monpass-connection connected" role="status">eSign Client-ээс гарын үсгийн хариу ирлээ.</p>}
    {connection === "unavailable" && <p className="monpass-connection unavailable" role="alert">eSign Client-т холбогдож чадсангүй. Client ажиллаж, токен залгаатай эсэхийг шалгана уу.</p>}
    {result && <pre className="monpass-connection" aria-live="polite">{result}</pre>}
  </section>;
}function CreateIntegrationClient({ organizations, onCreated }: { organizations: OrganizationRecord[]; onCreated(client: IntegrationClient): void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const eligible = organizations.filter((organization) => organization.type === "bank_of_mongolia" || organization.type === "commercial_bank");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const organization = eligible.find((entry) => entry.id === form.get("organizationId"));
    const allowedIpCidrs = [...new Set(String(form.get("allowedIpCidrs") ?? "").split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean))];
    if (!organization) { setError("Байгууллага сонгоно уу."); return; }
    setSaving(true); setError("");
    try {
      const response = await api<{ data: IntegrationClient }>("/api/v1/integration-clients", { method: "POST", body: JSON.stringify({
        organizationId: organization.id, organizationType: organization.type, name: form.get("name"), clientId: form.get("clientId"), allowedIpCidrs,
      }) });
      onCreated(response.data); event.currentTarget.reset();
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <form className="integration-create-form" onSubmit={submit}><h3>Гадаад API client нэмэх</h3><div className="integration-form-grid">
    <label>Байгууллага<select name="organizationId" required defaultValue=""><option value="" disabled>Сонгоно уу</option>{eligible.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.type === "bank_of_mongolia" ? "Монголбанк" : "Арилжааны банк"}</option>)}</select></label>
    <label>Client нэр<input name="name" required minLength={2} maxLength={120} placeholder="BOM production API" /></label>
    <label>Client ID<input name="clientId" required minLength={4} maxLength={120} pattern="[A-Za-z0-9._:-]+" placeholder="bom-production-v1" /></label>
    <label>Эхний зөвшөөрөгдсөн IP / CIDR<textarea name="allowedIpCidrs" required rows={3} placeholder={"203.0.113.24\n198.51.100.0/28"} /></label>
  </div>{error && <p role="alert" className="login-error">{error}</p>}<button className="primary-button" type="submit" disabled={saving || eligible.length === 0}><Save size={18} />{saving ? "Үүсгэж байна" : "API client үүсгэх"}</button>{eligible.length === 0 && <p className="field-hint">Эхлээд Байгууллагууд цэсэнд Монголбанк эсвэл арилжааны банк бүртгэнэ үү.</p>}</form>;
}

function IntegrationClientCard({ client, onSaved }: { client: IntegrationClient; onSaved(client: IntegrationClient): void }) {
  const [value, setValue] = useState(client.allowedIpCidrs.join("\n"));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const type = client.organizationType === "bank_of_mongolia" ? "Монголбанк" : "Арилжааны банк";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const allowedIpCidrs = [...new Set(value.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean))];
    setSaving(true); setError(""); setSuccess("");
    try {
      const response = await api<{ data: IntegrationClient }>(`/api/v1/integration-clients/${client.id}/ip-allowlist`, {
        method: "PATCH", body: JSON.stringify({ allowedIpCidrs }),
      });
      setValue(response.data.allowedIpCidrs.join("\n"));
      onSaved(response.data); setSuccess("IP allowlist хадгалагдлаа.");
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  return <article className="integration-client-card">
    <header><div><h3>{client.organizationName}</h3><p>{type} · {client.name}</p></div><span className={`status-badge ${client.allowedIpCidrs.length ? "status-active" : "status-warning"}`}>{client.allowedIpCidrs.length ? "Хязгаарлагдсан" : "Хаалттай"}</span></header>
    <dl><div><dt>Client ID</dt><dd>{client.clientId}</dd></div><div><dt>Эрх</dt><dd>{client.scopes.join(", ") || "-"}</dd></div><div><dt>Сүүлд ашигласан</dt><dd>{client.lastUsedAt?.replace("T", " ").slice(0, 16) ?? "-"}</dd></div></dl>
    <form onSubmit={submit}><label>Зөвшөөрөгдсөн IP хаяг / CIDR<textarea aria-label={`${client.organizationName} IP allowlist`} value={value} onChange={(event) => setValue(event.target.value)} placeholder={"203.0.113.24\n198.51.100.0/28"} rows={4} disabled={saving} /></label>
      <p className="field-hint">Нэг мөрөнд нэг IPv4 хаяг эсвэл CIDR. Хоосон жагсаалт хадгалах боломжгүй.</p>
      {error && <p role="alert" className="login-error">{error}</p>}{success && <p className="settings-success">{success}</p>}
      <button className="primary-button" type="submit" disabled={saving}><Save size={18} />{saving ? "Хадгалж байна" : "IP allowlist хадгалах"}</button>
    </form>
  </article>;
}
