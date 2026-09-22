const REDACTED = '[REDACTED]';

const AUTHORIZATION_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[^\s"',;]+/giu,
  /\b(authorization["']?\s*[:=]\s*["']?)(?!Bearer\b)[^\s"',;]+/giu,
];

/**
 * Removes every known secret value and anything shaped like an authorization
 * header value. Applied to every line the procedure prints and to every error
 * message it reports, so a secret cannot leak through a thrown error either.
 */
export const redact = (text: string, secrets: readonly string[]): string => {
  let result = text;
  for (const secret of secrets) {
    if (secret.length > 0) result = result.replaceAll(secret, REDACTED);
  }
  for (const pattern of AUTHORIZATION_PATTERNS) {
    result = result.replace(pattern, (match, prefix?: unknown) =>
      typeof prefix === 'string'
        ? `${prefix}${REDACTED}`
        : `Bearer ${REDACTED}`,
    );
  }
  return result;
};
