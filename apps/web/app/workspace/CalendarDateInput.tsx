"use client";

export function CalendarDateInput({ name, defaultValue, id }: { name: string; defaultValue: string; id?: string }) {
  return <input id={id} name={name} type="date" required defaultValue={defaultValue}
    className="calendar-date-input" inputMode="none"
    onClick={(event) => {
      if (typeof event.currentTarget.showPicker === "function") {
        event.preventDefault();
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
  />;
}
