import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';

export interface TransactionRow {
  timestamp: string;
  type: 'Pemasukan' | 'Pengeluaran';
  category: string;
  amount: number;
  description: string;
}

@Injectable()
export class GoogleSheetService {
  private readonly logger = new Logger(GoogleSheetService.name);

  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            if (i === retries - 1) throw error;
            // simple delay
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    throw new Error('Unreachable');
  }

  private errMsg(e: any): string {
    return (
      e?.response?.data?.error?.message ||
      e?.response?.data?.message ||
      e?.message ||
      String(e)
    );
  }

  private getCurrentSheetName(): string {
    return new Date().toLocaleString('id-ID', {
      month: 'short',
      year: 'numeric',
    });
  }

  private getSheetNameForTimestamp(ts: string): string {
    const [datePart] = ts.split(' ');
    const [y, m] = datePart.split('-').map(Number);
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
      'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
    ];
    return `${months[(m || 1) - 1]} ${y}`;
  }

  private generateTxnId(existing: Set<string>): string {
    let id = '';
    do {
      const now = Date.now().toString(36);
      const rand = Math.floor(Math.random() * 1e6).toString(36);
      id = (now + rand).slice(-8);
    } while (existing.has(id));
    return id;
  }

  private async getSheetIdByTitle(
    auth: OAuth2Client,
    spreadsheetId: string,
    sheetName: string,
  ): Promise<number | null> {
    const sheets = google.sheets({ version: 'v4', auth });
    const resp = await this.withRetry(() =>
      sheets.spreadsheets.get({ spreadsheetId }),
    );
    const sheet = resp.data.sheets?.find(
      (s) => s.properties?.title === sheetName,
    );
    return sheet?.properties?.sheetId ?? null;
  }

  private readonly sheetCache = new Set<string>();

  private async ensureSheetAndIds(
    auth: OAuth2Client,
    spreadsheetId: string,
    sheetName: string,
  ): Promise<void> {
    const cacheKey = `${spreadsheetId}:${sheetName}`;
    if (this.sheetCache.has(cacheKey)) {
        return;
    }

    const sheets = google.sheets({ version: 'v4', auth });
    let header: string[] | null = null;
    
    try {
      const hdr = await this.withRetry(() =>
        sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${sheetName}!A1:F1`,
        }),
      );
      header = (hdr.data.values?.[0] as string[]) || null;
    } catch (e: any) {
      if (/Unable to parse range/i.test(this.errMsg(e))) {
        // Create sheet
        const add = await this.withRetry(() =>
          sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{ addSheet: { properties: { title: sheetName } } }],
            },
          }),
        );
        const sheetId = add.data.replies?.[0]?.addSheet?.properties?.sheetId;

        await this.withRetry(() =>
          sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheetName}!A1`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [
                ['Tanggal', 'Tipe', 'Kategori', 'Jumlah', 'Deskripsi', 'ID'],
              ],
            },
          }),
        );

        if (sheetId != null) {
            // formatting
            await this.withRetry(() =>
                sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        requests: [
                            {
                                updateSpreadsheetProperties: {
                                    properties: { timeZone: 'Asia/Jakarta' },
                                    fields: 'timeZone',
                                },
                            },
                             {
                                repeatCell: {
                                    range: { sheetId, startColumnIndex: 0, endColumnIndex: 1 },
                                    cell: {
                                        userEnteredFormat: {
                                            numberFormat: { type: 'DATE_TIME', pattern: 'dd MMM yyyy, HH:mm:ss' }
                                        }
                                    },
                                    fields: 'userEnteredFormat.numberFormat'
                                }
                             },
                             {
                                repeatCell: {
                                    range: { sheetId, startColumnIndex: 3, endColumnIndex: 4 },
                                    cell: {
                                        userEnteredFormat: {
                                            numberFormat: { type: 'CURRENCY', pattern: '"Rp"#,##0' }
                                        }
                                    },
                                    fields: 'userEnteredFormat.numberFormat'
                                }
                             }
                        ]
                    }
                })
            )
        }
        return;
      }
      throw e;
    }

    // Ensure header
    const want = ['Tanggal', 'Tipe', 'Kategori', 'Jumlah', 'Deskripsi', 'ID'];
     if (
      !header ||
      header.length !== want.length ||
      header.some(
        (v, i) =>
          (v ?? '').toString().trim().toLowerCase() !== want[i].toLowerCase(),
      )
    ) {
        await this.withRetry(() =>
            sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [want] },
            })
        );
    }
    
    // Backfill
    const all = await this.withRetry(() =>
        sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A2:F`,
            valueRenderOption: 'UNFORMATTED_VALUE',
        })
    );
     const rows: any[][] = all.data.values || [];
    if (!rows.length) return;

    const existing = new Set<string>();
    rows.forEach((r) => {
      const id = (r[5] ?? '').toString().trim();
      if (id) existing.add(id);
    });

    const updates: { rowIndex: number; id: string }[] = [];
    rows.forEach((r, i) => {
      const id = (r[5] ?? '').toString().trim();
      if (!id) {
        const newId = this.generateTxnId(existing);
        existing.add(newId);
        updates.push({ rowIndex: i + 2, id: newId });
      }
    });

    if (updates.length) {
      await this.withRetry(() =>
        sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: updates.map((u) => ({
              range: `${sheetName}!F${u.rowIndex}`,
              values: [[u.id]],
            })),
          },
        }),
      );
      this.logger.log(`Backfilled ${updates.length} missing IDs`);
    }

    this.sheetCache.add(cacheKey);
  }

  async createSpreadsheet(
    auth: OAuth2Client,
    title: string,
  ): Promise<string | null | undefined> {
    const sheets = google.sheets({ version: 'v4', auth });
    try {
      const spreadsheet = await this.withRetry(() =>
        sheets.spreadsheets.create({ requestBody: { properties: { title } } }),
      );
      return spreadsheet.data.spreadsheetId;
    } catch (err: any) {
      this.logger.error(`Gagal membuat spreadsheet: ${this.errMsg(err)}`);
      return null;
    }
  }

  async appendTransaction(
    auth: OAuth2Client,
    spreadsheetId: string,
    row: TransactionRow,
  ): Promise<string> {
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetName = this.getSheetNameForTimestamp(row.timestamp);
    
    await this.ensureSheetAndIds(auth, spreadsheetId, sheetName);

    // Get existing IDs
    const colF = await this.withRetry(() =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!F2:F`,
        valueRenderOption: 'UNFORMATTED_VALUE',
      }),
    );
     const ids = new Set<string>(
      (colF.data.values || [])
        .map((v) => (v?.[0] ?? '').toString().trim())
        .filter(Boolean),
    );
    const id = this.generateTxnId(ids);

    const range = `${sheetName}!A:F`;
     const values = [
      [row.timestamp, row.type, row.category, row.amount, row.description, id],
    ];

     await this.withRetry(() =>
      sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values },
      }),
    );

    return id;
  }
  
  async calculateBalance(
      auth: OAuth2Client,
      spreadsheetId: string,
      opts?: { sheetName?: string; createIfMissing?: boolean }
  ) {
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetName = opts?.sheetName ?? this.getCurrentSheetName();
    const createIfMissing = opts?.createIfMissing ?? true;

    if (!createIfMissing) {
        const id = await this.getSheetIdByTitle(auth, spreadsheetId, sheetName);
        if (id == null) {
            return {
                totalIncome: 0,
                totalExpenses: 0,
                balance: 0,
                sheetExists: false,
                rowCount: 0
            };
        }
    } else {
        await this.ensureSheetAndIds(auth, spreadsheetId, sheetName);
    }
    
    const range = `${sheetName}!A:D`;
    let totalIncome = 0;
    let totalExpenses = 0;
    let rowCount = 0;

    try {
        const response = await this.withRetry(() => 
             sheets.spreadsheets.values.get({
                spreadsheetId,
                range,
                valueRenderOption: 'UNFORMATTED_VALUE'
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
                    if (type === 'Pemasukan') totalIncome += amount;
                    else if (type === 'Pengeluaran') totalExpenses += amount;
                }
            }
        }
    } catch (error: any) {
        const message = this.errMsg(error);
        this.logger.error(`calculateBalance failed: ${message}`);
         if (/Unable to parse range/i.test(message)) {
             return {
                totalIncome: 0,
                totalExpenses: 0,
                balance: 0,
                sheetExists: false,
                rowCount: 0
             };
         }
         throw error;
    }
    
    return {
        totalIncome,
        totalExpenses,
        balance: totalIncome - totalExpenses,
        sheetExists: true,
        rowCount
    };
  }
  
  async listRecentTransactions(
    auth: OAuth2Client,
    spreadsheetId: string,
    limit = 5,
    opts?: { sheetName?: string; createIfMissing?: boolean }
  ) {
    const sheets = google.sheets({ version: 'v4', auth });
    const sheetName = opts?.sheetName ?? this.getCurrentSheetName();
    const createIfMissing = opts?.createIfMissing ?? true;

     if (createIfMissing) {
        await this.ensureSheetAndIds(auth, spreadsheetId, sheetName);
     } else {
        const id = await this.getSheetIdByTitle(auth, spreadsheetId, sheetName);
        if (id == null) return [];
     }

     const resp = await this.withRetry(() =>
        sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A2:F`,
            valueRenderOption: 'UNFORMATTED_VALUE'
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
        description: (r[4] ?? '').toString(),
        id: (r[5] ?? '').toString(),
        rowIndex: start + i + 2,
    }));
  }

  async deleteTransactionById(
      auth: OAuth2Client,
      spreadsheetId: string,
      id: string
  ): Promise<boolean> {
      const sheets = google.sheets({ version: 'v4', auth });
      const sheetName = this.getCurrentSheetName();
      
      await this.ensureSheetAndIds(auth, spreadsheetId, sheetName);

      const colF = await this.withRetry(() => 
        sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!F2:F`
        })
      );
      
      const vals = colF.data.values || [];
      let foundRow = -1;
      for (let i = 0; i < vals.length; i++) {
        if ((vals[i]?.[0] ?? '').toString().trim() === id) {
            foundRow = i + 2;
            break;
        }
      }
      if (foundRow < 0) return false;
      
      const sheetId = await this.getSheetIdByTitle(auth, spreadsheetId, sheetName);
      if (sheetId == null) return false;

      await this.withRetry(() => 
        sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        deleteDimension: {
                             range: {
                                sheetId,
                                dimension: 'ROWS',
                                startIndex: foundRow - 1,
                                endIndex: foundRow
                             }
                        }
                    }
                ]
            }
        })
      );
      
      return true;
  }
  
  async deleteLastTransaction(
      auth: OAuth2Client,
      spreadsheetId: string
  ): Promise<boolean> {
      const sheets = google.sheets({ version: 'v4', auth });
      const sheetName = this.getCurrentSheetName();
      const sheetId = await this.getSheetIdByTitle(auth, spreadsheetId, sheetName);
      if (sheetId == null) return false;
      
      const resp = await this.withRetry(() => 
        sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A2:F`
        })
      );
      const rows = resp.data.values || [];
      if (rows.length === 0) return false;
      
      const lastRowIndex = rows.length + 1;
      await this.withRetry(() => 
        sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [
                    {
                        deleteDimension: {
                            range: {
                                sheetId,
                                dimension: 'ROWS',
                                startIndex: lastRowIndex - 1,
                                endIndex: lastRowIndex
                            }
                        }
                    }
                ]
            }
        })
      );
      return true;
  }

  async ensureBudgetSheet(auth: OAuth2Client, spreadsheetId: string) {
      const sheets = google.sheets({ version: 'v4', auth });
      try {
          const hdr = await this.withRetry(() => 
             sheets.spreadsheets.values.get({ spreadsheetId, range: `Budgets!A1:B1` })
          );
          const first = hdr.data.values?.[0];
          if (!first || first[0] !== 'Kategori' || first[1] !== 'BudgetBulanan') {
               await this.withRetry(() => 
                 sheets.spreadsheets.values.update({
                      spreadsheetId,
                      range: `Budgets!A1`,
                      valueInputOption: 'USER_ENTERED',
                      requestBody: { values: [['Kategori', 'BudgetBulanan']] }
                 })
               );
          }
      } catch (e: any) {
           if (/Unable to parse range/i.test(this.errMsg(e))) {
               await this.withRetry(() => 
                 sheets.spreadsheets.batchUpdate({
                      spreadsheetId,
                      requestBody: {
                          requests: [{ addSheet: { properties: { title: 'Budgets' } } }]
                      }
                 })
               );
                await this.withRetry(() => 
                 sheets.spreadsheets.values.update({
                      spreadsheetId,
                      range: `Budgets!A1`,
                      valueInputOption: 'USER_ENTERED',
                      requestBody: { values: [['Kategori', 'BudgetBulanan']] }
                 })
               );
           } else {
               throw e;
           }
      }
  }

  async setBudget(
      auth: OAuth2Client,
      spreadsheetId: string,
      category: string,
      amount: number
  ) {
      await this.ensureBudgetSheet(auth, spreadsheetId);
      const sheets = google.sheets({ version: 'v4', auth });
      
      const resp = await this.withRetry(() => 
         sheets.spreadsheets.values.get({ spreadsheetId, range: `Budgets!A2:B` })
      );
      const rows = resp.data.values || [];
      let rowIndex = -1;
      for (let i = 0; i < rows.length; i++) {
           if ((rows[i]?.[0] ?? '').toString().trim().toLowerCase() === category.toLowerCase()) {
               rowIndex = i + 2;
               break;
           }
      }

      if (rowIndex === -1) {
          await this.withRetry(() => 
             sheets.spreadsheets.values.append({
                 spreadsheetId,
                 range: `Budgets!A:B`,
                 valueInputOption: 'USER_ENTERED',
                 requestBody: { values: [[category, amount]] }
             })
          );
      } else {
          await this.withRetry(() => 
             sheets.spreadsheets.values.update({
                 spreadsheetId,
                 range: `Budgets!B${rowIndex}`,
                 valueInputOption: 'USER_ENTERED',
                 requestBody: { values: [[amount]] }
             })
          );
      }
  }

  async getBudgetSummary(
      auth: OAuth2Client,
      spreadsheetId: string
  ) {
      await this.ensureBudgetSheet(auth, spreadsheetId);
      const sheets = google.sheets({ version: 'v4', auth });
      const sheetName = this.getCurrentSheetName();
      
      // budget map
      const b = await this.withRetry(() => 
         sheets.spreadsheets.values.get({ spreadsheetId, range: `Budgets!A2:B`, valueRenderOption: 'UNFORMATTED_VALUE' })
      );
      const budgetRows = b.data.values || [];
      const budgetMap = new Map<string, number>();
      budgetRows.forEach(r => {
          const cat = (r[0] ?? '').toString().trim();
          const amt = Number(r[1] ?? 0) || 0;
          if (cat) budgetMap.set(cat.toLowerCase(), amt);
      });

      // spend
      const tx = await this.withRetry(() => 
          sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A2:D`, valueRenderOption: 'UNFORMATTED_VALUE' })
      );
      const txRows = tx.data.values || [];
      const spentMap = new Map<string, number>();
      for (const r of txRows) {
          const type = (r[1] ?? '').toString().trim();
          if (type !== 'Pengeluaran') continue;
          const cat = (r[2] ?? '').toString().trim().toLowerCase();
          const amt = Number(r[3] ?? 0) || 0;
          if (!cat) continue;
          spentMap.set(cat, (spentMap.get(cat) || 0) + amt);
      }

      return Array.from(budgetMap).map(([catLower, budget]) => {
          const spent = spentMap.get(catLower) || 0;
          const displayCat = budgetRows.find(
              r => (r[0] ?? '').toString().trim().toLowerCase() === catLower
          )?.[0] || catLower;
          
          return {
              category: displayCat,
              budget,
              spent,
              remaining: budget - spent
          };
      });
  }
}
