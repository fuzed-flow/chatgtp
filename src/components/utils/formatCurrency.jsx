/**
 * Format a number as USD currency with commas
 * @param {number} amount - The amount to format
 * @returns {string} - Formatted currency string (e.g., "1,234.56")
 */
export function formatCurrency(amount) {
  if (amount === null || amount === undefined) {
    return "0.00";
  }
  
  const num = parseFloat(amount);
  if (isNaN(num)) {
    return "0.00";
  }
  
  return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a number as USD currency with $ prefix and commas
 * @param {number} amount - The amount to format
 * @returns {string} - Formatted currency string (e.g., "$1,234.56")
 */
export function formatCurrencyUSD(amount) {
  return `$${formatCurrency(amount)}`;
}

export function getCompanyCurrency(companyOrSettings) {
  const settings = companyOrSettings?.settings || companyOrSettings || {};
  const candidate = String(settings.currency || "CAD").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(candidate) ? candidate : "CAD";
}

export function formatCurrencyForCompany(amount, companyOrSettings, locale) {
  const value = Number(amount);
  const currency = getCompanyCurrency(companyOrSettings);
  return new Intl.NumberFormat(locale || undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}
