import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Resolves the active company for the request and stashes it on the request
 * object. Downstream services call `prisma.forCompany(req.companyId, ...)` so
 * PostgreSQL RLS scopes every query to that tenant.
 *
 * Source of truth for the company id (in priority order), TODO as auth lands:
 *   1. verified from the user's session/JWT + membership check
 *   2. the `X-Company-Id` header (validated against the user's memberships)
 *
 * SECURITY: never trust the header alone — it must be checked against the
 * authenticated user's memberships before being used.
 */
declare module 'express' {
  interface Request {
    companyId?: string;
  }
}

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const headerCompany = req.header('x-company-id') ?? undefined;
    // TODO: validate headerCompany against req.user's memberships once
    // AuthModule exists. For now we just pass it through for local dev.
    req.companyId = headerCompany;
    next();
  }
}
