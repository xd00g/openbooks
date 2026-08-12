import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
/** Mark a route as not requiring authentication. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'requiredPermissions';
/** Require the given permissions on the active company (see PermissionsGuard). */
export const RequirePermissions = (...perms: string[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);

/** Inject the authenticated user ({ id, email }). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest().user,
);

/** Inject the resolved company access ({ companyId, permissions }). */
export const CompanyAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest().companyAccess,
);
