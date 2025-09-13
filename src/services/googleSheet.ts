// src/services/googleSheet.ts
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import logger from "../logger";

export interface TransactionRow {
  timestamp: string;
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

export async function createSpreadsheet(
  auth: OAuth2Client,
  title: string
): Promise<string | null | undefined> {
  const sheets = google.sheets({ version: "v4", auth });
  try {
    const spreadsheet = await sheets.spreadsheets.create({
      requestBody: { properties: { title } },
    });
    return spreadsheet.data.spreadsheetId;
  } catch (err) {
    logger.error({ err: errMsg(err) }, "Gagal membuat spreadsheet baru");
    return null;
  }
}

function getCurrentSheetName(): string {
  return new Date().toLocaleString("id-ID", {
    month: "short",
    year: "numeric",
  });
}

export async function appendTransaction(
  auth: OAuth2Client,
  spreadsheetId: string,
  row: TransactionRow
): Promise<void> {
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = getCurrentSheetName();
  const range = `${sheetName}!A:E`;
  const values = [
    [row.timestamp, row.type, row.category, row.amount, row.description],
  ];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  } catch (error: any) {
    const message = errMsg(error);
    logger.error(
      { err: message, spreadsheetId, sheetName, range, values },
      "appendTransaction failed (first try)"
    );

    // Google sering meletakkan teks "Unable to parse range" di error.response.data.error.message
    if (/Unable to parse range/i.test(message)) {
      logger.info(
        `Sheet "${sheetName}" tidak ditemukan, membuat sheet baru...`
      );

      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });

      const newSheetId =
        addSheetResponse.data.replies?.[0]?.addSheet?.properties?.sheetId;

      // tulis header
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["Tanggal", "Tipe", "Kategori", "Jumlah", "Deskripsi"]],
        },
      });

      // set timezone + format kolom
      if (newSheetId != null) {
        await sheets.spreadsheets.batchUpdate({
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
                  range: {
                    sheetId: newSheetId,
                    startColumnIndex: 0,
                    endColumnIndex: 1,
                  },
                  cell: {
                    userEnteredFormat: {
                      numberFormat: {
                        type: "DATE_TIME",
                        // gunakan MMM (huruf besar) dan HH untuk 24 jam
                        pattern: "dd MMM yyyy, HH:mm:ss",
                      },
                    },
                  },
                  fields: "userEnteredFormat.numberFormat",
                },
              },
              {
                repeatCell: {
                  range: {
                    sheetId: newSheetId,
                    startColumnIndex: 3,
                    endColumnIndex: 4,
                  },
                  cell: {
                    userEnteredFormat: {
                      numberFormat: { type: "CURRENCY", pattern: '"Rp"#,##0' },
                    },
                  },
                  fields: "userEnteredFormat.numberFormat",
                },
              },
            ],
          },
        });
      }

      // append ulang setelah sheet dibuat
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
    } else {
      // error lain: lempar naik supaya handler di bot.ts kirim pesan user + muncul di log
      throw error;
    }
  }
}

export async function calculateBalance(
  auth: OAuth2Client,
  spreadsheetId: string
): Promise<{ totalIncome: number; totalExpenses: number; balance: number }> {
  const sheets = google.sheets({ version: "v4", auth });
  const sheetName = getCurrentSheetName();
  const range = `${sheetName}!A:D`;

  let totalIncome = 0;
  let totalExpenses = 0;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      valueRenderOption: "UNFORMATTED_VALUE",
    });
    const rows = response.data.values;
    if (rows && rows.length > 1) {
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
      // sheet bulan ini belum ada
      return { totalIncome: 0, totalExpenses: 0, balance: 0 };
    }
    throw error;
  }
  return { totalIncome, totalExpenses, balance: totalIncome - totalExpenses };
}
