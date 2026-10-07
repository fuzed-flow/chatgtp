const E164_PHONE = /^\+[1-9]\d{7,14}$/;

export function normalizeOptionalPhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  return trimmed.replace(/[\s().-]/g, '');
}

export function isValidOptionalPhone(value) {
  const normalized = normalizeOptionalPhone(value);
  return normalized === null || E164_PHONE.test(normalized);
}

