import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
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
        launchOptions: {
          webhook: {
            domain: configService.get<string>('SERVER_URL')!,
            hookPath: configService.get<string>('WEBHOOK_PATH') || '/webhook',
          },
        },
      }),
      inject: [ConfigService],
    }),
    BotModule,
    GoogleModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
