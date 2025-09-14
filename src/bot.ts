// src/bot.ts
import { formatInTimeZone } from "date-fns-tz";
import { Markup, Telegraf } from "telegraf";
import {
  dateTips,
  deleteTips,
  examples,
  helpMessageAuthed,
} from "./constants/helpers";
import logger from "./logger";
import {
  clearUserData,
  generateAuthUrl,
  getAuthenticatedClient,
  getUserData,
} from "./services/googleAuth";
import {
  appendTransaction,
  calculateBalance,
  deleteLastTransaction,
  deleteTransactionById,
  getBudgetSummary,
  listRecentTransactions,
  setBudget,
  type TransactionRow,
} from "./services/googleSheet";
import {
  formatSheetTimestampForDisplay,
  parseDateAtBeginning,
  parseMonthYearArg,
  sheetNameFromMonthYear,
} from "./utils/date";
import { parseAmount } from "./utils/parser";

const bot = new Telegraf(process.env.BOT_TOKEN!);

const helpMessageNew = (authUrl: string) =>
  `👋 *Selamat datang!*\n\nAgar bisa menyimpan data, hubungkan dulu akun Google Anda ya.\n\n` +
  `1. Ketuk tombol *Hubungkan Akun Google* di bawah.\n` +
  `2. Izinkan akses (Sheets & Drive).\n` +
  `3. Setelah sukses, Anda bisa langsung pakai perintah di bawah.\n\n` +
  `*Contoh perintah:*\n${examples}\n\n` +
  `${dateTips}\n\n${deleteTips}\n\n` +
  `Atau ketuk tombol cepat di bawah.`;

const keyboardAuthed = Markup.inlineKeyboard([
  [
    Markup.button.switchToCurrentChat("➕ Pengeluaran", "/catat "),
    Markup.button.switchToCurrentChat("💰 Pemasukan", "/pemasukan "),
  ],
  [
    Markup.button.switchToCurrentChat("📊 Total", "/total"),
    Markup.button.switchToCurrentChat("📄 Laporan", "/laporan"),
  ],
  [
    Markup.button.switchToCurrentChat("🧾 Riwayat", "/riwayat"),
    Markup.button.switchToCurrentChat("🗑 Undo", "/undo"),
  ],
  [
    Markup.button.switchToCurrentChat("💡 Budget", "/budget"),
    Markup.button.switchToCurrentChat("🔁 Relink", "/relink"),
  ],
]);

const keyboardNew = (authUrl: string) =>
  Markup.inlineKeyboard([
    [Markup.button.url("🔗 Hubungkan Akun Google", authUrl)],
    [
      Markup.button.switchToCurrentChat("➕ Pengeluaran", "/catat "),
      Markup.button.switchToCurrentChat("💰 Pemasukan", "/pemasukan "),
    ],
    [
      Markup.button.switchToCurrentChat("📊 Total", "/total"),
      Markup.button.switchToCurrentChat("📄 Laporan", "/laporan"),
    ],
  ]);

// ====== LOGGING ======
bot.use(async (ctx, next) => {
  if (ctx.message && "text" in ctx.message) {
    logger.info(
      {
        user_id: ctx.from?.id,
        username: ctx.from?.username,
        message: ctx.message.text,
      },
      "Pesan diterima"
    );
  }
  await next();
});

bot.catch((err, ctx) => {
  logger.error({ err: String(err), update: ctx.update }, "Telegraf error");
});

// ====== REGEX ======
const startHelpRegex = /^(?:@\w+\s+)?\/(start|help)(?:@\w+)?\s*$/;
// 🔽 ubah: /total bisa punya argumen opsional bulan/tahun
const totalRegex = /^(?:@\w+\s+)?\/total(?:@\w+)?\s*(.*)$/s;
const laporanRegex = /^(?:@\w+\s+)?\/laporan(?:@\w+)?\s*$/;
const pemasukanRegex = /^(?:@\w+\s+)?\/pemasukan(?:@\w+)?\s*(.*)/s;
const catatRegex = /^(?:@\w+\s+)?\/catat(?:@\w+)?\s*(.*)$/s;

const relinkRegex = /^(?:@\w+\s+)?\/relink(?:@\w+)?\s*$/;

