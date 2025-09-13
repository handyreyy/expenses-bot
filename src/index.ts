import { config } from "dotenv";
config();

import type { VercelRequest, VercelResponse } from "@vercel/node";
import express from "express";
import { bot } from "./bot";
import { SERVER_URL, WEBHOOK_PATH } from "./config";
import logger from "./logger";
import oauthRouter from "./routes/oauth";
import webhookRouter from "./routes/webhook";

const app = express();
app.use(express.json());

// mount semua route di /api
const api = express.Router();
api.use(oauthRouter);
api.use(webhookRouter);
app.use("/api", api);

// --- Setup bot: commands + webhook (sekali saat cold start) ---
const commands = [
  { command: "start", description: "Hubungkan akun atau lihat bantuan" },
  { command: "help", description: "Tampilkan menu bantuan" },
  { command: "pemasukan", description: "Catat pemasukan bulanan" },
  { command: "catat", description: "Catat pengeluaran harian" },
  { command: "total", description: "Cek ringkasan keuangan bulan ini" },
  { command: "laporan", description: "Dapatkan link Google Sheet pribadi" },
  { command: "relink", description: "Hubungkan ulang Google" },
];

async function setupBot() {
  try {
    await bot.telegram.setMyCommands(commands);

    const webhookUrl = `${SERVER_URL}${WEBHOOK_PATH}`;
    await bot.telegram.setWebhook(webhookUrl, { drop_pending_updates: true });

    const me = await bot.telegram.getMe();
    logger.info({ webhookUrl }, "Webhook diset");
    logger.info(`Bot berjalan sebagai @${me.username}`);
  } catch (error) {
    logger.error(error, "Gagal mengatur webhook/getMe");
  }
}
setupBot();

// Vercel entrypoint
export default function handler(req: VercelRequest, res: VercelResponse) {
  return (app as any)(req, res);
}

// Dev lokal opsional
if (!process.env.VERCEL && require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => logger.info(`Dev server on http://localhost:${port}`));
}
