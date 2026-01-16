import { Logger } from '@nestjs/common';
import { formatInTimeZone } from 'date-fns-tz';
import { Ctx, Hears, On, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import {
  dateTips,
  deleteTips,
  examples,
  helpMessageAuthed
} from '../constants/helpers';
import { GoogleAuthService } from '../google/google-auth.service';
import { GoogleSheetService, TransactionRow } from '../google/google-sheet.service';
import { KEYBOARDS, REGEX } from './bot.constants';

// Custom help message function
const helpMessageNew = (authUrl: string) =>
  `👋 *Selamat datang!*\n\nAgar bisa menyimpan data, hubungkan dulu akun Google Anda ya.\n\n` +
  `1. Ketuk tombol *Hubungkan Akun Google* di bawah.\n` +
  `2. Izinkan akses (Sheets & Drive).\n` +
  `3. Setelah sukses, Anda bisa langsung pakai perintah di bawah.\n\n` +
  `*Contoh perintah:*\n${examples}\n\n` +
  `${dateTips}\n\n${deleteTips}\n\n` +
  `Atau ketuk tombol cepat di bawah.`;

import {
  formatSheetTimestampForDisplay,
  parseDateAtBeginning,
  parseMonthYearArg,
  sheetNameFromMonthYear,
} from '../utils/date';
import { parseAmount } from '../utils/parser';

// Extend Context to include match
interface BotContext extends Context {
  match: RegExpMatchArray;
}

@Update()
export class BotUpdate {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly googleAuthService: GoogleAuthService,
    private readonly googleSheetService: GoogleSheetService,
  ) {}

  @Hears(REGEX.relink)
  async onRelink(@Ctx() ctx: BotContext) {
    const id = ctx.from!.id;
    await this.googleAuthService.clearUserData(id);
    const url = this.googleAuthService.generateAuthUrl(id);
    await ctx.reply(
      '🔁 *Hubungkan Ulang Akun*\n\n' +
      'Data lama Anda (Spreadsheet) **tidak akan dihapus**.\n' +
      'Proses ini hanya memperbarui izin akses bot.\n\n' +
      'Silakan klik tombol di bawah:',
      { parse_mode: 'Markdown', ...KEYBOARDS.new(url) }
    );
  }

  @Hears(REGEX.startHelp)
  async onStart(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from!.id;
    const userData = await this.googleAuthService.getUserData(telegramId);

    // Scenario 1: User data exists AND tokens are valid (already connected)
    if (userData?.tokens) {
      await ctx.replyWithMarkdown(helpMessageAuthed, KEYBOARDS.authed);
      return;
    }

    const authUrl = this.googleAuthService.generateAuthUrl(telegramId);
    this.logger.log(`Generated OAuth URL for ${telegramId}`);

    // Scenario 2: Returning user (User data exists but tokens are null/missing)
    // "kalo sudah pernah login tapi ter-logout sendiri atau dengan sengaja..."
    if (userData) { // tokens is null/undefined here
      const msg = 
        `👋 *Halo lagi!*\n\n` +
        `Sepertinya Anda pernah terhubung sebelumnya, namun sesi Anda telah habis (logout).\n` +
        `Jangan khawatir, data yang pernah Anda catat di Google Sheet **tetap aman**.\n\n` +
        `Silakan login ulang untuk melanjutkan pencatatan:`;
       await ctx.replyWithMarkdown(msg, KEYBOARDS.new(authUrl));
       return;
    }

    // Scenario 3: New user (No user data)
    // "Halo! Selamat datang di Kubera..."
    const msg = 
      `👋 *Halo! Selamat datang di Kubera.*\n\n` +
      `Kubera adalah bot yang membantu Anda untuk mencatat pemasukan dan pengeluaran harian, bulanan hingga tahunan.\n\n` +
      `Silakan login dengan akun Google Anda untuk merasakan manfaatnya.`;
    
    await ctx.replyWithMarkdown(msg, KEYBOARDS.new(authUrl));
  }

  @Hears(REGEX.total)
  async onTotal(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from!.id;
    const authClient = await this.googleAuthService.getAuthenticatedClient(telegramId);
    const userData = await this.googleAuthService.getUserData(telegramId);

    if (!authClient || !userData) {
      const authUrl = this.googleAuthService.generateAuthUrl(telegramId);
      await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
      return;
    }

    const arg = (ctx.match[1] || '').trim();

    if (!arg) {
       // Current month
       try {
        const { totalIncome, totalExpenses, balance } = await this.googleSheetService.calculateBalance(
            authClient,
            userData.spreadsheetId
        );
        const monthName = new Date().toLocaleString('id-ID', { month: 'long' });
        const year = new Date().getFullYear();
        const replyMessage = `📊 *Laporan Bulan ${monthName} ${year}*\n\nPemasukan: Rp${totalIncome.toLocaleString(
          'id-ID',
        )}\nPengeluaran: Rp${totalExpenses.toLocaleString(
          'id-ID',
        )}\n--------------------\nSisa Saldo: *Rp${balance.toLocaleString(
          'id-ID',
        )}*`;
        await ctx.replyWithMarkdown(replyMessage);
       } catch (error: any) {
           this.handleError(ctx, error, 'Gagal mengambil total laporan');
       }
       return;
    }

    // Specific month
    const my = parseMonthYearArg(arg);
    if (!my) {
        await ctx.reply(
          'Format waktu tidak dikenali. Contoh:\n' +
            '• /total 03/25\n' +
            '• /total 09/2025\n' +
            '• /total september 2025\n' +
            '• /total 03-25',
        );
        return;
    }
    
    const sheetName = sheetNameFromMonthYear(my.month, my.year);
    const prettyLabel = new Date(my.year, my.month - 1, 1).toLocaleString(
      'id-ID',
      { month: 'long', year: 'numeric' },
    );

    try {
        const { totalIncome, totalExpenses, balance, sheetExists, rowCount } = 
            await this.googleSheetService.calculateBalance(authClient, userData.spreadsheetId, {
                sheetName,
                createIfMissing: false
            });
        
        if (!sheetExists || rowCount === 0) {
            await ctx.replyWithMarkdown(`Belum ada transaksi pada *${prettyLabel}*.`);
            return;
        }
        
        const replyMessage = `📊 *Laporan Bulan ${prettyLabel}*\n\nPemasukan: Rp${totalIncome.toLocaleString(
          'id-ID',
        )}\nPengeluaran: Rp${totalExpenses.toLocaleString(
          'id-ID',
        )}\n--------------------\nSisa Saldo: *Rp${balance.toLocaleString(
          'id-ID',
        )}*`;
        await ctx.replyWithMarkdown(replyMessage);
    } catch (error: any) {
        this.handleError(ctx, error, 'Gagal mengambil total laporan (argumen)');
    }
  }

  @Hears(REGEX.laporan)
  async onLaporan(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from!.id;
    const userData = await this.googleAuthService.getUserData(telegramId);

    if (!userData) {
      const authUrl = this.googleAuthService.generateAuthUrl(telegramId);
      await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
      return;
    }

    const url = `https://docs.google.com/spreadsheets/d/${userData.spreadsheetId}`;
    const replyMessage = `📄 Berikut adalah link laporan Google Sheet Anda:\n\n[Buka Laporan](${url})`;
    await ctx.replyWithMarkdown(replyMessage);
  }

  @Hears(REGEX.pemasukan)
  async onPemasukan(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from!.id;
    const authClient = await this.googleAuthService.getAuthenticatedClient(telegramId);
    const userData = await this.googleAuthService.getUserData(telegramId);

    if (!authClient || !userData) {
      const authUrl = this.googleAuthService.generateAuthUrl(telegramId);
      await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
      return;
    }

    const raw = ctx.match[1].trim();
    const { timestamp, rest } = parseDateAtBeginning(raw);

    if (!rest) {
      await ctx.reply(
        '❓ Format salah. Contoh: /pemasukan [tgl] 500k gaji bulanan',
      );
      return;
    }
    
    if (this.isFutureMonth(timestamp)) {
        await ctx.replyWithMarkdown(
          '⏳ *Tanggal di masa depan belum diizinkan.*\n' +
            'Kamu bisa mencatat untuk *bulan ini* atau *bulan-bulan sebelumnya* ya.\n\n' +
            'Contoh:\n' +
            '• `/pemasukan 10-08-2025 1jt gaji`\n' +
            '• `/pemasukan 500k bonus`',
        );
        return;
    }
    
    const match = rest.match(
      /^([+-]?(?:\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[.,]\d+)?\s*(?:rb|ribu|k|jt|juta)?)\b\s*(.*)$/is,
    );
    if (!match) {
        await ctx.reply(
          '❓ Format salah. Gunakan: /pemasukan [tgl] <jumlah> [sumber]',
        );
        return;
    }

    const [, amountStr, description] = match;
    const amount = parseAmount(amountStr);
    if (isNaN(amount)) {
      await ctx.reply(`❓ Jumlah "${amountStr}" tidak valid.`);
      return;
    }

    const incomeData: TransactionRow = {
      timestamp,
      type: 'Pemasukan',
      category: 'Pemasukan',
      amount,
      description: description?.trim() || '-',
    };

    try {
        const id = await this.googleSheetService.appendTransaction(
            authClient,
            userData.spreadsheetId,
            incomeData
        );
        this.logger.log(`[Pemasukan] ID: ${id} (${typeof id})`);

        const balanceRes = await this.googleSheetService.calculateBalance(
            authClient,
            userData.spreadsheetId
        );
        const { totalIncome } = balanceRes;
        this.logger.log(`[Pemasukan] TotalIncome: ${totalIncome} (${typeof totalIncome})`);
        
        await ctx.replyWithMarkdown(
          `✅ Berhasil! Pemasukan *Rp${amount.toLocaleString(
            'id-ID',
          )}* dicatat.\n` +
            `ID: \`${String(id)}\`\n` +
            `Total bulan ini: *Rp${totalIncome.toLocaleString('id-ID')}*`,
        );
    } catch (error: any) {
        this.handleError(ctx, error, 'Gagal mencatat pemasukan');
    }
  }

  @Hears(REGEX.catat)
  async onCatat(@Ctx() ctx: BotContext) {
    const telegramId = ctx.from!.id;
    const authClient = await this.googleAuthService.getAuthenticatedClient(telegramId);
    const userData = await this.googleAuthService.getUserData(telegramId);

    if (!authClient || !userData) {
      const authUrl = this.googleAuthService.generateAuthUrl(telegramId);
      await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
      return;
    }

    const raw = ctx.match[1].trim();
    const { timestamp, rest } = parseDateAtBeginning(raw);

    if (!rest) {
      await ctx.reply(
        '❓ Format salah. Contoh: /catat [tgl] makan 15rb nasi padang',
      );
      return;
    }

    if (this.isFutureMonth(timestamp)) {
      await ctx.replyWithMarkdown(
        '⏳ *Tanggal di masa depan belum diizinkan.*\n' +
          'Silakan catat pengeluaran untuk *bulan ini* atau *bulan yang sudah lewat* ya.\n\n' +
          'Contoh:\n' +
          '• `/catat 03/08/25 makan 25rb nasi padang`\n' +
          '• `/catat transport 15rb gojek`',
      );
      return;
    }

    const match = rest.match(
      /^(.+?)\s+([+-]?(?:\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[.,]\d+)?\s*(?:rb|ribu|k|jt|juta)?)\b\s*(.*)$/is,
    );
    if (!match) {
      await ctx.reply(
        '❓ Format salah. Gunakan: /catat [tgl] <kategori> <jumlah> [deskripsi]',
      );
      return;
    }

    const [, categoryRaw, amountStr, description] = match;
    const category = categoryRaw.trim();
    const amount = parseAmount(amountStr);
    if (isNaN(amount)) {
      await ctx.reply(`❓ Jumlah "${amountStr}" tidak valid.`);
      return;
    }

    try {
      const { totalIncome } = await this.googleSheetService.calculateBalance(
        authClient,
        userData.spreadsheetId,
      );
      if (totalIncome <= 0) {
        await ctx.replyWithMarkdown(
          '⛔️ Anda belum memiliki pemasukan bulan ini.\n' +
            'Silakan catat pemasukan terlebih dahulu:\n`/pemasukan <jumlah> [sumber]`',
        );
        return;
      }

      const expenseData: TransactionRow = {
        timestamp,
        type: 'Pengeluaran',
        category,
        amount,
        description: description?.trim() || '-',
      };

      const id = await this.googleSheetService.appendTransaction(
        authClient,
        userData.spreadsheetId,
        expenseData,
      );
      const { balance } = await this.googleSheetService.calculateBalance(
        authClient,
        userData.spreadsheetId,
      );
      await ctx.replyWithMarkdown(
        `✅ Pengeluaran *${category}* *Rp${amount.toLocaleString(
          'id-ID',
        )}* dicatat.\n` +
          `ID: \`${id}\`\n` +
          `Sisa saldo bulan ini: *Rp${balance.toLocaleString('id-ID')}*`,
      );
    } catch (error: any) {
      this.handleError(ctx, error, 'Gagal mencatat pengeluaran');
    }
  }

  @Hears(REGEX.riwayat)
  async onRiwayat(@Ctx() ctx: BotContext) {
    const id = ctx.from!.id;
    const auth = await this.googleAuthService.getAuthenticatedClient(id);
    const data = await this.googleAuthService.getUserData(id);
    if (!auth || !data) {
      const authUrl = this.googleAuthService.generateAuthUrl(id);
      await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
      return;
    }

    const arg = (ctx.match[1] || '').trim();
    let sheetNameToShow: string;
    let prettyLabel: string;

    if (arg) {
      const my = parseMonthYearArg(arg);
      if (!my) {
        await ctx.reply(
          'Format waktu tidak dikenali. Contoh:\n' +
            '• /riwayat 03/25\n' +
            '• /riwayat 09/2025\n' +
            '• /riwayat september 2025\n' +
            '• /riwayat 03-25',
        );
        return;
      }
      sheetNameToShow = sheetNameFromMonthYear(my.month, my.year);
      prettyLabel = new Date(my.year, my.month - 1, 1).toLocaleString('id-ID', {
        month: 'long',
        year: 'numeric',
      });
    } else {
      const now = new Date();
      sheetNameToShow = sheetNameFromMonthYear(
        now.getMonth() + 1,
        now.getFullYear(),
      );
      prettyLabel = now.toLocaleString('id-ID', {
        month: 'long',
        year: 'numeric',
      });
    }

    const rows = await this.googleSheetService.listRecentTransactions(auth, data.spreadsheetId, 5, {
      sheetName: sheetNameToShow,
      createIfMissing: false,
    });

    if (rows.length === 0) {
      await ctx.replyWithMarkdown(`Belum ada transaksi pada *${prettyLabel}*.`);
      return;
    }

    const lines = rows
      .map((r) => {
        const amt = Number(r.amount || 0);
        return (
          `• ID: [${r.id}]\n` +
          `Waktu: ${formatSheetTimestampForDisplay(r.timestamp)}\n` +
          `${r.type}: ${r.category} sebesar Rp${amt.toLocaleString('id-ID')}${
            r.description ? ` — ${r.description}` : ''
          }`
        );
      })
      .join('\n');

    await ctx.replyWithMarkdown(
      `🕘 *${rows.length} transaksi terakhir (${prettyLabel})*\n${lines}\n\nCatatan: \`/hapus <id>\` atau \`/undo\` hanya untuk bulan yang berjalan.`,
    );
  }

  @Hears(REGEX.hapus)
  async onHapus(@Ctx() ctx: BotContext) {
    const id = ctx.from!.id;
    const auth = await this.googleAuthService.getAuthenticatedClient(id);
    const data = await this.googleAuthService.getUserData(id);
    if (!auth || !data) {
      const authUrl = this.googleAuthService.generateAuthUrl(id);
      await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
      return;
    }

    const targetId = ctx.match[1].trim();
    const ok = await this.googleSheetService.deleteTransactionById(auth, data.spreadsheetId, targetId);
    if (!ok) {
        await ctx.reply(`❌ ID \`${targetId}\` tidak ditemukan di bulan ini.`);
        return;
    }
    await ctx.reply(
      `🗑️ Berhasil menghapus transaksi dengan ID \`${targetId}\`.`,
    );
  }

  @Hears(REGEX.undo)
  async onUndo(@Ctx() ctx: BotContext) {
    const id = ctx.from!.id;
    const auth = await this.googleAuthService.getAuthenticatedClient(id);
    const data = await this.googleAuthService.getUserData(id);
    if (!auth || !data) {
      const authUrl = this.googleAuthService.generateAuthUrl(id);
      await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
      return;
    }

    const ok = await this.googleSheetService.deleteLastTransaction(auth, data.spreadsheetId);
    if (!ok) {
        await ctx.reply('Tidak ada transaksi untuk dihapus (bulan ini).');
        return;
    }
    await ctx.reply('↩️ Transaksi terakhir (bulan ini) telah dihapus.');
  }

  @Hears(REGEX.budgetSet)
  async onBudgetSet(@Ctx() ctx: BotContext) {
    const id = ctx.from!.id;
    const auth = await this.googleAuthService.getAuthenticatedClient(id);
    const data = await this.googleAuthService.getUserData(id);
    if (!auth || !data) {
      const authUrl = this.googleAuthService.generateAuthUrl(id);
      await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
      return;
    }

    const category = ctx.match[1].trim();
    const amount = parseAmount(ctx.match[2]);
    if (isNaN(amount) || amount < 0) {
        await ctx.reply('Jumlah budget tidak valid.');
        return;
    }

    await this.googleSheetService.setBudget(auth, data.spreadsheetId, category, amount);
    await ctx.reply(
      `✅ Budget kategori *${category}* diset Rp${amount.toLocaleString(
        'id-ID',
      )}.`,
    );
  }

  @Hears(REGEX.budgetShow)
  async onBudgetShow(@Ctx() ctx: BotContext) {
    const id = ctx.from!.id;
    const auth = await this.googleAuthService.getAuthenticatedClient(id);
    const data = await this.googleAuthService.getUserData(id);
    if (!auth || !data) {
      const authUrl = this.googleAuthService.generateAuthUrl(id);
      await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
      return;
    }

    const rows = await this.googleSheetService.getBudgetSummary(auth, data.spreadsheetId);
    if (!rows.length) {
      await ctx.replyWithMarkdown(
        'Belum ada budget. Set dengan: `/budget set <kategori> <jumlah>`',
      );
      return;
    }

    const lines = rows
      .map(
        (r) =>
          `• ${r.category}: budget Rp${r.budget.toLocaleString('id-ID')}, ` +
          `terpakai Rp${r.spent.toLocaleString(
            'id-ID',
          )} → sisa *Rp${r.remaining.toLocaleString('id-ID')}*`,
      )
      .join('\n');

    await ctx.replyWithMarkdown(`📉 *Budget bulan ini*\n${lines}`);
  }

  @On('text')
  async onText(@Ctx() ctx: BotContext) {
     // Logging
     if (ctx.message && 'text' in ctx.message) {
        this.logger.log({
            user_id: ctx.from?.id,
            username: ctx.from?.username,
            message: ctx.message.text
        }, 'Pesan diterima');
     }
     
     // Fallback if not matched by Hears
     const id = ctx.from!.id;
     const data = await this.googleAuthService.getUserData(id);
     if (data) {
         await ctx.replyWithMarkdown(helpMessageAuthed, KEYBOARDS.authed);
         return;
     } 
     const authUrl = this.googleAuthService.generateAuthUrl(id);
     await ctx.replyWithMarkdown(helpMessageNew(authUrl), KEYBOARDS.new(authUrl));
  }

  // Helper
  private handleError(ctx: Context, error: any, context: string) {
      let detail =
        error?.response?.data?.error?.message ||
        error?.message ||
        'Unknown error';

      if (typeof detail === 'object') {
        detail = JSON.stringify(detail);
      }

      this.logger.error(
        { user: ctx.from, err: error?.response?.data ?? detail },
        context,
      );
      ctx.reply(
        `Maaf, terjadi kesalahan/error '${context}'.\n\nDetail: \`${detail}\``,
      );
  }

  private isFutureMonth(timestamp: string): boolean {
    const [datePart] = timestamp.split(' '); // "yyyy-MM-dd"
    const [yStr, mStr] = datePart.split('-');
    const ty = Number(yStr);
    const tm = Number(mStr);
    const [cyStr, cmStr] = formatInTimeZone(
      new Date(),
      'Asia/Jakarta',
      'yyyy-MM',
    ).split('-');
    const cy = Number(cyStr);
    const cm = Number(cmStr);
    return ty > cy || (ty === cy && tm > cm);
  }
}
