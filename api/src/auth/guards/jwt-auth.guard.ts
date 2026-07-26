import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators';
import { verifyJwt } from '../crypto/jwt';

/** Validates the session JWT and attaches req.user = { id, email }. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }
    try {
      const payload = verifyJwt(header.slice(7), process.env.JWT_SECRET ?? '');
      req.user = { id: payload.sub, email: payload.email };
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }
    return true;
  }
}
