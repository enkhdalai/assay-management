import type { BullionWeightEntry } from "./bullion-types";

export const BULLION_CALCULATION_VERSION = "fire-assay-v1";

export function calculateBullion(entries: BullionWeightEntry[], sampleWeightGrams: number, deltaMilligrams: number) {
  const errors: string[] = [];
  let received = 0, output = 0;
  const gold: number[] = [], additions: number[] = [];
  const weightEntries = entries.map((entry, index) => {
    const { receivedWeightGrams: initial, outputWeightGrams: recovered } = entry;
    received += Number.isFinite(initial) ? initial : 0;
    output += Number.isFinite(recovered) ? recovered : 0;
    const row = { ...entry, goldAssay: undefined as number | undefined };
    if (initial === 0 && recovered === 0 && entry.calculation === "no") return row;
    if (!Number.isFinite(initial) || !Number.isFinite(recovered) || initial <= 0 || recovered <= 0) {
      errors.push(`${index + 1}-р мөрийн авсан болон гарсан жинг зөв оруулна уу.`);
      return row;
    }
    // Stored weights are grams; the laboratory's signed delta is milligrams.
    const fineness = ((recovered + deltaMilligrams / 1000) / initial) * 1000;
    if (!Number.isFinite(fineness) || fineness < 0 || fineness > 1000) {
      errors.push(`${index + 1}-р мөрийн сорьц 0–1000 ‰ хооронд байх ёстой.`);
      return row;
    }
    row.goldAssay = fineness;
    if (entry.calculation === "yes") gold.push(fineness);
    if (entry.calculation === "addition") additions.push(fineness);
    return row;
  });
  if (!Number.isFinite(sampleWeightGrams) || sampleWeightGrams <= 0 || !Number.isFinite(deltaMilligrams)) errors.push("Дээжийн жин эсвэл делта буруу байна.");
  if (received > sampleWeightGrams + 1e-10) errors.push("Авсан жингийн нийлбэр дээжийн жингээс их байна.");
  if (output > received + 1e-10) errors.push("Гарсан жингийн нийлбэр авсан жингээс их байна.");
  if (!gold.length) errors.push("Алтны дүн бодох мөрийг Тийм гэж сонгоно уу.");
  if (additions.length > 1) errors.push("Олон Нэмэлт мөрийн тооцоолох дүрэм тохируулагдаагүй байна. Нэг мөр сонгоно уу.");
  const goldResult = gold.length ? gold.reduce((sum, value) => sum + value, 0) / gold.length : undefined;
  const silverResult = additions.length === 1 && goldResult != null ? additions[0] - goldResult : undefined;
  if (silverResult != null && (silverResult < 0 || silverResult > 1000)) errors.push("Мөнгөний сорьц 0–1000 ‰ хооронд байх ёстой.");
  return {
    weightEntries, errors,
    goldResult: errors.length ? undefined : goldResult,
    silverResult: errors.length ? undefined : silverResult,
    remainingMilligrams: (sampleWeightGrams - received) * 1000,
    lossMilligrams: (received - output) * 1000,
    returnedMilligrams: output * 1000,
  };
}
