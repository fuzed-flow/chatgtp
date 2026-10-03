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