// 🔽 ubah: riwayat juga sudah bisa argumen
const riwayatRegex = /^(?:@\w+\s+)?\/riwayat(?:@\w+)?\s*(.*)$/s;

const hapusRegex = /^(?:@\w+\s+)?\/hapus(?:@\w+)?\s+([A-Za-z0-9_-]{4,})\s*$/;
const undoRegex = /^(?:@\w+\s+)?\/undo(?:@\w+)?\s*$/;

const budgetSetRegex =
  /^(?:@\w+\s+)?\/budget(?:@\w+)?\s+set\s+(.+?)\s+([+-]?[\d.,krbijtu\s]+)\s*$/s;
const budgetShowRegex = /^(?:@\w+\s+)?\/budget(?:@\w+)?\s*$/;

// ====== helper: larang bulan mendatang ======
function isFutureMonth(timestamp: string): boolean {
  const [datePart] = timestamp.split(" "); // "yyyy-MM-dd"
  const [yStr, mStr] = datePart.split("-");
  const ty = Number(yStr);
  const tm = Number(mStr);
  const [cyStr, cmStr] = formatInTimeZone(
    new Date(),
    "Asia/Jakarta",
    "yyyy-MM"
  ).split("-");
  const cy = Number(cyStr);
  const cm = Number(cmStr);
  return ty > cy || (ty === cy && tm > cm);
}

// ====== HANDLERS ======
bot.hears(relinkRegex, async (ctx) => {
  const id = ctx.from!.id;
  await clearUserData(id);
  const url = generateAuthUrl(id);
  await ctx.reply(
    "🔁 Data lama dihapus. Silakan hubungkan ulang akun Google Anda.",
    keyboardNew(url)
  );
});

bot.hears(startHelpRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const userData = await getUserData(telegramId);

  if (userData) {
    await ctx.replyWithMarkdown(helpMessageAuthed, keyboardAuthed);
  } else {
    const authUrl = generateAuthUrl(telegramId);
    logger.info({ authUrl }, "Generated OAuth URL");
    await ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }
});

bot.hears(totalRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const authClient = await getAuthenticatedClient(telegramId);
  const userData = await getUserData(telegramId);

  if (!authClient || !userData) {
    const authUrl = generateAuthUrl(telegramId);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }

  // cek apakah user memberi argumen bulan/tahun
  const arg = (ctx.match[1] || "").trim();

  if (!arg) {
    // total bulan berjalan (tetap seperti sebelumnya)
    try {
      const { totalIncome, totalExpenses, balance } = await calculateBalance(
        authClient,
        userData.spreadsheetId
      );
      const monthName = new Date().toLocaleString("id-ID", { month: "long" });
      const year = new Date().getFullYear();
      const replyMessage = `📊 *Laporan Bulan ${monthName} ${year}*\n\nPemasukan: Rp${totalIncome.toLocaleString(
        "id-ID"
      )}\nPengeluaran: Rp${totalExpenses.toLocaleString(
        "id-ID"
      )}\n--------------------\nSisa Saldo: *Rp${balance.toLocaleString(
        "id-ID"
      )}*`;
      await ctx.replyWithMarkdown(replyMessage);
    } catch (error: any) {
      const detail =
        error?.response?.data?.error?.message ||
        error?.message ||
        "Unknown error";
      logger.error(
        { user: ctx.from, err: error?.response?.data ?? detail },
        "Gagal mengambil total laporan"
      );
      await ctx.reply(
        `Maaf, terjadi kesalahan saat mengambil laporan.\n\nDetail: \`${detail}\``
      );
    }
    return;
  }

  // total untuk bulan tertentu (seperti /riwayat)
  const my = parseMonthYearArg(arg);
  if (!my) {
    return ctx.reply(
      "Format waktu tidak dikenali. Contoh:\n" +
        "• /total 03/25\n" +
        "• /total 09/2025\n" +
        "• /total september 2025\n" +
        "• /total 03-25"
    );
  }

  const sheetName = sheetNameFromMonthYear(my.month, my.year);
  const prettyLabel = new Date(my.year, my.month - 1, 1).toLocaleString(
    "id-ID",
    { month: "long", year: "numeric" }
  );

  try {
    const { totalIncome, totalExpenses, balance, sheetExists, rowCount } =
      await calculateBalance(authClient, userData.spreadsheetId, {
        sheetName,
        createIfMissing: false,
      });

    if (!sheetExists || rowCount === 0) {
      return ctx.replyWithMarkdown(
        `Belum ada transaksi pada *${prettyLabel}*.`
      );
    }

    const replyMessage = `📊 *Laporan Bulan ${prettyLabel}*\n\nPemasukan: Rp${totalIncome.toLocaleString(
      "id-ID"
    )}\nPengeluaran: Rp${totalExpenses.toLocaleString(
      "id-ID"
    )}\n--------------------\nSisa Saldo: *Rp${balance.toLocaleString(
      "id-ID"
    )}*`;
    await ctx.replyWithMarkdown(replyMessage);
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown error";
    logger.error(
      { user: ctx.from, err: error?.response?.data ?? detail },
      "Gagal mengambil total laporan (argumen)"
    );
    await ctx.reply(
      `Maaf, terjadi kesalahan saat mengambil laporan.\n\nDetail: \`${detail}\``
    );
  }
});

