const ZERO_WIDTH_EMAIL_CHARS = /[\u200B-\u200D\uFEFF]/g;
const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string) {
  return email.replace(ZERO_WIDTH_EMAIL_CHARS, "").trim().toLowerCase();
}

export function isValidEmail(email: string) {
  return BASIC_EMAIL_PATTERN.test(email);
}
