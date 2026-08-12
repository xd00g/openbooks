import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

// Prisma returns BigInt for some columns (e.g. attachment.sizeBytes); JSON can't
// serialize BigInt natively, which surfaced as 500s when returning attachments.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Full QuickBooks IIF exports (and other bulk imports) easily exceed Express's
  // stock 100kb body limit, which surfaced as HTTP 413 "request entity too large".
  app.use(json({ limit: '25mb' }));
  app.use(urlencoded({ extended: true, limit: '25mb' }));

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableCors({ origin: true, credentials: true });

  // OpenAPI / Swagger — the web UI is just the first client of this API.
  const config = new DocumentBuilder()
    .setTitle('OpenBooks API')
    .setDescription('Self-hosted small-business accounting')
    .setVersion('0.0.1')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, doc);

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`OpenBooks API listening on :${port}  (docs at /docs)`);
}

bootstrap();
