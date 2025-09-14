// src/utils/parser.ts
/**
 * parseAmount menerima format ID:
 * "15rb", "15 rb", "15k", "15.000", "15,5rb", "5jt", "2 juta", juga minus.
 * Hasil dalam rupiah (integer).
 */
export function parseAmount(raw: string): number {
  if (!raw) return NaN;
  let s = raw.toLowerCase().trim();

  // buang label mata uang & spasi ganda
  s = s
    .replace(/\b(rp|idr)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Ambil angka + (opsional) unit yang menempel/berjarak
  // Contoh yang valid untuk grup:
  //  "15", "15.000", "15,5", + opsional "rb|ribu|k|jt|juta"
  const m = s.match(
    /^([+-]?(?:\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[.,]\d+)?)(?:\s*(juta|jt|ribu|rb|k))?$/i
  );
  if (!m) return NaN;

  let num = m[1].replace(/\./g, "").replace(/,/g, "."); // 15.250,75 -> 15250.75
  const unit = (m[2] || "").toLowerCase();

  let mult = 1;
  if (unit === "juta" || unit === "jt") mult = 1_000_000;
  else if (unit === "ribu" || unit === "rb" || unit === "k") mult = 1_000;

  const value = Number(num);
  if (Number.isNaN(value)) return NaN;

  return Math.round(value * mult);
}
