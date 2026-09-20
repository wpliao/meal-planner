export interface VerifiedIdentity {
  subject: string;
  email: string;
}

export interface IdentityEnv {
  APP_ENV: 'local' | 'development' | 'production';
  CF_ACCESS_AUD?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
}
