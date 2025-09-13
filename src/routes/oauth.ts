import { Router } from "express";
import { google } from "googleapis";
import { getRedirectUri } from "../config";
import logger from "../logger";
import {
  createNewAuthenticatedClient,
  saveUserData,
} from "../services/googleAuth";
import { createSpreadsheet } from "../services/googleSheet";

const router = Router();

// Healthcheck
router.get("/ping", (_req, res) => res.status(200).send("Pong! Server idup!"));

// Debug OAuth setup
router.get("/debug/oauth", (_req, res) => {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON || "{}");
  res.json({
    server_url: (process.env.SERVER_URL || "").replace(/\/$/, ""),
    chosen_redirect: getRedirectUri(),
    client_id: creds?.web?.client_id || null,
    redirect_uris_in_env: creds?.web?.redirect_uris || [],
  });
});

// OAuth callback
router.get("/oauth2callback", async (req, res) => {
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
    const { data } = await oauth2.userinfo.get();

    if (data.email) {
      const drive = google.drive({ version: "v3", auth: authClient });
      await drive.permissions.create({
        fileId: spreadsheetId,
        requestBody: { role: "writer", type: "user", emailAddress: data.email },
      });
      logger.info({ userEmail: data.email }, "Akses editor diberikan");
    }

    await saveUserData(telegramId, { spreadsheetId, tokens });

    const { bot } = await import("../bot");
    await bot.telegram.sendMessage(
      telegramId,
      "✅ Akun Anda berhasil terhubung! Silakan ketik /start lagi."
    );

    res.send("Otentikasi berhasil! Anda bisa menutup halaman ini.");
  } catch (error: any) {
    logger.error(error, "Error during OAuth2 callback");
    if (telegramId) {
      const { bot } = await import("../bot");
      await bot.telegram.sendMessage(
        telegramId,
        `Gagal terhubung dengan Google. 😞\n\n*Penyebab:* ${error.message}`
      );
    }
    res.status(500).send("Terjadi kesalahan. Cek bot Telegram Anda.");
  }
});

export default router;