bot.hears(laporanRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const userData = await getUserData(telegramId);

  if (!userData) {
    const authUrl = generateAuthUrl(telegramId);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }

  const url = `https://docs.google.com/spreadsheets/d/${userData.spreadsheetId}`;
  const replyMessage = `📄 Berikut adalah link laporan Google Sheet Anda:\n\n[Buka Laporan](${url})`;
  ctx.replyWithMarkdown(replyMessage);
});

// ====== PEMASUKAN ======
bot.hears(pemasukanRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const authClient = await getAuthenticatedClient(telegramId);
  const userData = await getUserData(telegramId);

  if (!authClient || !userData) {
    const authUrl = generateAuthUrl(telegramId);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }

  const raw = ctx.match[1].trim();
  const { timestamp, rest } = parseDateAtBeginning(raw);

  if (!rest) {
    return ctx.reply(
      "❓ Format salah. Contoh: /pemasukan [tgl] 500k gaji bulanan"
    );
  }

  // >>> blokir bulan mendatang
  if (isFutureMonth(timestamp)) {
    return ctx.replyWithMarkdown(
      "⏳ *Tanggal di masa depan belum diizinkan.*\n" +
        "Kamu bisa mencatat untuk *bulan ini* atau *bulan-bulan sebelumnya* ya.\n\n" +
        "Contoh:\n" +
        "• `/pemasukan 10-08-2025 1jt gaji`\n" +
        "• `/pemasukan 500k bonus`"
    );
  }

  const match = rest.match(
    /^([+-]?(?:\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[.,]\d+)?\s*(?:rb|ribu|k|jt|juta)?)\b\s*(.*)$/is
  );
  if (!match) {
    return ctx.reply(
      "❓ Format salah. Gunakan: /pemasukan [tgl] <jumlah> [sumber]"
    );
  }

  const [, amountStr, description] = match;
  const amount = parseAmount(amountStr);
  if (isNaN(amount)) {
    return ctx.reply(`❓ Jumlah "${amountStr}" tidak valid.`);
  }

  const incomeData: TransactionRow = {
    timestamp,
    type: "Pemasukan",
    category: "Pemasukan",
    amount,
    description: description?.trim() || "-",
  };

  try {
    const id = await appendTransaction(
      authClient,
      userData.spreadsheetId,
      incomeData
    );
    const { totalIncome } = await calculateBalance(
      authClient,
      userData.spreadsheetId
    );
    await ctx.replyWithMarkdown(
      `✅ Berhasil! Pemasukan *Rp${amount.toLocaleString(
        "id-ID"
      )}* dicatat.\n` +
        `ID: \`${id}\`\n` +
        `Total bulan ini: *Rp${totalIncome.toLocaleString("id-ID")}*`
    );
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown error";
    logger.error(
      { user: ctx.from, err: error?.response?.data ?? detail },
      "Gagal mencatat pemasukan"
    );
    await ctx.reply(
      `Terjadi kesalahan saat mencatat ke Google Sheet. 😞\n\nDetail: \`${detail}\``
    );
  }
});

