import { Controller, Get, Logger, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { google } from 'googleapis';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { helpMessageAuthed } from '../constants/helpers';
import { GoogleAuthService } from '../google/google-auth.service';
import { GoogleSheetService } from '../google/google-sheet.service';
import { KEYBOARDS } from './bot.constants';

@Controller('api')
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(
    @InjectBot() private readonly bot: Telegraf<Context>,
    private readonly googleAuthService: GoogleAuthService,
    private readonly googleSheetService: GoogleSheetService,
    private readonly configService: ConfigService,
  ) {}

  @Get('ping')
  ping() {
    return 'Pong! Server idup!';
  }

  @Get('debug/oauth')
  debugOauth() {
    const credsJson = this.configService.get('GOOGLE_CREDENTIALS_JSON');
    const creds = JSON.parse(credsJson || '{}');
    return {
      server_url: (this.configService.get('SERVER_URL') || '').replace(/\/$/, ''),
      client_id: creds?.web?.client_id || null,
      redirect_uris_in_env: creds?.web?.redirect_uris || [],
    };
  }

  @Get('set-webhook')
  async setWebhook(@Res() res: Response) {
    const serverUrl = this.configService.get<string>('SERVER_URL');
    if (!serverUrl) {
      return res.status(500).send('SERVER_URL belum diset di Environment Variables.');
    }
    // Ensure proper URL construction (avoid double /api)
    // If global prefix is 'api', we need to account for it manually if we build the string.
    // However, if SERVER_URL is just the domain, we append /api/webhook.
    // If SERVER_URL ends with /api, we handle that.
    
    let baseUrl = serverUrl.replace(/\/$/, ''); // remove trailing slash
    if (baseUrl.endsWith('/api')) {
        baseUrl = baseUrl.slice(0, -4); // remove /api suffix if present
    }
    const webhookUrl = `${baseUrl}/api/webhook`;
    
    try {
      await this.bot.telegram.setWebhook(webhookUrl);
      return res.send(`webhook setup ok: ${webhookUrl}`);
    } catch (e: any) {
      return res.status(500).send(`Gagal set webhook: ${e.message}`);
    }
  }

  @Get('oauth2callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const telegramId = state ? parseInt(state, 10) : null;
    if (!code || !telegramId) {
      return res.status(400).send('Missing code or state');
    }

    try {
      const { authClient, tokens } =
        await this.googleAuthService.createNewAuthenticatedClient(code);

      // Check if user already has data (for re-linking)
      const existingData = await this.googleAuthService.getUserData(telegramId);
      let spreadsheetId = existingData?.spreadsheetId;

      if (!spreadsheetId) {
        const id = await this.googleSheetService.createSpreadsheet(
          authClient,
          'Laporan Keuangan (Bot)',
        );
        if (id) spreadsheetId = id;
      }
      
      if (!spreadsheetId) throw new Error('Gagal membuat/menemukan spreadsheet');

      // Add permission (Idempotent: Google API handles duplicate permissions gracefully or we can ignore)
      // Ideally we only do this if it's new, but re-adding ensures access if user accidentally removed it.
      const oauth2 = google.oauth2({ version: 'v2', auth: authClient });
      const { data } = await oauth2.userinfo.get();
      if (data.email) {
        const drive = google.drive({ version: 'v3', auth: authClient });
        await drive.permissions.create({
          fileId: spreadsheetId,
          requestBody: { role: 'writer', type: 'user', emailAddress: data.email },
        });
        this.logger.log(`Akses editor diberikan ke ${data.email}`);
      }

      await this.googleAuthService.saveUserData(telegramId, {
        spreadsheetId,
        tokens,
      });

      await this.bot.telegram.sendMessage(
        telegramId,
        '✅ *Login Berhasil!*\n\n' + helpMessageAuthed,
        { parse_mode: 'Markdown', ...KEYBOARDS.authed }
      );

      // Fetch bot info for the link
      const botInfo = await this.bot.telegram.getMe();
      const botUsername = botInfo.username;

      const html = `
      <!DOCTYPE html>
      <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Kubera Bot - Otentikasi Berhasil</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
        <style>body { font-family: 'Inter', sans-serif; }</style>
      </head>
      <body class="bg-gray-100 min-h-screen flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full text-center space-y-6">
          <div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <svg class="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          
          <div class="space-y-2">
            <h1 class="text-2xl font-bold text-gray-800">Berhasil Terhubung!</h1>
            <p class="text-gray-600">Akun Google Anda telah sukses ditautkan dengan Kubera Bot.</p>
          </div>

          <div class="bg-blue-50 text-blue-800 text-sm p-4 rounded-lg">
            Silakan kembali ke Telegram, bot sudah siap digunakan.
          </div>

          <a href="https://t.me/${botUsername}" class="block w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-xl transition-colors text-decoration-none">
            Kembali ke Telegram
          </a>
          
          <div class="text-xs text-gray-400 mt-4">
            Atau tutup tab ini secara manual jika tombol tidak bekerja.
          </div>
        </div>
      </body>
      </html>
      `;
      res.send(html);
    } catch (error: any) {
      console.error('OAuth Error Full:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
      this.logger.error(error?.message || error, 'Error during OAuth2 callback');
      if (telegramId) {
        try {
            await this.bot.telegram.sendMessage(
              telegramId,
              `Gagal terhubung dengan Google. 😞\n\n*Penyebab:* ${error.message}`,
            );
        } catch (e) {
            this.logger.error(e, 'Failed to send error message to user');
        }
      }
      res.status(500).send('Terjadi kesalahan. Cek bot Telegram Anda.');
    }
  }
}
