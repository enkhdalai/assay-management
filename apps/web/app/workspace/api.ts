export async function api<T = { ok: boolean }>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Нэвтрэх шаардлагатай.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const requestId = typeof body?.requestId === "string" ? ` (ID: ${body.requestId})` : "";
    throw new Error(`${body?.message || "Хүсэлтийг гүйцэтгэх боломжгүй байна."}${requestId}`);
  }
  return body as T;
}