// ====== CATAT PENGELUARAN ======
bot.hears(catatRegex, async (ctx) => {
  const telegramId = ctx.from!.id;
  const authClient = await getAuthenticatedClient(telegramId);
  const userData = await getUserData(telegramId);

  if (!authClient || !userData) {
    const authUrl = generateAuthUrl(telegramId);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }

  const raw = ctx.match[1].trim();
  const { timestamp, rest } = parseDateAtBeginning(raw);

  if (!rest) {
    return ctx.reply(
      "❓ Format salah. Contoh: /catat [tgl] makan 15rb nasi padang"
    );
  }

  // >>> blokir bulan mendatang
  if (isFutureMonth(timestamp)) {
    return ctx.replyWithMarkdown(
      "⏳ *Tanggal di masa depan belum diizinkan.*\n" +
        "Silakan catat pengeluaran untuk *bulan ini* atau *bulan yang sudah lewat* ya.\n\n" +
        "Contoh:\n" +
        "• `/catat 03/08/25 makan 25rb nasi padang`\n" +
        "• `/catat transport 15rb gojek`"
    );
  }

  // kategori multi-kata + nilai (boleh minus)
  const match = rest.match(
    /^(.+?)\s+([+-]?(?:\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[.,]\d+)?\s*(?:rb|ribu|k|jt|juta)?)\b\s*(.*)$/is
  );
  if (!match) {
    return ctx.reply(
      "❓ Format salah. Gunakan: /catat [tgl] <kategori> <jumlah> [deskripsi]"
    );
  }

  const [, categoryRaw, amountStr, description] = match;
  const category = categoryRaw.trim();
  const amount = parseAmount(amountStr);
  if (isNaN(amount)) {
    return ctx.reply(`❓ Jumlah "${amountStr}" tidak valid.`);
  }

  try {
    const { totalIncome } = await calculateBalance(
      authClient,
      userData.spreadsheetId
    );
    if (totalIncome <= 0) {
      return ctx.replyWithMarkdown(
        "⛔️ Anda belum memiliki pemasukan bulan ini.\n" +
          "Silakan catat pemasukan terlebih dahulu:\n`/pemasukan <jumlah> [sumber]`"
      );
    }

    const expenseData: TransactionRow = {
      timestamp,
      type: "Pengeluaran",
      category,
      amount,
      description: description?.trim() || "-",
    };

    const id = await appendTransaction(
      authClient,
      userData.spreadsheetId,
      expenseData
    );
    const { balance } = await calculateBalance(
      authClient,
      userData.spreadsheetId
    );
    await ctx.replyWithMarkdown(
      `✅ Pengeluaran *${category}* *Rp${amount.toLocaleString(
        "id-ID"
      )}* dicatat.\n` +
        `ID: \`${id}\`\n` +
        `Sisa saldo bulan ini: *Rp${balance.toLocaleString("id-ID")}*`
    );
  } catch (error: any) {
    const detail =
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown error";
    logger.error(
      { user: ctx.from, err: error?.response?.data ?? detail },
      "Gagal mencatat pengeluaran"
    );
    await ctx.reply(
      `Terjadi kesalahan saat mencatat ke Google Sheet. 😞\n\nDetail: \`${detail}\``
    );
  }
});

// ====== RIWAYAT / HAPUS / UNDO ======
bot.hears(riwayatRegex, async (ctx) => {
  const id = ctx.from!.id;
  const auth = await getAuthenticatedClient(id);
  const data = await getUserData(id);
  if (!auth || !data) {
    const authUrl = generateAuthUrl(id);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }

  const arg = (ctx.match[1] || "").trim();
  let sheetNameToShow: string;
  let prettyLabel: string;

  if (arg) {
    const my = parseMonthYearArg(arg);
    if (!my) {
      return ctx.reply(
        "Format waktu tidak dikenali. Contoh:\n" +
          "• /riwayat 03/25\n" +
          "• /riwayat 09/2025\n" +
          "• /riwayat september 2025\n" +
          "• /riwayat 03-25"
      );
    }
    sheetNameToShow = sheetNameFromMonthYear(my.month, my.year);
    prettyLabel = new Date(my.year, my.month - 1, 1).toLocaleString("id-ID", {
      month: "long",
      year: "numeric",
    });
  } else {
    const now = new Date();
    sheetNameToShow = sheetNameFromMonthYear(
      now.getMonth() + 1,
      now.getFullYear()
    );
    prettyLabel = now.toLocaleString("id-ID", {
      month: "long",
      year: "numeric",
    });
  }

  // jangan buat tab kosong saat lihat riwayat bulan lain
  const rows = await listRecentTransactions(auth, data.spreadsheetId, 5, {
    sheetName: sheetNameToShow,
    createIfMissing: false,
  });

  if (rows.length === 0) {
    return ctx.replyWithMarkdown(`Belum ada transaksi pada *${prettyLabel}*.`);
  }

  const lines = rows
    .map((r) => {
      const amt = Number(r.amount || 0);
      return (
        `• ID: [${r.id}]\n` +
        `Waktu: ${formatSheetTimestampForDisplay(r.timestamp)}\n` +
        `${r.type}: ${r.category} sebesar Rp${amt.toLocaleString("id-ID")}${
          r.description ? ` — ${r.description}` : ""
        }`
      );
    })
    .join("\n");

  await ctx.replyWithMarkdown(
    `🕘 *${rows.length} transaksi terakhir (${prettyLabel})*\n${lines}\n\nHapus: \`/hapus <id>\` atau \`/undo\` untuk hapus yang terakhir (bulan berjalan).`
  );
});

