// src/utils/parser.ts

/**
 * Mengubah string angka yang fleksibel (misal: "15rb", "20k", "100.000") menjadi angka.
 * @param amountStr String angka yang akan di-parse.
 * @returns Angka dalam format number, atau NaN jika tidak valid.
 */
export function parseAmount(amountStr: string): number {
  if (!amountStr) return NaN;

  // Ubah ke huruf kecil dan hapus spasi, koma, atau titik ribuan
  let cleanStr = amountStr.toLowerCase().replace(/[\s,.]/g, "");

  let multiplier = 1;

  // Cek akhiran 'k' atau 'rb'/'ribu'
  if (cleanStr.endsWith("k")) {
    multiplier = 1000;
    cleanStr = cleanStr.slice(0, -1);
  } else if (cleanStr.endsWith("rb") || cleanStr.endsWith("ribu")) {
    multiplier = 1000;
    // Hapus akhiran 'rb' atau 'ribu'
    cleanStr = cleanStr.replace(/rb|ribu$/, "");
  }

  const num = parseFloat(cleanStr);

  if (isNaN(num)) {
    return NaN;
  }

  return num * multiplier;
}
