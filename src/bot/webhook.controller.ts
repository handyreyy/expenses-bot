import { Controller, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';

@Controller('webhook')
export class WebhookController {
  constructor(@InjectBot() private readonly bot: Telegraf<Context>) {}

  @Post()
  async onWebhook(@Req() req: Request, @Res() res: Response) {
    if (!req.body) {
        return res.status(400).send('No body');
    }
    // Handle the update manually
    try {
        await this.bot.handleUpdate(req.body, res);
        // Note: handleUpdate usually handles the response if response object is passed.
        // If not, we might need to send 200 OK manually. 
        // Telegraf docs say: if res is passed, it uses it.
        
        if (!res.headersSent) {
            res.status(200).send('OK');
        }
    } catch (e) {
        console.error('Webhook handling error:', e);
        if (!res.headersSent) {
             res.status(500).send('Error');
        }
    }
  }
}