bot.hears(hapusRegex, async (ctx) => {
  const id = ctx.from!.id;
  const auth = await getAuthenticatedClient(id);
  const data = await getUserData(id);
  if (!auth || !data) {
    const authUrl = generateAuthUrl(id);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }

  const targetId = ctx.match[1].trim();
  const ok = await deleteTransactionById(auth, data.spreadsheetId, targetId);
  if (!ok)
    return ctx.reply(`❌ ID \`${targetId}\` tidak ditemukan di bulan ini.`);
  return ctx.reply(
    `🗑️ Berhasil menghapus transaksi dengan ID \`${targetId}\`.`
  );
});

bot.hears(undoRegex, async (ctx) => {
  const id = ctx.from!.id;
  const auth = await getAuthenticatedClient(id);
  const data = await getUserData(id);
  if (!auth || !data) {
    const authUrl = generateAuthUrl(id);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }

  const ok = await deleteLastTransaction(auth, data.spreadsheetId);
  if (!ok) return ctx.reply("Tidak ada transaksi untuk dihapus (bulan ini).");
  return ctx.reply("↩️ Transaksi terakhir (bulan ini) telah dihapus.");
});

// ====== BUDGET ======
bot.hears(budgetSetRegex, async (ctx) => {
  const id = ctx.from!.id;
  const auth = await getAuthenticatedClient(id);
  const data = await getUserData(id);
  if (!auth || !data) {
    const authUrl = generateAuthUrl(id);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }

  const category = ctx.match[1].trim();
  const amount = parseAmount(ctx.match[2]);
  if (isNaN(amount) || amount < 0)
    return ctx.reply("Jumlah budget tidak valid.");

  await setBudget(auth, data.spreadsheetId, category, amount);
  return ctx.reply(
    `✅ Budget kategori *${category}* diset Rp${amount.toLocaleString(
      "id-ID"
    )}.`
  );
});

bot.hears(budgetShowRegex, async (ctx) => {
  const id = ctx.from!.id;
  const auth = await getAuthenticatedClient(id);
  const data = await getUserData(id);
  if (!auth || !data) {
    const authUrl = generateAuthUrl(id);
    return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
  }

  const rows = await getBudgetSummary(auth, data.spreadsheetId);
  if (!rows.length) {
    return ctx.replyWithMarkdown(
      "Belum ada budget. Set dengan: `/budget set <kategori> <jumlah>`"
    );
  }

  const lines = rows
    .map(
      (r) =>
        `• ${r.category}: budget Rp${r.budget.toLocaleString("id-ID")}, ` +
        `terpakai Rp${r.spent.toLocaleString(
          "id-ID"
        )} → sisa *Rp${r.remaining.toLocaleString("id-ID")}*`
    )
    .join("\n");

  return ctx.replyWithMarkdown(`📉 *Budget bulan ini*\n${lines}`);
});

// fallback
bot.on("text", async (ctx) => {
  const id = ctx.from!.id;
  const data = await getUserData(id);
  if (data) return ctx.replyWithMarkdown(helpMessageAuthed, keyboardAuthed);
  const authUrl = generateAuthUrl(id);
  return ctx.replyWithMarkdown(helpMessageNew(authUrl), keyboardNew(authUrl));
});

export { bot };
