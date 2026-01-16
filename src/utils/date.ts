import { formatInTimeZone } from "date-fns-tz";

const TZ = "Asia/Jakarta";

const MONTHS: Record<string, number> = {
  jan: 1,
  januari: 1,
  feb: 2,
  februari: 2,
  mar: 3,
  maret: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  ags: 8,
  agu: 8,
  agust: 8,
  agustus: 8,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  october: 10,
  oktober: 10,
  oct: 10,
  nov: 11,
  november: 11,
  des: 12,
  dec: 12,
  desember: 12,
  december: 12,
};

function ts(d: Date) {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd HH:mm:ss");
}

function makeDate(y: number, m: number, d: number, hh = 0, mm = 0) {
  const date = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  return date;
}

/**
 * Mencari tanggal di awal string:
 *  - dd/mm/yy[yy] atau dd-mm-yy[yy]
 *  - contoh: "03/09/25 cebok 15rb ..." atau "3-9-2025 makan 15k ..."
 *
 * Return:
 *  - timestamp: string "yyyy-MM-dd HH:mm:ss" (Asia/Jakarta)
 *    * jika ada tanggal di depan → pakai tanggal tsb + jam-menit-detik SEKARANG (WIB)
 *    * jika tidak ada → tanggal & waktu SEKARANG (WIB)
 *  - rest: sisa teks setelah tanggal (atau teks asli jika tidak ada tanggal)
 */
export function parseDateAtBeginning(input: string): {
  timestamp: string;
  rest: string;
} {
  const text = (input || "").trim();

  // cocokan tanggal di awal
  const m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b\s*(.*)$/s);
  const now = new Date();

  if (!m) {
    // tidak ada tanggal → timestamp sekarang (WIB)
    return {
      timestamp: formatInTimeZone(now, "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss"),
      rest: text,
    };
  }

  let [, dStr, mStr, yStr, rest] = m;
  const d = parseInt(dStr, 10);
  const mo = parseInt(mStr, 10);
  let y = parseInt(yStr, 10);
  if (yStr.length === 2) y += 2000;

  // validasi sederhana
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    // tanggal tidak valid → anggap tidak ada tanggal
    return {
      timestamp: formatInTimeZone(now, "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss"),
      rest: text,
    };
  }

  // ambil jam-menit-detik WIB saat ini supaya user lihat urutan log-nya wajar
  const timeNowWIB = formatInTimeZone(now, "Asia/Jakarta", "HH:mm:ss");
  const yyyy = String(y).padStart(4, "0");
  const mm = String(mo).padStart(2, "0");
  const dd = String(d).padStart(2, "0");

  return {
    timestamp: `${yyyy}-${mm}-${dd} ${timeNowWIB}`,
    rest: (rest || "").trim(),
  };
}

/* ======================================================================
   Tambahan untuk /riwayat: parsing argumen bulan/tahun & bikin nama sheet
   ====================================================================== */

/** Ubah (month 1..12, year) menjadi nama sheet seperti "Sep 2025" */
export function sheetNameFromMonthYear(month: number, year: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString("id-ID", { month: "short", year: "numeric" });
}

/** Parse "03/25", "03-25", "09/2025", "sep 2025", "september 2025", dll. */
export function parseMonthYearArg(
  input: string
): { month: number; year: number } | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase();

  // Bentuk numerik: mm/yy, mm-yy, mm/yyyy, mm-yyyy
  let m = raw.match(/^(\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let month = parseInt(m[1], 10);
    let year = parseInt(m[2], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12) return { month, year };
    return null;
  }

  // Nama bulan + tahun (id/en)
  m = raw.match(/^([a-z\u00C0-\u024F]+)\s+(\d{2,4})$/i);
  if (m) {
    const name = m[1];
    let year = parseInt(m[2], 10);
    if (year < 100) year += 2000;
    const key = (MONTHS[name] ? name : name.slice(0, 3)) as keyof typeof MONTHS;
    const month = MONTHS[key];
    if (month && month >= 1 && month <= 12) return { month, year };
  }

  return null;
}

/** Konversi nilai timestamp dari Google Sheets (serial number atau string) -> string WIB enak dibaca */
export function formatSheetTimestampForDisplay(v: unknown): string {
  try {
    if (typeof v === "number" && Number.isFinite(v)) {
      // Google Sheets serial date: day 0 = 1899-12-30 (UTC)
      const base = Date.UTC(1899, 11, 30, 0, 0, 0); // 1899-12-30
      const ms = v * 24 * 60 * 60 * 1000;
      const d = new Date(base + ms);
      return formatInTimeZone(d, TZ, "dd MMM yyyy, HH:mm:ss");
    }

    const s = String(v ?? "").trim();
    if (!s) return "-";
    if (typeof v === 'object') return JSON.stringify(v);

    // Jika string "yyyy-MM-dd HH:mm:ss" (atau tanpa waktu)
    const m = s.match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (m) {
      const [, ys, ms_, ds, hs = "00", mins = "00", ss = "00"] = m;
      const y = parseInt(ys, 10);
      const mo = parseInt(ms_, 10);
      const d = parseInt(ds, 10);
      const h = parseInt(hs, 10);
      const mi = parseInt(mins, 10);
      const se = parseInt(ss, 10);
      const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
      return formatInTimeZone(dt, TZ, "dd MMM yyyy, HH:mm:ss");
    }

    // fallback: tampilkan apa adanya
    return s;
  } catch {
    return String(v ?? "");
  }
}
