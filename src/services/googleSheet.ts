// src/services/googleSheet.ts
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import logger from "../logger";
import { withRetry } from "../utils/retry";

export interface TransactionRow {
  timestamp: string; // "yyyy-MM-dd HH:mm:ss" (Asia/Jakarta)
  type: "Pemasukan" | "Pengeluaran";
  category: string;
  amount: number;
  description: string;
}

function errMsg(e: any): string {
  return (
    e?.response?.data?.error?.message ||
    e?.response?.data?.message ||
    e?.message ||
    String(e)
  );
}

/** Nama sheet untuk bulan SEKARANG (dipakai untuk laporan/riwayat/budget) */
function getCurrentSheetName(): string {
  return new Date().toLocaleString("id-ID", {
    month: "short",
    year: "numeric",
  });
}

/** Nama sheet dari timestamp transaksi, contoh: "2025-03-10 08:40:00" -> "Mar 2025" */
function getSheetNameForTimestamp(ts: string): string {
  const [datePart] = ts.split(" "); // "yyyy-MM-dd"
  const [y, m] = datePart.split("-").map(Number);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agu",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  return `${months[(m || 1) - 1]} ${y}`;
}

function generateTxnId(existing: Set<string>): string {
  let id = "";
  do {
    const now = Date.now().toString(36);
    const rand = Math.floor(Math.random() * 1e6).toString(36);
    id = (now + rand).slice(-8);
  } while (existing.has(id));
  return id;
}

async function getSheetIdByTitle(
  auth: OAuth2Client,
  spreadsheetId: string,
  sheetName: string
): Promise<number | null> {
  const sheets = google.sheets({ version: "v4", auth });
  const resp = await withRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId })
  );
  const sheet = resp.data.sheets?.find(
    (s) => s.properties?.title === sheetName
  );
  return sheet?.properties?.sheetId ?? null;
}

/** Pastikan tab bulan & header A1:F1 ada; backfill ID di kolom F untuk baris lama */
async function ensureSheetAndIds(
  auth: OAuth2Client,
  spreadsheetId: string,
  sheetName: string
): Promise<void> {
  const sheets = google.sheets({ version: "v4", auth });

  // coba baca header
  let header: string[] | null = null;
  try {
    const hdr = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:F1`,
      })
    );
    header = (hdr.data.values?.[0] as string[]) || null;
  } catch (e: any) {
    if (/Unable to parse range/i.test(errMsg(e))) {
      // sheet belum ada → buat
      const add = await withRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: sheetName } } }],
          },
        })
      );
      const sheetId = add.data.replies?.[0]?.addSheet?.properties?.sheetId;

      await withRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              ["Tanggal", "Tipe", "Kategori", "Jumlah", "Deskripsi", "ID"],
            ],
          },
        })
      );

      if (sheetId != null) {
        await withRetry(() =>
          sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [
                {
                  updateSpreadsheetProperties: {
                    properties: { timeZone: "Asia/Jakarta" },
                    fields: "timeZone",
                  },
                },
                {
                  repeatCell: {
                    range: { sheetId, startColumnIndex: 0, endColumnIndex: 1 },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: "DATE_TIME",
                          pattern: "dd MMM yyyy, HH:mm:ss",
                        },
                      },
                    },
                    fields: "userEnteredFormat.numberFormat",
                  },
                },
                {
                  repeatCell: {
                    range: { sheetId, startColumnIndex: 3, endColumnIndex: 4 },
                    cell: {
                      userEnteredFormat: {
                        numberFormat: {
                          type: "CURRENCY",
                          pattern: '"Rp"#,##0',
                        },
                      },
                    },
                    fields: "userEnteredFormat.numberFormat",
                  },
                },
              ],
            },
          })
        );
      }
      return;
    }
    throw e;
  }

  // pastikan header punya kolom ID
  const want = ["Tanggal", "Tipe", "Kategori", "Jumlah", "Deskripsi", "ID"];
  if (
    !header ||
    header.length !== want.length ||
    header.some(
      (v, i) =>
        (v ?? "").toString().trim().toLowerCase() !== want[i].toLowerCase()
    )
  ) {
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [want] },
      })
    );
  }

  // backfill ID yang kosong
  const all = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:F`,
      valueRenderOption: "UNFORMATTED_VALUE",
    })
  );
  const rows: any[][] = all.data.values || [];
  if (!rows.length) return;

  const existing = new Set<string>();
  rows.forEach((r) => {
    const id = (r[5] ?? "").toString().trim();
    if (id) existing.add(id);
  });

  const updates: { rowIndex: number; id: string }[] = [];
  rows.forEach((r, i) => {
    const id = (r[5] ?? "").toString().trim();
    if (!id) {
      const newId = generateTxnId(existing);
      existing.add(newId);
      updates.push({ rowIndex: i + 2, id: newId });
    }
  });

  if (updates.length) {
    await withRetry(() =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: updates.map((u) => ({
            range: `${sheetName}!F${u.rowIndex}`,
            values: [[u.id]],
          })),
        },
      })
    );
    logger.info({ count: updates.length }, "Backfilled missing IDs");
  }
}

