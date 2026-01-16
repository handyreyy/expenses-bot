import { Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';

@Controller('api/webhook')
export class WebhookController {
  constructor(@InjectBot() private readonly bot: Telegraf<Context>) {}

  @Post()
  async onWebhook(@Req() req: Request, @Res() res: Response) {
    if (!req.body) {
        return res.status(400).send('No body');
    }
    // Handle the update manually
    // Log usage
    console.log(`[Webhook] Received update: ${JSON.stringify(req.body).slice(0, 100)}...`);

    try {
        await this.bot.handleUpdate(req.body, res);
        
        // Ensure response is sent if telegraf didn't send it
        if (!res.headersSent) {
            res.status(200).send('OK');
        }
    } catch (e: any) {
        console.error('Webhook handling error:', e);
        // CRITICAL: Always return 200 to Telegram even on error, 
        // otherwise it will retry infinitely and clog the queue.
        if (!res.headersSent) {
             res.status(200).send('OK (Handled Error)');
        }
    }
  }
}
