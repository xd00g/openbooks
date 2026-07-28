import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AUDITED_METHODS, domainFromPath, pickRecordId } from './audit.util';

/**
 * Records a coarse audit entry for every successful mutating request on a
 * company-scoped route. Reads (GET) and non-tenant routes (login, onboarding)
 * are skipped. Fire-and-forget: an audit failure never affects the response.
 *
 * Richer before/after diffs can be added per-service later; this gives a
 * complete "who did what, when" trail for the Admin audit view out of the box.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    if (!AUDITED_METHODS.has(req.method)) return next.handle();

    return next.handle().pipe(
      tap((body) => {
        const companyId: string | undefined =
          req.companyAccess?.companyId ?? req.headers?.['x-company-id'];
        if (!companyId) return; // non-tenant route (auth/onboarding) — skip

        const path: string = req.route?.path ?? req.originalUrl ?? req.url ?? '';
        void this.audit
          .record(companyId, {
            actorUserId: req.user?.id ?? null,
            action: `${req.method} ${path}`,
            tableName: domainFromPath(req.originalUrl ?? req.url ?? path),
            recordId: pickRecordId(body) ?? pickRecordId(req.params),
            requestId: req.headers?.['x-request-id'] ?? null,
          })
          .catch(() => {
            /* audit must never break the request */
          });
      }),
    );
  }
}
