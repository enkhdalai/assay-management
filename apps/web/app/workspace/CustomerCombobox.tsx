"use client";

import { useEffect, useId, useRef, useState } from "react";

export type IntakeCustomerOption = {
  id: string;
  displayName: string;
  type: "individual" | "legal_entity";
  registrationNumber: string | null;
  province: string | null;
  district: string | null;
  origin: string | null;
};

export function CustomerCombobox({ customers, value, onChange, inputId: suppliedInputId }: {
  customers: IntakeCustomerOption[];
  value: string;
  onChange(customer: IntakeCustomerOption | null): void;
  inputId?: string;
}) {
  const generatedInputId = useId();
  const inputId = suppliedInputId ?? generatedInputId;
  const root = useRef<HTMLDivElement>(null);
  const selected = customers.find((customer) => customer.id === value) ?? null;
  const selectedName = selected?.displayName ?? "";
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const normalized = query.trim().toLowerCase();
  const options = customers.filter((customer) => !normalized || `${customer.displayName} ${customer.registrationNumber ?? ""}`.toLowerCase().includes(normalized));
  function select(customer: IntakeCustomerOption) { onChange(customer); setQuery(customer.displayName); setOpen(false); }
  return <div className="customer-combobox" ref={root}>
    <input id={inputId} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${inputId}-listbox`}
      placeholder="Нэр, регистрээр хайх" value={open ? query : selectedName || query} onFocus={() => { setQuery(selectedName || query); setOpen(true); }}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); if (selected && event.target.value !== selected.displayName) onChange(null); }}
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "Enter" && options.length === 1) { event.preventDefault(); select(options[0]); } }} required />
    {open && <div id={`${inputId}-listbox`} className="customer-combobox-options" role="listbox" aria-label="Харилцагч сонгох">
      {options.slice(0, 100).map((customer) => <button type="button" role="option" aria-selected={customer.id === value} key={customer.id} onMouseDown={(event) => event.preventDefault()} onClick={() => select(customer)}>
        <span>{customer.displayName}</span>{customer.registrationNumber && <small>{customer.registrationNumber}</small>}
      </button>)}
      {!options.length && <p>Харилцагч олдсонгүй.</p>}
    </div>}
  </div>;
}