export async function createSpreadsheet(
  auth: OAuth2Client,
  title: string
): Promise<string | null | undefined> {
  const sheets = google.sheets({ version: "v4", auth });
  try {
    const spreadsheet = await withRetry(() =>
      sheets.spreadsheets.create({ requestBody: { properties: { title } } })
    );
    return spreadsheet.data.spreadsheetId;
  } catch (err) {
    logger.error({ err: errMsg(err) }, "Gagal membuat spreadsheet baru");
    return null;
  }
}

/** Append transaksi + kembalikan ID uniknya.
 *  NOTE: menulis ke sheet sesuai BULAN pada row.timestamp. */
export async function appendTransaction(
  auth: OAuth2Client,
  spreadsheetId: string,
  row: TransactionRow
): Promise<string> {
  const sheets = google.sheets({ version: "v4", auth });

  // sheet ditentukan dari timestamp transaksi
  const sheetName = getSheetNameForTimestamp(row.timestamp);

  await ensureSheetAndIds(auth, spreadsheetId, sheetName);

  // ambil existing IDs
  const colF = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!F2:F`,
      valueRenderOption: "UNFORMATTED_VALUE",
    })
  );
  const ids = new Set<string>(
    (colF.data.values || [])
      .map((v) => (v?.[0] ?? "").toString().trim())
      .filter(Boolean)
  );
  const id = generateTxnId(ids);

  const range = `${sheetName}!A:F`;
  const values = [
    [row.timestamp, row.type, row.category, row.amount, row.description, id],
  ];

  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    })
  );

  return id;
}

/* ===== Helper untuk membaca tanpa membuat tab kosong ===== */
async function sheetExists(
  auth: OAuth2Client,
  spreadsheetId: string,
  sheetName: string
): Promise<boolean> {
  const id = await getSheetIdByTitle(auth, spreadsheetId, sheetName);
  return id != null;
}

/** Hitung total pemasukan/pengeluaran untuk sebuah sheet (bulan).
 *  Jika `opts.sheetName` tidak diberikan → bulan berjalan.
 *  Jika `opts.createIfMissing` = false dan sheet tidak ada → kembalikan nol & sheetExists=false.
 */
export async function calculateBalance(
  auth: OAuth2Client,
  spreadsheetId: string,
  opts?: { sheetName?: string; createIfMissing?: boolean }
): Promise<{
  totalIncome: number;
  totalExpenses: number;
  balance: number;
  sheetExists: boolean;
  rowCount: number;
}> {
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = opts?.sheetName ?? getCurrentSheetName();
  const createIfMissing = opts?.createIfMissing ?? true;

  if (!createIfMissing) {
    const exists = await sheetExists(auth, spreadsheetId, sheetName);
    if (!exists) {
      return {
        totalIncome: 0,
        totalExpenses: 0,
        balance: 0,
        sheetExists: false,
        rowCount: 0,
      };
    }
  } else {
    await ensureSheetAndIds(auth, spreadsheetId, sheetName);
  }

  const range = `${sheetName}!A:D`;

  let totalIncome = 0;
  let totalExpenses = 0;
  let rowCount = 0;

  try {
    const response = await withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: "UNFORMATTED_VALUE",
      })
    );
    const rows = response.data.values;
    if (rows && rows.length > 1) {
      rowCount = rows.length - 1;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const type = row[1];
        const amount = parseFloat(row[3]);
        if (!isNaN(amount)) {
          if (type === "Pemasukan") totalIncome += amount;
          else if (type === "Pengeluaran") totalExpenses += amount;
        }
      }
    }
  } catch (error: any) {
    const message = errMsg(error);
    logger.error(
      { err: message, spreadsheetId, sheetName, range },
      "calculateBalance failed"
    );
    if (/Unable to parse range/i.test(message)) {
      return {
        totalIncome: 0,
        totalExpenses: 0,
        balance: 0,
        sheetExists: false,
        rowCount: 0,
      };
    }
    throw error;
  }
  return {
    totalIncome,
    totalExpenses,
    balance: totalIncome - totalExpenses,
    sheetExists: true,
    rowCount,
  };
}

export async function listRecentTransactions(
  auth: OAuth2Client,
  spreadsheetId: string,
  limit = 5,
  opts?: { sheetName?: string; createIfMissing?: boolean }
): Promise<
  Array<{
    id: string;
    timestamp: string;
    type: string;
    category: string;
    amount: number;
    description: string;
    rowIndex: number;
  }>
> {
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = opts?.sheetName ?? getCurrentSheetName();
  const createIfMissing = opts?.createIfMissing ?? true;

  if (createIfMissing) {
    await ensureSheetAndIds(auth, spreadsheetId, sheetName);
  } else {
    const exists = await sheetExists(auth, spreadsheetId, sheetName);
    if (!exists) return [];
  }

  const resp = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:F`,
      valueRenderOption: "UNFORMATTED_VALUE",
    })
  );
  const rows = resp.data.values || [];
  const start = Math.max(0, rows.length - limit);
  const slice = rows.slice(start);

  return slice.map((r, i) => ({
    timestamp: r[0],
    type: r[1],
    category: r[2],
    amount: Number(r[3]) || 0,
    description: (r[4] ?? "").toString(),
    id: (r[5] ?? "").toString(),
    rowIndex: start + i + 2,
  }));
}

