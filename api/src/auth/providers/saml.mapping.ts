import { AuthenticatedProfile } from './provider.interface';

/**
 * Pure mapping from a parsed SAML profile to our normalized profile. Kept free
 * of the node-saml import so it's unit-testable in isolation.
 */
export function mapSamlAssertion(profile: {
  nameID: string;
  email?: string;
  attributes?: Record<string, string | string[]>;
}): AuthenticatedProfile {
  const attrs = profile.attributes ?? {};
  const groupsRaw = attrs['groups'] ?? attrs['memberOf'];
  const groups = Array.isArray(groupsRaw) ? groupsRaw : groupsRaw ? [groupsRaw] : [];
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return {
    provider: 'saml',
    subject: profile.nameID,
    email: String(profile.email ?? first(attrs['email']) ?? ''),
    fullName: first(attrs['displayName']) || undefined,
    groups,
  };
}
