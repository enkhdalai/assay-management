"use client";

export function CalendarDateInput({ name, defaultValue, id, value, onChange, disabled = false }: {
  name: string; defaultValue?: string; id?: string; value?: string; onChange?: (value: string) => void; disabled?: boolean;
}) {
  return <input id={id} name={name} type="date" required defaultValue={defaultValue} value={value} disabled={disabled}
    className="calendar-date-input" inputMode="none"
    onClick={(event) => {
      if (typeof event.currentTarget.showPicker === "function") {
        event.currentTarget.showPicker();
      }
    }}
    onKeyDown={(event) => {
      if (event.key === "Tab" || event.key === "Escape") return;
      event.preventDefault();
      if (event.key === "Enter" || event.key === " ") event.currentTarget.showPicker?.();
    }}
    onBeforeInput={(event) => event.preventDefault()}
    onPaste={(event) => event.preventDefault()}
    onDrop={(event) => event.preventDefault()}
    onChange={(event) => onChange?.(event.currentTarget.value)}
  />;
}
