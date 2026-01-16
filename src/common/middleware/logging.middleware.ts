import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, body } = req;
    
    // Log incoming request
    this.logger.log(`Incoming Request: ${method} ${originalUrl}`);
    if (body && Object.keys(body).length > 0) {
      this.logger.debug(`Body: ${JSON.stringify(body)}`);
    }

    res.on('finish', () => {
      const { statusCode } = res;
      this.logger.log(`Response: ${method} ${originalUrl} ${statusCode}`);
    });

    next();
  }
}
