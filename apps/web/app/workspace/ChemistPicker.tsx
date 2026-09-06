"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { AnonymousSample } from "../../../../packages/shared/src/bullion-types";
import { api } from "./api";
import { WorkspaceLoadingSkeleton } from "./WorkspaceLoadingSkeleton";

type Chemist = { id: string; fullName: string; status: string };

export function ChemistPicker({ sample, onSaved }: { sample: AnonymousSample; onSaved(): Promise<void> }) {
  const [chemists, setChemists] = useState<Chemist[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const menuId = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("resize", close); window.removeEventListener("scroll", close, true); };
  }, []);
  function positionMenu() {
    if (!menu.current || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 200), window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const opensAbove = below < 220 && above > below;
    Object.assign(menu.current.style, {
      width: `${width}px`, left: `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`,
      top: opensAbove ? "auto" : `${rect.bottom + 4}px`,
      bottom: opensAbove ? `${window.innerHeight - rect.top + 4}px` : "auto",
      maxHeight: `${Math.max(40, Math.min(220, opensAbove ? above : below))}px`,
    });
    void load();
  }
  function choose(chemistId: string | null) {
    menu.current?.hidePopover();
    trigger.current?.focus();
    void assign(chemistId);
  }
  const editable = ["pending", "draft"].includes(sample.status);
  async function load() {
    if (loaded || loading) return;
    setLoading(true); setError("");
    try {
      const result = await api<{ data: Chemist[] }>(`/api/v1/bullion/intakes/${sample.batchId}/chemists`);
      setChemists(result.data); setLoaded(true);
    } catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  }
  async function assign(chemistId: string | null) {
    if ((sample.assignedChemistId ?? null) === chemistId) return;
    setSaving(true); setError("");
    try {
      await api(`/api/v1/bullion/intakes/${sample.batchId}/assignment`, { method: "PATCH", body: JSON.stringify({
        itemId: sample.id, chemistId, expectedChemistId: sample.assignedChemistId ?? null,
      }) });
      await onSaved();
    } catch (error) { setError((error as Error).message); }
    finally { setSaving(false); }
  }
  if (!sample.batchId || !editable) return <span>{sample.assignedChemistName || "Химич хуваарилаагүй"}</span>;
  return <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <div className="chemist-picker">
      <button ref={trigger} type="button" className="chemist-picker-trigger" popoverTarget={menuId} onClick={positionMenu} aria-label={`Шинжилгээ ${sample.analysisNo} химич сонгох`}>
        {sample.assignedChemistId && <Check size={16} aria-hidden="true" />}
        <span>{sample.assignedChemistName || "Химич хуваарилаагүй"}</span><ChevronDown size={16} aria-hidden="true" />
      </button>
      <div ref={menu} id={menuId} popover="auto" className="chemist-options chemist-popover" role="group" aria-label="Химичид">
        <button type="button" aria-pressed={!sample.assignedChemistId} disabled={saving} onClick={() => choose(null)}><Check size={16} aria-hidden="true" style={{ visibility: sample.assignedChemistId ? "hidden" : "visible" }} /><span>Хуваарилахгүй</span></button>
        {chemists.map((chemist) => <button key={chemist.id} type="button" aria-pressed={sample.assignedChemistId === chemist.id}
          disabled={saving || chemist.status !== "active"} onClick={() => choose(chemist.id)}><Check size={16} aria-hidden="true" style={{ visibility: sample.assignedChemistId === chemist.id ? "visible" : "hidden" }} />
          <span>{chemist.fullName}{chemist.status !== "active" ? " (идэвхгүй)" : ""}</span></button>)}
        {loading && <WorkspaceLoadingSkeleton variant="inline" />}
        {loaded && !chemists.length && <span>Химич олдсонгүй.</span>}
      </div>
    </div>
    {error && <p role="alert" className="login-error">{error}</p>}
  </div>;
}
