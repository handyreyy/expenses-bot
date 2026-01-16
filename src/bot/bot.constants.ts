import { Markup } from 'telegraf';

export const REGEX = {
  startHelp: /^(?:@\w+\s+)?\/(start|help)(?:@\w+)?\s*$/,
  total: /^(?:@\w+\s+)?\/total(?:@\w+)?\s*(.*)$/s,
  laporan: /^(?:@\w+\s+)?\/laporan(?:@\w+)?\s*$/,
  pemasukan: /^(?:@\w+\s+)?\/pemasukan(?:@\w+)?\s*(.*)/s,
  catat: /^(?:@\w+\s+)?\/catat(?:@\w+)?\s*(.*)$/s,
  relink: /^(?:@\w+\s+)?\/relink(?:@\w+)?\s*$/,
  riwayat: /^(?:@\w+\s+)?\/riwayat(?:@\w+)?\s*(.*)$/s,
  hapus: /^(?:@\w+\s+)?\/hapus(?:@\w+)?\s+([A-Za-z0-9_-]{4,})\s*$/,
  undo: /^(?:@\w+\s+)?\/undo(?:@\w+)?\s*$/,
  budgetSet: /^(?:@\w+\s+)?\/budget(?:@\w+)?\s+set\s+(.+?)\s+([+-]?[\d.,krbijtu\s]+)\s*$/s,
  budgetShow: /^(?:@\w+\s+)?\/budget(?:@\w+)?\s*$/,
};

export const KEYBOARDS = {
  authed: Markup.inlineKeyboard([
    [
      Markup.button.switchToCurrentChat('➕ Pengeluaran', '/catat '),
      Markup.button.switchToCurrentChat('💰 Pemasukan', '/pemasukan '),
    ],
    [
      Markup.button.switchToCurrentChat('📊 Total', '/total'),
      Markup.button.switchToCurrentChat('📄 Laporan', '/laporan'),
    ],
    [
      Markup.button.switchToCurrentChat('🧾 Riwayat', '/riwayat'),
      Markup.button.switchToCurrentChat('🗑 Undo', '/undo'),
    ],
    [
      Markup.button.switchToCurrentChat('💡 Budget', '/budget'),
      Markup.button.switchToCurrentChat('🔁 Relink', '/relink'),
    ],
  ]),
  new: (authUrl: string) =>
    Markup.inlineKeyboard([
      [Markup.button.url('🔗 Hubungkan Akun Google', authUrl)],
      [
        Markup.button.switchToCurrentChat('➕ Pengeluaran', '/catat '),
        Markup.button.switchToCurrentChat('💰 Pemasukan', '/pemasukan '),
      ],
      [
        Markup.button.switchToCurrentChat('📊 Total', '/total'),
        Markup.button.switchToCurrentChat('📄 Laporan', '/laporan'),
      ],
    ]),
};