export async function deleteTransactionById(
  auth: OAuth2Client,
  spreadsheetId: string,
  id: string
): Promise<boolean> {
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = getCurrentSheetName();

  await ensureSheetAndIds(auth, spreadsheetId, sheetName);

  const colF = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!F2:F`,
    })
  );
  const vals = colF.data.values || [];
  let foundRow = -1;
  for (let i = 0; i < vals.length; i++) {
    if ((vals[i]?.[0] ?? "").toString().trim() === id) {
      foundRow = i + 2;
      break;
    }
  }
  if (foundRow < 0) return false;

  const sheetId = await getSheetIdByTitle(auth, spreadsheetId, sheetName);
  if (sheetId == null) return false;

  await withRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: foundRow - 1,
                endIndex: foundRow,
              },
            },
          },
        ],
      },
    })
  );

  return true;
}

export async function deleteLastTransaction(
  auth: OAuth2Client,
  spreadsheetId: string
): Promise<boolean> {
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = getCurrentSheetName();
  const sheetId = await getSheetIdByTitle(auth, spreadsheetId, sheetName);
  if (sheetId == null) return false;

  const resp = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:F`,
    })
  );
  const rows = resp.data.values || [];
  if (rows.length === 0) return false;

  const lastRowIndex = rows.length + 1;
  await withRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: lastRowIndex - 1,
                endIndex: lastRowIndex,
              },
            },
          },
        ],
      },
    })
  );
  return true;
}

