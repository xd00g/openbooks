import { hashPassword, verifyPassword } from '../crypto/password';
import { signJwt, verifyJwt, JwtError } from '../crypto/jwt';
import { codeChallengeS256 } from '../crypto/pkce';
import { hasPermission, hasAllPermissions, resolveCompanyAccess } from '../authz';

describe('password', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const h = hashPassword('correct horse battery');
    expect(verifyPassword('correct horse battery', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });
  it('rejects short passwords', () => {
    expect(() => hashPassword('short')).toThrow();
  });
});

describe('jwt', () => {
  const secret = 'test-secret';
  it('signs and verifies', () => {
    const t = signJwt({ sub: 'u1', email: 'a@b.c' }, secret, { expiresInSec: 60 });
    expect(verifyJwt(t, secret).sub).toBe('u1');
  });
  it('rejects a tampered token', () => {
    const t = signJwt({ sub: 'u1' }, secret);
    const bad = t.slice(0, -2) + (t.endsWith('a') ? 'bb' : 'aa');
    expect(() => verifyJwt(bad, secret)).toThrow(JwtError);
  });
  it('rejects a wrong secret', () => {
    const t = signJwt({ sub: 'u1' }, secret);
    expect(() => verifyJwt(t, 'other')).toThrow(JwtError);
  });
  it('rejects an expired token', () => {
    const t = signJwt({ sub: 'u1' }, secret, { expiresInSec: -1 });
    expect(() => verifyJwt(t, secret)).toThrow(/expired/i);
  });
});

describe('pkce', () => {
  it('matches the RFC 7636 S256 vector', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('authz', () => {
  it('handles wildcard, resource wildcard, and exact', () => {
    expect(hasPermission(['*'], 'anything:goes')).toBe(true);
    expect(hasPermission(['invoice:*'], 'invoice:create')).toBe(true);
    expect(hasPermission(['invoice:create'], 'invoice:create')).toBe(true);
    expect(hasPermission(['invoice:create'], 'invoice:delete')).toBe(false);
  });
  it('checks all required', () => {
    expect(hasAllPermissions(['invoice:*', 'report:view'], ['invoice:create', 'report:view'])).toBe(true);
    expect(hasAllPermissions(['invoice:create'], ['invoice:create', 'report:view'])).toBe(false);
  });
  it('resolves company access from memberships', () => {
    const m = [
      { companyId: 'A', organizationId: 'O', permissions: ['*'] },
      { companyId: 'B', organizationId: 'O', permissions: ['report:view'] },
    ];
    expect(resolveCompanyAccess(m, 'B')?.permissions).toEqual(['report:view']);
    expect(resolveCompanyAccess(m, 'C')).toBeNull();
  });
});
