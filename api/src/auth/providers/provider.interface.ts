/**
 * Auth provider abstraction. Each provider authenticates a user by its own
 * mechanism and returns a normalized profile; AuthService then JIT-provisions a
 * local user and issues the app session JWT. This keeps OIDC, SAML, and local
 * auth interchangeable (docs/DESIGN.md §8).
 */
export interface AuthenticatedProfile {
  provider: 'local' | 'oidc' | 'saml';
  subject: string; // provider-native id (oidc sub / saml NameID / local user id)
  email: string;
  fullName?: string;
  groups?: string[]; // for group -> role mapping
}
