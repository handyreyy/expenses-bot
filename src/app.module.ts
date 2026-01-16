import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { AiModule } from './ai/ai.module';
import { BotModule } from './bot/bot.module';
import { RequestLoggerMiddleware } from './common/middleware/logging.middleware';
import { GoogleModule } from './google/google.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        token: configService.get<string>('BOT_TOKEN')!,
        // Local: auto-launch (undefined) -> Long Polling
        // Production (Vercel): false -> Webhook (Serverless)
        launchOptions: process.env.NODE_ENV === 'production' ? false : undefined,
      }),
      inject: [ConfigService],
    }),
    BotModule,
    GoogleModule,
    AiModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
