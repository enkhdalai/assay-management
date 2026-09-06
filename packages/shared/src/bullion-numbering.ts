export function formatBullionNumber(prefix: string, sequence: number): string {
  return prefix + String(sequence).padStart(4, "0");
}

export function previewBullionNumber(first: string, prefix: string, offset: number): string {
  return formatBullionNumber(prefix, Number(first.slice(prefix.length)) + offset);
}
