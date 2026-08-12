import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { OidcProvider } from './providers/oidc.provider';
import { SamlProvider } from './providers/saml.provider';
import { CurrentUser, Public } from './decorators';
import { signJwt, verifyJwt } from './crypto/jwt';

/**
 * Auth endpoints. Local login and the SSO start/callback routes are @Public
 * (they establish the session). /me requires a valid session.
 *
 * OIDC transaction state (state + PKCE verifier) is carried in a short-lived,
 * signed `tx` token returned by /oidc/start and handed back on /oidc/callback —
 * so no server-side session store is needed for the SPA.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly oidc: OidcProvider,
    private readonly saml: SamlProvider,
  ) {}

  @Public()
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    if (!body?.email || !body?.password) {
      throw new BadRequestException('email and password are required.');
    }
    return this.auth.loginLocal(body.email, body.password);
  }

  @Public()
  @Get('providers')
  providers() {
    return {
      local: true,
      oidc: this.oidc.configured,
      saml: this.saml.configured,
    };
  }

  @Public()
  @Get('oidc/start')
  async oidcStart() {
    if (!this.oidc.configured) throw new BadRequestException('OIDC not configured.');
    const { url, state, codeVerifier, nonce } = await this.oidc.buildAuthorizeUrl();
    // Sign the transaction so the callback can trust state + verifier + nonce.
    const tx = signJwt(
      { sub: 'oidc-tx', state, codeVerifier, nonce },
      process.env.JWT_SECRET ?? '',
      { expiresInSec: 600 },
    );
    return { authorizeUrl: url, tx };
  }

  @Public()
  @Get('oidc/callback')
  async oidcCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('tx') tx: string,
  ) {
    if (!code || !state || !tx) {
      throw new BadRequestException('code, state, and tx are required.');
    }
    let claims;
    try {
      claims = verifyJwt(tx, process.env.JWT_SECRET ?? '');
    } catch {
      throw new UnauthorizedException('Invalid transaction token.');
    }
    if (claims.state !== state) {
      throw new UnauthorizedException('State mismatch.');
    }
    const profile = await this.oidc.handleCallback(
      code,
      String(claims.codeVerifier),
      String(claims.nonce ?? ''),
    );
    return this.auth.provisionFromProfile(profile);
  }

  @Public()
  @Get('saml/start')
  async samlStart() {
    if (!this.saml.configured) throw new BadRequestException('SAML not configured.');
    return this.saml.buildAuthorizeUrl();
  }

  @Public()
  @Post('saml/callback')
  async samlCallback(@Body() body: { SAMLResponse: string }) {
    const profile = await this.saml.validateResponse(body?.SAMLResponse);
    return this.auth.provisionFromProfile(profile);
  }

  @Get('me')
  me(@CurrentUser() user: { id: string }) {
    return this.auth.me(user.id);
  }

  @Post('logout')
  logout() {
    // Stateless JWT: the client discards the token. (Add a denylist here if you
    // need server-side revocation.)
    return { ok: true };
  }
}