/* =========================
   BUDGETS (tab 'Budgets')
   ========================= */

async function ensureBudgetSheet(auth: OAuth2Client, spreadsheetId: string) {
  const sheets = google.sheets({ version: "v4", auth });
  // coba baca header
  try {
    const hdr = await withRetry(() =>
      sheets.spreadsheets.values.get({ spreadsheetId, range: `Budgets!A1:B1` })
    );
    const first = hdr.data.values?.[0];
    if (!first || first[0] !== "Kategori" || first[1] !== "BudgetBulanan") {
      await withRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Budgets!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Kategori", "BudgetBulanan"]] },
        })
      );
    }
  } catch (e: any) {
    if (/Unable to parse range/i.test(errMsg(e))) {
      // buat tab
      await withRetry(() =>
        sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [{ addSheet: { properties: { title: "Budgets" } } }],
          },
        })
      );
      await withRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `Budgets!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [["Kategori", "BudgetBulanan"]] },
        })
      );
    } else {
      throw e;
    }
  }
}

export async function setBudget(
  auth: OAuth2Client,
  spreadsheetId: string,
  category: string,
  amount: number
) {
  await ensureBudgetSheet(auth, spreadsheetId);
  const sheets = google.sheets({ version: "v4", auth });

  // Cari baris kategori
  const resp = await withRetry(() =>
    sheets.spreadsheets.values.get({ spreadsheetId, range: `Budgets!A2:B` })
  );
  const rows = resp.data.values || [];
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (
      (rows[i]?.[0] ?? "").toString().trim().toLowerCase() ===
      category.toLowerCase()
    ) {
      rowIndex = i + 2;
      break;
    }
  }

  if (rowIndex === -1) {
    // append
    await withRetry(() =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `Budgets!A:B`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[category, amount]] },
      })
    );
  } else {
    // update
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Budgets!B${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[amount]] },
      })
    );
  }
}

export async function getBudgetSummary(
  auth: OAuth2Client,
  spreadsheetId: string
): Promise<
  Array<{ category: string; budget: number; spent: number; remaining: number }>
> {
  await ensureBudgetSheet(auth, spreadsheetId);
  const sheets = google.sheets({ version: "v4", auth });

  const sheetName = getCurrentSheetName();

  // budgets
  const b = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `Budgets!A2:B`,
      valueRenderOption: "UNFORMATTED_VALUE",
    })
  );
  const budgetRows = b.data.values || [];
  const budgetMap = new Map<string, number>();
  budgetRows.forEach((r) => {
    const cat = (r[0] ?? "").toString().trim();
    const amt = Number(r[1] ?? 0) || 0;
    if (cat) budgetMap.set(cat.toLowerCase(), amt);
  });

  // spend by category (bulan ini)
  const tx = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A2:D`,
      valueRenderOption: "UNFORMATTED_VALUE",
    })
  );
  const txRows = tx.data.values || [];
  const spentMap = new Map<string, number>();
  for (const r of txRows) {
    const type = (r[1] ?? "").toString().trim();
    if (type !== "Pengeluaran") continue;
    const cat = (r[2] ?? "").toString().trim().toLowerCase();
    const amt = Number(r[3] ?? 0) || 0; // NOQA
    if (!cat) continue;
    spentMap.set(cat, (spentMap.get(cat) || 0) + amt);
  }

  // join
  const out: Array<{
    category: string;
    budget: number;
    spent: number;
    remaining: number;
  }> = [];
  for (const [catLower, budget] of budgetMap) {
    const spent = spentMap.get(catLower) || 0;
    out.push({
      category:
        Array.from(budgetMap.keys()).find((k) => k === catLower) || catLower,
      budget,
      spent,
      remaining: budget - spent,
    });
  }
  return out;
}
