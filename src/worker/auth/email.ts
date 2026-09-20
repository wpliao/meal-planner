import { invalidRequest } from '../errors';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export const normalizeEmail = (value: string): string =>
  value.trim().toLowerCase();

export const isValidEmail = (value: string): boolean =>
  value.length <= 254 && EMAIL_PATTERN.test(value);

export const requireNormalizedEmail = (value: unknown): string => {
  if (typeof value !== 'string') {
    throw invalidRequest('Email must be a string.');
  }

  const email = normalizeEmail(value);
  if (!isValidEmail(email)) {
    throw invalidRequest('Enter a valid email address.');
  }

  return email;
};
