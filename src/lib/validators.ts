export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ARTA_RE = /^ARTA-\d{4}-\d{5}$/;
export const OTP_RE = /^\d{6}$/;
export const PHONE_RE = /^09\d{9}$/;

export const MAX_LENGTHS = {
  fullName: 100,
  cellphone: 20,
  email: 200,
  district: 100,
  schoolName: 200,
  personName: 150,
  personPosition: 150,
  description: 4000,
} as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length === 12) return `0${digits.slice(2)}`;
  return digits;
}
