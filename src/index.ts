// src/index.ts
import { config } from "dotenv";
config();

import type { VercelRequest, VercelResponse } from "@vercel/node";
import express from "express";
import { google } from "googleapis";
import { bot } from "./bot";
import logger from "./logger";
import {
  createNewAuthenticatedClient,
  getRedirectUri,
  saveUserData,
} from "./services/googleAuth";
import { createSpreadsheet } from "./services/googleSheet";

const app = express();
app.use(express.json());

const api = express.Router();

// Healthcheck
api.get("/ping", (_req, res) => res.status(200).send("Pong! Server idup!"));

api.get("/debug/oauth", (_req, res) => {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON || "{}");
  res.json({
    server_url: (process.env.SERVER_URL || "").replace(/\/$/, ""),
    chosen_redirect: getRedirectUri(),
    client_id: creds?.web?.client_id || null,
    redirect_uris_in_env: creds?.web?.redirect_uris || [],
  });
});

// OAuth callback
api.get("/oauth2callback", async (req, res) => {
  const { code, state } = req.query;
  const telegramId = state ? parseInt(state as string, 10) : null;

  if (!code || !telegramId)
    return res.status(400).send("Missing code or state");

  try {
    const { authClient, tokens } = await createNewAuthenticatedClient(
      code as string
    );

    const spreadsheetId = await createSpreadsheet(
      authClient,
      "Laporan Keuangan (Bot)"
    );
    if (!spreadsheetId) throw new Error("Gagal membuat spreadsheet");

    const oauth2 = google.oauth2({ version: "v2", auth: authClient });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email;

    if (userEmail) {
      const drive = google.drive({ version: "v3", auth: authClient });
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { role: "writer", type: "user", emailAddress: userEmail },
      });
      logger.info({ userEmail }, "Akses editor diberikan");
    }

    await saveUserData(telegramId, { spreadsheetId, tokens });
    await bot.telegram.sendMessage(
      telegramId,
      "✅ Akun Anda berhasil terhubung! Silakan ketik /start lagi."
    );

    res.send("Otentikasi berhasil! Anda bisa menutup halaman ini.");
  } catch (error: any) {
    logger.error(error, "Error during OAuth2 callback");
    if (telegramId) {
      await bot.telegram.sendMessage(
        telegramId,
        `Gagal terhubung dengan Google. 😞\n\n*Penyebab:* ${error.message}`
      );
    }
    res.status(500).send("Terjadi kesalahan. Cek bot Telegram Anda.");
  }
});

// --- Webhook Telegram (secret dari ENV, tetap) ---
const WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET || "local-dev-secret";
const secretPath = `/telegraf/${WEBHOOK_SECRET}`;

// Endpoint debug (cek URL yang diharapkan)
api.get("/debug/webhook", (_req, res) => {
  const base = (process.env.SERVER_URL || "").replace(/\/$/, "");
  res.json({
    base,
    secretPath,
    expectedWebhookUrl: `${base}${secretPath}`,
  });
});

// 1) Log SEMUA metode ke path webhook (supaya kelihatan di logs)
api.all(secretPath, (req, res, next) => {
  logger.info(
    { method: req.method, path: req.originalUrl, url: req.url },
    "Incoming Telegram webhook"
  );
  next();
});

// 2) Tangkap GET (beberapa platform probe pakai GET) → balas 200 OK
api.get(secretPath, (_req, res) => {
  res.status(200).send("OK");
});

// 3) Tangkap POST ke webhook → serahkan ke Telegraf
api.post(secretPath, bot.webhookCallback(secretPath));

// Mount router /api
app.use("/api", api);

// --- Setup bot: commands + webhook ---
const commands = [
  { command: "start", description: "Hubungkan akun atau lihat bantuan" },
  { command: "help", description: "Tampilkan menu bantuan" },
  { command: "pemasukan", description: "Catat pemasukan bulanan" },
  { command: "catat", description: "Catat pengeluaran harian" },
  { command: "total", description: "Cek ringkasan keuangan bulan ini" },
  { command: "laporan", description: "Dapatkan link Google Sheet pribadi" },
];

async function setupBot() {
  try {
    await bot.telegram.setMyCommands(commands);

    const base = (process.env.SERVER_URL || "").replace(/\/$/, ""); // ex: https://.../api
    const webhookUrl = `${base}${secretPath}`;

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
