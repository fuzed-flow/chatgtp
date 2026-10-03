/**
 * PDF Styling Utility
 * Converts PDF customization settings to jsPDF compatible styles
 */

// --- HEX TO RGB CONVERTER EXPORT ---
export const hexToRgbArray = (hex) => {
  if (!hex) return [245, 158, 11]; // Default Amber
  let c = hex.substring(1).split('');
  if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
  c = '0x' + c.join('');
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
};

export const getPDFTemplateStyles = (settings) => {
  if (!settings) {
    return getDefaultPDFStyles();
  }

  // Look at the new nested PDF settings block
  const pdfSettings = settings.pdf || {};

  return {
    // Colors
    primaryColor: pdfSettings.primary_color || '#0f172a',
    accentColor: pdfSettings.brand_color || '#f59e0b', // <-- Tied to new brand_color
    headerBgColor: pdfSettings.header_background_color || '#0f172a',
    headerTextColor: pdfSettings.header_text_color || '#ffffff',
    footerColor: pdfSettings.footer_color || '#64748b',

    // Typography
    fontFamily: getFontFamily(pdfSettings.font_family),
    baseFontSize: pdfSettings.font_size_base || 11,
    lineSpacing: pdfSettings.line_spacing || 1.5,

    // Layout
    pageLayout: pdfSettings.page_layout || 'single-column',
    pageMargins: pdfSettings.page_margins || { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
    itemBorderStyle: pdfSettings.item_border_style || 'light',

    // Content display
    showLogo: pdfSettings.show_logo !== false,
    showCompanyInfo: pdfSettings.show_company_info !== false,
    showPaymentTerms: pdfSettings.show_payment_terms !== false,
    showLineItemImages: pdfSettings.show_line_item_images === true,
    highlightTotals: pdfSettings.highlight_totals !== false,
    showItemPrices: pdfSettings.show_item_prices !== false, // <-- New Toggle
    showPhaseTotals: pdfSettings.show_phase_totals !== false, // <-- New Toggle

    // Footer
    footerText: pdfSettings.footer_text || '',
  };
};

export const getDefaultPDFStyles = () => ({
  primaryColor: '#0f172a',
  accentColor: '#f59e0b',
  headerBgColor: '#0f172a',
  headerTextColor: '#ffffff',
  footerColor: '#64748b',
  fontFamily: 'Arial',
  baseFontSize: 11,
  lineSpacing: 1.5,
  pageLayout: 'single-column',
  pageMargins: { top: 0.75, bottom: 0.75, left: 0.75, right: 0.75 },
  itemBorderStyle: 'light',
  showLogo: true,
  showCompanyInfo: true,
  showPaymentTerms: true,
  showLineItemImages: false,
  highlightTotals: true,
  showItemPrices: true,
  showPhaseTotals: true,
  footerText: '',
});

function getFontFamily(fontType) {
  const fontMap = {
    'sans-serif': 'Arial',
    'serif': 'Times',
    'monospace': 'Courier',
  };
  return fontMap[fontType] || 'Arial';
}

export const convertInchesToPt = (inches) => inches * 72;
export const convertPtToInches = (pt) => pt / 72;

/**
 * Get jsPDF page options from settings
 */
export const getPDFPageOptions = (settings) => {
  const styles = getPDFTemplateStyles(settings);
  const margins = styles.pageMargins;

  return {
    margin: {
      top: convertInchesToPt(margins.top),
      bottom: convertInchesToPt(margins.bottom),
      left: convertInchesToPt(margins.left),
      right: convertInchesToPt(margins.right),
    },
    lineHeight: styles.lineSpacing,
    fontSize: styles.baseFontSize,
    fontFamily: styles.fontFamily,
  };
};

/**
 * Get text styling based on type and settings
 */
export const getTextStyle = (type, settings) => {
  const styles = getPDFTemplateStyles(settings);

  const styleMap = {
    'heading': {
      fontStyle: 'bold',
      fontSize: styles.baseFontSize + 2,
      color: styles.primaryColor,
    },
    'subheading': {
      fontStyle: 'bold',
      fontSize: styles.baseFontSize + 1,
      color: styles.primaryColor,
    },
    'body': {
      fontSize: styles.baseFontSize,
      color: '#000000',
    },
    'accent': {
      fontStyle: 'bold',
      fontSize: styles.baseFontSize,
      color: styles.accentColor,
    },
    'footer': {
      fontSize: styles.baseFontSize - 1,
      color: styles.footerColor,
    },
    'header': {
      fontStyle: 'bold',
      fontSize: styles.baseFontSize + 1,
      color: styles.headerTextColor,
      bgColor: styles.headerBgColor,
    },
  };

  return styleMap[type] || styleMap['body'];
};

/**
 * Get border style for table cells
 */
export const getBorderStyle = (borderType) => {
  const styleMap = {
    'none': { lineWidth: 0 },
    'light': { lineWidth: 0.5, lineColor: '#e2e8f0' },
    'solid': { lineWidth: 1, lineColor: '#cbd5e1' },
  };

  return styleMap[borderType] || styleMap['light'];
};