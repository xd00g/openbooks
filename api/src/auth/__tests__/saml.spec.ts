import { mapSamlAssertion } from '../providers/saml.mapping';

describe('mapSamlAssertion', () => {
  it('maps NameID + email + groups', () => {
    const p = mapSamlAssertion({
      nameID: 'user@example.com',
      email: 'user@example.com',
      attributes: { displayName: 'Jane User', groups: ['admins', 'finance'] },
    });
    expect(p.provider).toBe('saml');
    expect(p.subject).toBe('user@example.com');
    expect(p.email).toBe('user@example.com');
    expect(p.fullName).toBe('Jane User');
    expect(p.groups).toEqual(['admins', 'finance']);
  });

  it('normalizes single-value attributes and memberOf', () => {
    const p = mapSamlAssertion({
      nameID: 'abc',
      attributes: { email: ['a@b.c'], memberOf: 'ops' },
    });
    expect(p.email).toBe('a@b.c');
    expect(p.groups).toEqual(['ops']);
  });

  it('tolerates a bare assertion with no attributes', () => {
    const p = mapSamlAssertion({ nameID: 'x' });
    expect(p.email).toBe('');
    expect(p.groups).toEqual([]);
  });
});
