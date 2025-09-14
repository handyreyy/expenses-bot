export const examples = [
  "• Mulai / bantuan: `/start` atau `/help`",
  "• Hubungkan ulang Google: `/relink`",
  "• Catat pemasukan: `/pemasukan [tgl] 500k gaji`",
  "• Catat pengeluaran: `/catat [tgl] makan 15rb nasi padang`",
  "• Lihat total: `/total [bln/tahun]` (contoh: `/total`, `/total 03-25`, `/total sep 2025`)",
  "• Lihat riwayat: `/riwayat [bln/tahun]` (contoh: `/riwayat`, `/riwayat 03/25`, `/riwayat september 2025`)",
  "• Hapus: `/undo` (hapus transaksi terakhir bulan ini) atau `/hapus <id>` (hapus transaksi tertentu, bulan ini)",
  "• Buka laporan Sheet: `/laporan`",
  "• Set budget: `/budget set makan 1jt`",
  "• Lihat budget bulan ini: `/budget`",
].join("\n");

export const dateTips =
  "🗓 *Tanggal opsional di awal perintah*\n" +
  "• Format: `dd/mm/yy`, `dd/mm/yyyy`, `dd-mm-yy`, atau `dd-mm-yyyy`.\n" +
  "• Jika tidak ditulis, otomatis pakai *tanggal hari ini* (WIB).\n" +
  "• Pencatatan *bulan mendatang* **tidak diizinkan** (akan ditolak dengan pesan ramah).\n" +
  "• Jika tanggal berada di *bulan sebelumnya*, transaksi akan masuk ke tab bulan tersebut (dibuat otomatis bila belum ada).\n\n" +
  "*Contoh catat & pemasukan:*\n" +
  "• `/catat 03/09/25 makan 15rb nasi padang`\n" +
  "• `/catat 3-9-2025 transport 25rb KRL`\n" +
  "• `/pemasukan 10-08-2024 1jt gaji`\n" +
  "• `/pemasukan 500k bonus` _(tanpa tanggal ⇒ hari ini)_\n\n" +
  "*Contoh riwayat & total per bulan:*\n" +
  "• `/riwayat` → 5 transaksi terakhir *bulan ini*\n" +
  "• `/riwayat 03/25` atau `/riwayat 03-25` atau `/riwayat september 2025`\n" +
  "• `/total` → ringkasan *bulan ini*\n" +
  "• `/total 03/25` / `/total 03-25` / `/total sep 2025`";

export const deleteTips =
  "🧹 *Bedanya `/undo` vs `/hapus <id>`*\n" +
  "• `/undo` → Menghapus *satu transaksi terakhir* di *bulan berjalan*.\n" +
  "• `/hapus <id>` → Menghapus *transaksi tertentu* di *bulan berjalan* berdasarkan *ID* (lihat ID di `/riwayat`).\n" +
  "Catatan: Saat ini penghapusan (undo/hapus) hanya berlaku untuk *bulan berjalan*.";

export const helpMessageAuthed =
  `👋 *Selamat datang kembali!*\n\n` +
  `Bot sudah terhubung dengan Google Anda dan siap dipakai.\n\n` +
  `*Contoh perintah:*\n${examples}\n\n` +
  `${dateTips}\n\n${deleteTips}`;
