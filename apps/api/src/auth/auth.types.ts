export type SystemRole = 'ADMIN' | 'MEMBER';

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: SystemRole;
  tokenVersion: number;
};

export type AccessTokenClaims = {
  sub: string;
  username: string;
  role: SystemRole;
  tokenVersion: number;
  jti: string;
};
