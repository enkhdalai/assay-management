import type { BullionWeightEntry } from "./bullion-types";

export const BULLION_CALCULATION_VERSION = "fire-assay-v1";
export const BULLION_SILVER_CALCULATION_VERSION = "silver-titration-v1";

export type SilverAssayMethod = "rhodanometric" | "titrimetric";

type SilverCalculationOptions = {
  method: SilverAssayMethod;
  titerMilligramsPerMilliliter: number;
  blankVolumeMilliliters?: number;
};

export function calculateSilverBullion(entries: BullionWeightEntry[], sampleWeightGrams: number, options: SilverCalculationOptions) {
  const errors: string[] = [];
  let received = 0;
  const included: number[] = [];
  const { method, titerMilligramsPerMilliliter, blankVolumeMilliliters } = options;
  if (!Number.isFinite(sampleWeightGrams) || sampleWeightGrams <= 0) errors.push("Дээжийн жинг зөв оруулна уу.");
  if (!Number.isFinite(titerMilligramsPerMilliliter) || titerMilligramsPerMilliliter <= 0) errors.push("Мөнгөний титрийг зөв оруулна уу.");
  const weightEntries = entries.map((entry, index) => {
    const initial = entry.receivedWeightGrams;
    const endpointVolume = entry.outputWeightGrams;
    received += Number.isFinite(initial) ? initial : 0;
    const row = { ...entry, goldAssay: undefined as number | undefined, silverAssay: undefined as number | undefined };
    if (initial === 0 && endpointVolume === 0 && entry.calculation === "no") return row;
    if (!Number.isFinite(initial) || initial <= 0 || !Number.isFinite(endpointVolume) || endpointVolume <= 0) {
      errors.push(`${index + 1}-р мөрийн дээжийн жин болон титрийн эзлэхүүнийг зөв оруулна уу.`);
      return row;
    }
    const reactedVolume = method === "rhodanometric" && (blankVolumeMilliliters ?? 0) > 0
      ? (blankVolumeMilliliters ?? 0) - endpointVolume
      : endpointVolume;
    if (!Number.isFinite(reactedVolume) || reactedVolume <= 0) {
      errors.push(`${index + 1}-р мөрийн төгсгөлийн эзлэхүүн хоосон туршилтаас бага байх ёстой.`);
      return row;
    }
    // The laboratory records titers in the conventional 1,000x scale (for example 5555.00).
    const fineness = (reactedVolume * (titerMilligramsPerMilliliter / 1000) / (initial * 1000)) * 1000;
    if (!Number.isFinite(fineness) || fineness < 0 || fineness > 1000) {
      errors.push(`${index + 1}-р мөрийн мөнгөний сорьц 0–1000 ‰ хооронд байх ёстой.`);
      return row;
    }
    row.silverAssay = fineness;
    if (entry.calculation !== "no") included.push(fineness);
    return row;
  });
  if (received > sampleWeightGrams + 1e-10) errors.push("Авсан жингийн нийлбэр дээжийн жингээс их байна.");
  if (!included.length) errors.push("Бодох мөрийг Тийм эсвэл Нэмэлт гэж сонгоно уу.");
  // The assay-center worksheet preserves per-row precision, then rounds the final average to a whole permille.
  const silverResult = included.length ? Math.round(included.reduce((sum, value) => sum + value, 0) / included.length) : undefined;
  return {
    weightEntries,
    errors,
    silverResult: errors.length ? undefined : silverResult,
  };
}

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
