import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { formatCurrency } from '../utils/formatCurrency';

// --- HEX TO RGB CONVERTER ---
const hexToRgb = (hex) => {
  if (!hex) return [245, 158, 11]; 
  let c = hex.substring(1).split('');
  if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
  c = '0x' + c.join('');
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
};

// Compression Engine
const compressImage = async (blob, maxWidth = 800, quality = 0.6) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
};

const safelyAddImage = async (doc, url, format, x, y, w, h) => {
  if (!url) return false;
  try {
    const response = await fetch(url);
    if (!response.ok) return false;
    const blob = await response.blob();
    const compressedBase64 = await compressImage(blob, 800, 0.6);
    doc.addImage(compressedBase64, 'JPEG', x, y, w, h);
    return true;
  } catch (err) { return false; }
};

export async function generateQuotePDF(quote, client, phases, items, organization) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const bottomLimit = pageHeight - 25;
  let yPos = margin + 5;

  const settings = organization?.settings || {};
  const brandColorHex = settings?.pdf?.brand_color || '#f59e0b';
  const showItemPrices = settings?.pdf?.show_item_prices !== false;
  
  const companyAddress = settings?.address || '';
  const companyPhone = settings?.phone || '';
  const companyEmail = settings?.email || '';
  const companyWebsite = settings?.website || '';
  const taxId = settings?.tax_id || '';
  
  const finalClientMessage = quote?.client_message || settings?.quote_client_message || '';
  const finalTerms = quote?.terms || settings?.default_terms || '';

  const colors = {
    primary: [15, 23, 42],
    accent: hexToRgb(brandColorHex),
    text: [30, 30, 30],
    lightText: [100, 100, 100],
    border: [226, 232, 240],
    background: [255, 255, 255], 
  };

  const GST_RATE = (settings?.tax_rate || 5) / 100;
  const taxLabel = settings?.tax_label || 'Tax';
  const PST_RATE = settings?.enable_secondary_tax ? ((settings?.secondary_tax_rate || 7) / 100) : 0;
  const secondaryTaxLabel = settings?.secondary_tax_label || 'PST';

  const documentType = quote?.change_order_number ? "CHANGE ORDER" : quote?.invoice_number ? "INVOICE" : "QUOTE";
  const documentNumber = quote?.change_order_number || quote?.invoice_number || quote?.quote_number || 'N/A';
  const docNumLabel = quote?.change_order_number ? "CO #:" : quote?.invoice_number ? "Invoice #:" : "Quote #:";

  let clientSelections = null;
  if (quote?.client_selected_items_json) {
    try { clientSelections = JSON.parse(quote.client_selected_items_json); } catch (e) { }
  }

  const addLine = () => {
    doc.setDrawColor(...colors.border);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 4;
  };

  const checkPageBreak = (spaceNeeded = 20, isTableContext = false) => {
    if (yPos + spaceNeeded > bottomLimit) {
      doc.addPage();
      yPos = margin + 10;
      
      if (isTableContext) {
        doc.setFontSize(8);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(...colors.lightText);
        doc.text('DESCRIPTION', margin, yPos);
        if (showItemPrices) {
          doc.text('QTY', pageWidth - margin - 65, yPos, { align: 'right' });
          doc.text('PRICE', pageWidth - margin - 35, yPos, { align: 'right' });
        }
        doc.text('TOTAL', pageWidth - margin, yPos, { align: 'right' });
        
        yPos += 3;
        doc.setDrawColor(...colors.border);
        doc.setLineWidth(0.3);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 5;
      }
    }
  };

  // --- HEADER SECTION ---
  doc.setFontSize(24);
  doc.setTextColor(...colors.primary);
  doc.setFont(undefined, 'bold');
  doc.text(organization?.name || 'Fuzed Flow', margin, yPos + 10);
  
  let addrY = yPos + 18;
  doc.setFontSize(9);
  doc.setTextColor(...colors.lightText);
  doc.setFont(undefined, 'normal');

  if (companyAddress) { doc.text(companyAddress, margin, addrY); addrY += 5; }
  if (companyPhone) { doc.text(`Phone: ${companyPhone}`, margin, addrY); addrY += 5; }
  if (companyEmail) { doc.text(`Email: ${companyEmail}`, margin, addrY); addrY += 5; }
  if (companyWebsite) { doc.text(`Web: ${companyWebsite}`, margin, addrY); addrY += 5; }
  if (taxId) { doc.text(`Tax ID: ${taxId}`, margin, addrY); addrY += 5; }

  doc.setFontSize(10);
  doc.setTextColor(...colors.accent);
  doc.setFont(undefined, 'bold');
  doc.text(documentType, margin, addrY + 2); 

  const logoUrl = organization?.logo_url || organization?.company_logo_url;
  if (logoUrl) {
    await safelyAddImage(doc, logoUrl, 'PNG', pageWidth - margin - 50, yPos, 50, 50);
  }
  
  yPos = Math.max(yPos + 50, addrY + 10);

  // Billing & Date
  doc.setFontSize(9);
  doc.setTextColor(...colors.text);
  
  const leftColX = margin;
  const rightColX = pageWidth / 2 + 5;
  
  const billToStartY = yPos;
  doc.setFont(undefined, 'bold');
  doc.text('BILL TO', leftColX, yPos);
  yPos += 5;
  
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(client?.name || 'Client', leftColX, yPos);
  yPos += 4;
  
  doc.setFontSize(8);
  doc.setTextColor(...colors.lightText);
  if (client?.billing_address) {
    const addressLines = doc.splitTextToSize(client.billing_address, pageWidth / 2 - margin - 10);
    doc.text(addressLines, leftColX, yPos);
    yPos += addressLines.length * 4;
  }

  if (client?.site_address) {
    yPos += 2;
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...colors.text);
    doc.text('SITE ADDRESS', leftColX, yPos);
    yPos += 4;
    
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.lightText);
    const siteLines = doc.splitTextToSize(client.site_address, pageWidth / 2 - margin - 10);
    doc.text(siteLines, leftColX, yPos);
    yPos += siteLines.length * 4;
  }
  
  let detailY = billToStartY + 2;
  doc.setFontSize(8);
  doc.setTextColor(...colors.text);
  doc.text(`${docNumLabel} ${documentNumber}`, rightColX, detailY); 
  detailY += 5;
  doc.setTextColor(...colors.lightText);
  doc.text(`Date: ${quote?.issue_date ? format(new Date(quote.issue_date), 'MMM d, yyyy') : 'N/A'}`, rightColX, detailY);
  detailY += 5;
  
  if (quote?.expiry_date && !quote?.change_order_number) {
    doc.text(`Expires: ${format(new Date(quote.expiry_date), 'MMM d, yyyy')}`, rightColX, detailY);
  }
  
  yPos = Math.max(yPos, detailY + 5);
  addLine();
  yPos += 3;

  if (quote?.title) {
    checkPageBreak(15);
    doc.setFontSize(16);
    doc.setTextColor(...colors.primary);
    doc.setFont(undefined, 'bold');
    doc.text(quote.title, margin, yPos);
    yPos += 10;
  }

  if (quote?.show_overall_scope && quote?.overall_scope) {
    checkPageBreak(20);
    doc.setFontSize(8.5);
    doc.setTextColor(...colors.lightText);
    doc.setFont(undefined, 'normal');
    const scopeLines = doc.splitTextToSize(quote.overall_scope, pageWidth - margin * 2);
    doc.text(scopeLines, margin, yPos);
    yPos += scopeLines.length * 4 + 6;
  }

  addLine();
  yPos += 4;

  // Table Headers
  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.lightText);
  
  doc.text('DESCRIPTION', margin, yPos);
  if (showItemPrices) {
    doc.text('QTY', pageWidth - margin - 65, yPos, { align: 'right' });
    doc.text('PRICE', pageWidth - margin - 35, yPos, { align: 'right' });
  }
  doc.text('TOTAL', pageWidth - margin, yPos, { align: 'right' });
  
  yPos += 3;
  doc.setDrawColor(...colors.accent);
  doc.setLineWidth(0.5);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 5;

  const allPhases = Array.isArray(phases) ? phases : [];
  const allItems = Array.isArray(items) ? items : [];

  let pdfSubtotal = 0;
  let pdfTaxable = 0;

  const isItemIncluded = (item) => (!item.is_optional || !clientSelections || clientSelections[item.id] !== false);
  const isPhaseIncluded = (phase) => (!phase.is_optional || !clientSelections || clientSelections[phase.id] !== false);

  const imageCache = {};
  const imagePromises = [];

  for (const phase of allPhases) {
    if (!isPhaseIncluded(phase)) continue;
    const phaseItems = allItems.filter(i => i.phase_id === phase.id && isItemIncluded(i));
    for (const item of phaseItems) {
      if (item.photo_url && !imageCache[item.photo_url]) {
        const promise = fetch(item.photo_url)
          .then(res => res.blob())
          .then(blob => compressImage(blob, 800, 0.6))
          .then(base64 => { imageCache[item.photo_url] = base64; })
          .catch(() => { imageCache[item.photo_url] = null; }); 
        imagePromises.push(promise);
      }
    }
  }

  await Promise.all(imagePromises);

  for (const phase of allPhases) {
    if (!isPhaseIncluded(phase)) continue;
    const phaseItems = allItems.filter(i => i.phase_id === phase.id && isItemIncluded(i));
    if (phaseItems.length === 0) continue;

    checkPageBreak(20, true);

    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...colors.accent); 
    const phaseLabel = phase.is_optional ? `${phase.phase_name} (Optional)` : phase.phase_name || 'Phase';
    doc.text(phaseLabel, margin, yPos);
    yPos += 6;

    if (phase.scope_of_work && phase.show_scope_to_client !== false) {
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.lightText);
      const scopeLines = doc.splitTextToSize(phase.scope_of_work, pageWidth - margin * 2);
      
      for (let i = 0; i < scopeLines.length; i++) {
        if (yPos > bottomLimit) {
          doc.addPage();
          yPos = margin + 10;
          doc.setFontSize(8);
          doc.setFont(undefined, 'normal');
          doc.setTextColor(...colors.lightText);
        }
        doc.text(scopeLines[i], margin, yPos);
        yPos += 4;
      }
      yPos += 4;
    }

    for (const item of phaseItems) {
      const itemLabel = item.is_optional ? `${item.name} (Optional)` : item.name;
      const itemTotal = (item.quantity || 1) * (item.unit_price || 0);

      pdfSubtotal += itemTotal;
      if (item.taxable) pdfTaxable += itemTotal;

      const hasPhoto = !!item.photo_url;
      const photoSize = 12;
      const textStartX = hasPhoto ? margin + photoSize + 4 : margin;
      const maxDescWidth = pageWidth - margin - textStartX - 70; 

      doc.setFontSize(8.5);
      doc.setFont(undefined, 'normal');
      const descLines = item.description ? doc.splitTextToSize(item.description, maxDescWidth) : [];
      
      const initialSpaceNeeded = Math.max(10, hasPhoto ? photoSize + 2 : 0);
      checkPageBreak(initialSpaceNeeded, true);

      if (hasPhoto && imageCache[item.photo_url]) {
        doc.addImage(imageCache[item.photo_url], 'JPEG', margin, yPos - 3, photoSize, photoSize);
      }

      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.primary);
      doc.text(itemLabel, textStartX, yPos);

      if (showItemPrices) {
        doc.setFontSize(8.5);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...colors.text);
        doc.text(`${item.quantity || 1} ${item.unit || ''}`.trim(), pageWidth - margin - 65, yPos, { align: 'right' });
        doc.text(`$${formatCurrency(item.unit_price || 0)}`, pageWidth - margin - 35, yPos, { align: 'right' });
      }
      doc.setFont(undefined, 'bold');
      doc.text(`$${formatCurrency(itemTotal)}`, pageWidth - margin, yPos, { align: 'right' });

      let itemY = yPos + 4;
      
      if (descLines.length > 0) {
        doc.setFontSize(7.5);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...colors.lightText);
        
        for (let i = 0; i < descLines.length; i++) {
          if (itemY > bottomLimit) {
            doc.addPage();
            yPos = margin + 10;
            
            doc.setFontSize(8);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(...colors.lightText);
            doc.text('DESCRIPTION (Cont.)', margin, yPos);
            if (showItemPrices) {
              doc.text('QTY', pageWidth - margin - 65, yPos, { align: 'right' });
              doc.text('PRICE', pageWidth - margin - 35, yPos, { align: 'right' });
            }
            doc.text('TOTAL', pageWidth - margin, yPos, { align: 'right' });
            
            yPos += 3;
            doc.setDrawColor(...colors.border);
            doc.setLineWidth(0.3);
            doc.line(margin, yPos, pageWidth - margin, yPos);
            yPos += 5;
            itemY = yPos;
            
            doc.setFontSize(7.5);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(...colors.lightText);
          }
          
          doc.text(descLines[i], textStartX, itemY);
          itemY += 3.5;
        }
      }

      yPos = Math.max(yPos + (hasPhoto ? photoSize : 0), itemY + 2);
    }
    yPos += 4;
  }

  yPos += 2;
  doc.setLineWidth(0.3);
  doc.setDrawColor(...colors.border);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  checkPageBreak(50);
  
  const pdfGST = pdfTaxable * GST_RATE;
  const pdfPST = pdfTaxable * PST_RATE;
  const pdfSubtotalPlusTax = pdfSubtotal + pdfGST + pdfPST;
  
  const discountAmt = quote?.discount_type === "percentage"
    ? (pdfSubtotalPlusTax * (quote.discount_percentage || 0) / 100)
    : (quote?.discount_amount || 0);
  const pdfTotal = pdfSubtotalPlusTax - discountAmt;

  const totalsX = pageWidth - 65;
  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...colors.text);

  doc.text('Subtotal:', totalsX, yPos);
  doc.setFont(undefined, 'bold');
  doc.text(`$${formatCurrency(pdfSubtotal)}`, pageWidth - margin, yPos, { align: 'right' });
  yPos += 6;

  doc.setFont(undefined, 'normal');
  doc.text(`${taxLabel} (${(GST_RATE * 100).toFixed(1)}%):`, totalsX, yPos);
  doc.text(`$${formatCurrency(pdfGST)}`, pageWidth - margin, yPos, { align: 'right' });
  yPos += 6;

  if (settings?.enable_secondary_tax) {
    doc.text(`${secondaryTaxLabel} (${(PST_RATE * 100).toFixed(1)}%):`, totalsX, yPos);
    doc.text(`$${formatCurrency(pdfPST)}`, pageWidth - margin, yPos, { align: 'right' });
    yPos += 6;
  }

  if (discountAmt > 0) {
    doc.setFont(undefined, 'normal');
    doc.setTextColor(34, 139, 34);
    const discLabel = quote?.discount_type === "percentage" ? `Discount (${quote.discount_percentage}%):` : 'Discount:';
    doc.text(discLabel, totalsX, yPos);
    doc.setFont(undefined, 'bold');
    doc.text(`-$${formatCurrency(discountAmt)}`, pageWidth - margin, yPos, { align: 'right' });
    yPos += 6;
  }

  doc.setFillColor(...colors.accent);
  doc.rect(totalsX - 5, yPos - 3, 60, 8, 'F');
  
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.primary); 
  doc.text('TOTAL:', totalsX, yPos + 2);
  doc.setTextColor(255, 255, 255); 
  doc.text(`$${formatCurrency(pdfTotal)}`, pageWidth - margin - 2, yPos + 2, { align: 'right' });
  
  yPos += 12;

  if (quote?.deposit_amount > 0) {
    checkPageBreak(15);
    yPos += 2;
    doc.setFontSize(8.5);
    doc.setTextColor(...colors.accent);
    doc.setFont(undefined, 'bold');
    doc.text(`Deposit Required: $${formatCurrency(quote.deposit_amount)}`, margin, yPos);
    yPos += 8;
  }

  if (quote?.has_payment_schedule) {
    const activeScheduleItems = Array.isArray(quote.scheduleItems) ? quote.scheduleItems : [];
    if (activeScheduleItems.length > 0) {
      checkPageBreak(20 + activeScheduleItems.length * 10);
      yPos += 4;
      doc.setFontSize(10);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.primary);
      doc.text('Payment Schedule', margin, yPos);
      yPos += 7;
      
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.lightText);
      doc.text('This project will be invoiced according to the following schedule:', margin, yPos);
      yPos += 6;

      for (const item of activeScheduleItems) {
        checkPageBreak(12);
        const displayAmount = item.amount_type === "percentage" 
          ? (pdfTotal * (item.percentage || 0) / 100)
          : (item.amount || 0);
        
        doc.setFillColor(239, 246, 255);
        doc.rect(margin, yPos - 3, pageWidth - margin * 2, 8, 'F');
        
        doc.setFontSize(8.5);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(...colors.text);
        doc.text(item.payment_name || 'Payment', margin + 2, yPos);
        
        doc.setTextColor(...colors.accent);
        const amountText = item.amount_type === "percentage" 
          ? `$${formatCurrency(displayAmount)} (${item.percentage}%)`
          : `$${formatCurrency(displayAmount)}`;
        doc.text(amountText, pageWidth - margin - 2, yPos, { align: 'right' });
        
        if (item.due_event) {
          yPos += 4;
          doc.setFontSize(7.5);
          doc.setFont(undefined, 'normal');
          doc.setTextColor(...colors.lightText);
          doc.text(`Due: ${item.due_event.replace(/_/g, ' ')}`, margin + 2, yPos);
        }
        yPos += 7;
      }
      yPos += 2;
    }
  }

  if (finalClientMessage || finalTerms) {
    checkPageBreak(35);
    yPos += 4;
    addLine();
    yPos += 4;

    if (finalClientMessage) {
      checkPageBreak(25);
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.primary);
      doc.text('Message from the Team', margin, yPos);
      yPos += 6;
      
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.text);
      const msgLines = doc.splitTextToSize(finalClientMessage, pageWidth - margin * 2);
      doc.text(msgLines, margin, yPos);
      yPos += msgLines.length * 4 + 6;
    }

    if (finalTerms) {
      checkPageBreak(25);
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.primary);
      doc.text('Terms & Conditions', margin, yPos);
      yPos += 6;
      
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.text);
      const termLines = doc.splitTextToSize(finalTerms, pageWidth - margin * 2);
      doc.text(termLines, margin, yPos);
    }
  }

  // --- FINAL FOOTER PASS ---
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.lightText);
    
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    
    const footerText = `${organization?.name || 'Fuzed Flow'} • ${documentType} ${documentNumber}`;
    doc.text(footerText, margin, pageHeight - 7);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  if (quote?.returnBase64) {
    return doc.output('datauristring').split(',')[1];
  } else {
    doc.save(`${documentType.replace(' ', '_').toLowerCase()}-${documentNumber}.pdf`);
  }
}

// INVOICES 
export async function generateInvoicePDF({ 
  invoice, client, project, quotePhases, quoteItems, 
  manualItems, scheduleItems, payments, organization 
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const bottomLimit = pageHeight - 20;
  let yPos = margin;

  const settings = organization?.settings || {};
  const brandColorHex = settings?.pdf?.brand_color || '#f59e0b';
  const showItemPrices = settings?.pdf?.show_item_prices !== false;

  const companyAddress = settings?.address || '';
  const companyPhone = settings?.phone || '';
  const companyEmail = settings?.email || '';
  const companyWebsite = settings?.website || '';
  const taxId = settings?.tax_id || '';

  const colors = {
    primary: [15, 23, 42],      
    accent: hexToRgb(brandColorHex),    
    text: [30, 30, 30],
    lightText: [100, 100, 100],
    border: [226, 232, 240],    
    background: [255, 255, 255], 
    success: [16, 185, 129],    
    danger: [220, 38, 38]       
  };

  const addLine = () => {
    doc.setDrawColor(...colors.border);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 4;
  };

  const checkPageBreak = (spaceNeeded = 30) => {
    if (yPos + spaceNeeded > bottomLimit) {
      doc.addPage();
      yPos = margin + 10;
    }
  };

  doc.setFillColor(...colors.background);
  doc.rect(0, 0, pageWidth, 40, 'F');
  
  const logoUrl = organization?.logo_url || organization?.company_logo_url;
  if (logoUrl) {
    await safelyAddImage(doc, logoUrl, 'PNG', margin, 5, 30, 30);
  } else {
    doc.setFontSize(28);
    doc.setTextColor(...colors.primary);
    doc.setFont(undefined, 'bold');
    doc.text(organization?.name || 'Fuzed Flow', margin, 26);
  }

  let headY = 38;
  doc.setFontSize(8);
  doc.setTextColor(...colors.lightText);
  doc.setFont(undefined, 'normal');

  if (companyAddress) { doc.text(companyAddress, margin, headY); headY += 4; }
  if (companyPhone) { doc.text(`Phone: ${companyPhone}`, margin, headY); headY += 4; }
  if (companyEmail) { doc.text(`Email: ${companyEmail}`, margin, headY); headY += 4; }
  if (companyWebsite) { doc.text(`Web: ${companyWebsite}`, margin, headY); headY += 4; }
  if (taxId) { doc.text(`Tax ID: ${taxId}`, margin, headY); headY += 4; }
  
  doc.setFontSize(10);
  doc.setTextColor(...colors.accent);
  doc.text('INVOICE DETAILS', pageWidth - margin, 18, { align: 'right' });
  
  doc.setFontSize(18);
  doc.setTextColor(...colors.primary);
  doc.text(invoice?.invoice_number || 'INV-0000', pageWidth - margin, 26, { align: 'right' });

  yPos = Math.max(50, headY + 8);

  const leftColX = margin;
  const rightColX = pageWidth / 2 + 10;
  
  const billToStartY = yPos;
  doc.setFontSize(9);
  doc.setTextColor(...colors.text);
  doc.setFont(undefined, 'bold');
  doc.text('BILLED TO', leftColX, yPos);
  yPos += 6;
  
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(client?.name || 'Client', leftColX, yPos);
  yPos += 5;
  
  doc.setFontSize(8);
  doc.setTextColor(...colors.lightText);
  if (invoice?.billing_address) {
    const lines = doc.splitTextToSize(invoice.billing_address, (pageWidth/2) - margin - 10);
    doc.text(lines, leftColX, yPos);
    yPos += lines.length * 4;
  }

  if (invoice?.site_address || project?.name) {
    yPos += 2;
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...colors.text);
    doc.text('PROJECT / SITE', leftColX, yPos);
    yPos += 4;
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.lightText);
    
    if (project?.name) {
        doc.text(project.name, leftColX, yPos);
        yPos += 4;
    }
    if (invoice?.site_address) {
        const lines = doc.splitTextToSize(invoice.site_address, (pageWidth/2) - margin - 10);
        doc.text(lines, leftColX, yPos);
        yPos += lines.length * 4;
    }
  }

  let detailY = billToStartY + 2;
  doc.setFontSize(8);
  doc.setTextColor(...colors.text);
  doc.text(`Issued: ${invoice?.issue_date ? format(new Date(invoice.issue_date), 'MMM d, yyyy') : 'N/A'}`, rightColX, detailY);
  detailY += 5;
  doc.setTextColor(...colors.lightText);
  doc.text(`Due Date: ${invoice?.due_date ? format(new Date(invoice.due_date), 'MMM d, yyyy') : 'N/A'}`, rightColX, detailY);
  
  yPos = Math.max(yPos, detailY + 5);
  addLine();
  yPos += 4;

  if (quotePhases?.length > 0) {
    checkPageBreak(30);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...colors.primary);
    doc.text('Scope of Work Included', margin, yPos);
    yPos += 6;

    for (const phase of quotePhases) {
      checkPageBreak(20);
      doc.setFillColor(248, 250, 252); 
      doc.rect(margin, yPos, pageWidth - margin * 2, 7, 'F');
      
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.primary);
      doc.text(phase.phase_name, margin + 2, yPos + 5);
      yPos += 10;

      const items = quoteItems.filter(i => i.phase_id === phase.id);
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.text);
      
      for (const item of items) {
        checkPageBreak(10);
        doc.text(`${item.name} (${item.quantity} ${item.unit || ''})`.trim(), margin + 4, yPos);
        doc.text(`$${formatCurrency((item.quantity || 1) * (item.unit_price || 0))}`, pageWidth - margin - 2, yPos, { align: 'right' });
        yPos += 6;
      }
      yPos += 2;
    }
  }

  if (manualItems?.length > 0) {
    checkPageBreak(25);
    doc.setFillColor(254, 252, 232);
    doc.rect(margin, yPos, pageWidth - margin * 2, 7, 'F');
    
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(146, 64, 14); 
    doc.text('Additional Charges', margin + 2, yPos + 5);
    yPos += 10;

    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.text);
    
    for (const item of manualItems) {
      checkPageBreak(10);
      doc.text(item.name, margin + 4, yPos);
      doc.text(`$${formatCurrency(item.amount || 0)}`, pageWidth - margin - 2, yPos, { align: 'right' });
      yPos += 6;
    }
    yPos += 4;
  }

  addLine();
  yPos += 4;

  checkPageBreak(40);
  const totalsX = pageWidth - 70;
  
  const discountValue = invoice?.discount_type === 'percentage' 
    ? ((invoice.subtotal / (1 - (invoice.discount_amount / 100))) * (invoice.discount_amount / 100))
    : (invoice?.discount_amount || 0);
  const rawSubtotal = (invoice?.subtotal || 0) + discountValue;

  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...colors.text);
  doc.text('Contract Sum:', totalsX, yPos);
  doc.text(`$${formatCurrency(rawSubtotal)}`, pageWidth - margin - 2, yPos, { align: 'right' });
  yPos += 6;

  if (discountValue > 0) {
    doc.setTextColor(...colors.danger);
    doc.text('Discount:', totalsX, yPos);
    doc.text(`-$${formatCurrency(discountValue)}`, pageWidth - margin - 2, yPos, { align: 'right' });
    yPos += 6;
    doc.setTextColor(...colors.text);
  }

  const invoiceTaxLabel = settings?.enable_secondary_tax 
    ? `${settings?.tax_label || 'GST'} & ${settings?.secondary_tax_label || 'PST'}`
    : `${settings?.tax_label || 'Tax'}`;

  doc.text(`${invoiceTaxLabel}:`, totalsX, yPos);
  doc.text(`$${formatCurrency(invoice?.tax || 0)}`, pageWidth - margin - 2, yPos, { align: 'right' });
  yPos += 6;

  doc.setFont(undefined, 'bold');
  doc.text('Total Contract:', totalsX, yPos);
  doc.text(`$${formatCurrency(invoice?.total || 0)}`, pageWidth - margin - 2, yPos, { align: 'right' });
  yPos += 6;

  doc.setTextColor(...colors.success);
  doc.text('Total Received:', totalsX, yPos);
  doc.text(`-$${formatCurrency(invoice?.amount_paid || 0)}`, pageWidth - margin - 2, yPos, { align: 'right' });
  
  yPos += 12; 

  doc.setFillColor(...colors.primary);
  doc.rect(totalsX - 10, yPos - 6, 70, 12, 'F'); 
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text('BALANCE DUE:', totalsX - 5, yPos + 2);
  doc.setTextColor(...colors.accent);
  doc.text(`$${formatCurrency(invoice?.balance_due || 0)}`, pageWidth - margin - 2, yPos + 2, { align: 'right' });
  
  yPos += 15;

  if (scheduleItems?.length > 0) {
    checkPageBreak(30);
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...colors.primary);
    doc.text('Payment Milestones', margin, yPos);
    yPos += 8;

    for (const item of scheduleItems) {
      checkPageBreak(12);
      const isPaid = item.status === 'Paid';
      
      doc.setFillColor(isPaid ? 236 : 248, isPaid ? 253 : 250, isPaid ? 245 : 252);
      doc.rect(margin, yPos - 4, pageWidth - margin * 2, 9, 'F');
      
      doc.setFontSize(8);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.text);
      doc.text(item.payment_name, margin + 2, yPos);
      
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.lightText);
      doc.text(item.due_event || '', margin + 50, yPos);
      
      doc.setFont(undefined, 'bold');
      doc.setTextColor(isPaid ? colors.success[0] : colors.text[0], isPaid ? colors.success[1] : colors.text[1], isPaid ? colors.success[2] : colors.text[2]);
      doc.text(`$${formatCurrency(item.amount || 0)}`, pageWidth - margin - 15, yPos, { align: 'right' });
      
      doc.setFontSize(7);
      doc.text(item.status.toUpperCase(), pageWidth - margin - 2, yPos, { align: 'right' });
      yPos += 10;
    }
  }

  const finalNotes = invoice?.notes || settings?.default_terms || '';

  if (invoice?.show_notes !== false && finalNotes) {
    checkPageBreak(30);
    yPos += 6;
    addLine();
    yPos += 4;
    
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...colors.primary);
    doc.text('Notes & Terms', margin, yPos);
    yPos += 6;

    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.lightText);
    const noteLines = doc.splitTextToSize(finalNotes, pageWidth - margin * 2);
    doc.text(noteLines, margin, yPos);
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.lightText);
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    const footerText = `${organization?.name || 'Fuzed Flow'} • INVOICE ${invoice?.invoice_number || ''}`;
    doc.text(footerText, margin, pageHeight - 7);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  doc.save(`Invoice-${invoice?.invoice_number || 'Record'}.pdf`);
}

// PURCHASE ORDERS 
export async function generatePOPDF(po, vendor, items, organization) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const bottomLimit = pageHeight - 20;
  let yPos = margin;

  const settings = organization?.settings || {};
  const brandColorHex = settings?.pdf?.brand_color || '#f59e0b';
  
  const companyAddress = settings?.address || '';
  const companyPhone = settings?.phone || '';
  const companyEmail = settings?.email || '';
  const companyWebsite = settings?.website || '';
  const taxId = settings?.tax_id || '';

  const colors = {
    primary: [15, 23, 42],       
    accent: hexToRgb(brandColorHex),       
    text: [30, 30, 30],
    lightText: [100, 100, 100],
    border: [226, 232, 240],     
    background: [255, 255, 255],
  };

  const addLine = () => {
    doc.setDrawColor(...colors.border);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 4;
  };

  const checkPageBreak = (spaceNeeded = 30) => {
    if (yPos + spaceNeeded > bottomLimit) {
      doc.addPage();
      yPos = margin + 10;
    }
  };

  doc.setFillColor(...colors.background);
  doc.rect(0, 0, pageWidth, 40, 'F');
  
  const logoUrl = organization?.logo_url || organization?.company_logo_url;
  if (logoUrl) {
    await safelyAddImage(doc, logoUrl, 'PNG', margin, 5, 30, 30);
  } else {
    doc.setFontSize(24);
    doc.setTextColor(...colors.primary);
    doc.setFont(undefined, 'bold');
    doc.text(organization?.name || 'Fuzed Flow', margin, 26);
  }

  let headY = 38;
  doc.setFontSize(8);
  doc.setTextColor(...colors.lightText);
  doc.setFont(undefined, 'normal');

  if (companyAddress) { doc.text(companyAddress, margin, headY); headY += 4; }
  if (companyPhone) { doc.text(`Phone: ${companyPhone}`, margin, headY); headY += 4; }
  if (companyEmail) { doc.text(`Email: ${companyEmail}`, margin, headY); headY += 4; }
  if (companyWebsite) { doc.text(`Web: ${companyWebsite}`, margin, headY); headY += 4; }
  if (taxId) { doc.text(`Tax ID: ${taxId}`, margin, headY); headY += 4; }
  
  doc.setFontSize(10);
  doc.setTextColor(...colors.accent);
  doc.text('PURCHASE ORDER', pageWidth - margin, 18, { align: 'right' });
  
  doc.setFontSize(18);
  doc.setTextColor(...colors.primary);
  doc.text(po?.po_number || 'PO-0000', pageWidth - margin, 26, { align: 'right' });

  yPos = Math.max(50, headY + 8);

  const leftColX = margin;
  const rightColX = pageWidth / 2 + 10;
  
  doc.setFontSize(9);
  doc.setTextColor(...colors.text);
  doc.setFont(undefined, 'bold');
  doc.text('VENDOR', leftColX, yPos);
  doc.text('SHIP TO / INSTRUCTIONS', rightColX, yPos);
  yPos += 6;
  
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(vendor?.company_name || vendor?.name || 'Vendor', leftColX, yPos);
  
  doc.setFontSize(8);
  doc.setTextColor(...colors.lightText);
  if (vendor?.email) doc.text(vendor.email, leftColX, yPos + 4);
  if (vendor?.phone) doc.text(vendor.phone, leftColX, yPos + 8);
  
  if (po?.shipping_address) {
    const lines = doc.splitTextToSize(po.shipping_address, (pageWidth/2) - margin - 10);
    doc.text(lines, rightColX, yPos);
  } else {
    doc.text("See standard delivery instructions.", rightColX, yPos);
  }

  yPos += 20;
  
  doc.setFontSize(9);
  doc.setTextColor(...colors.text);
  doc.text(`Order Date: ${po?.order_date ? format(new Date(po.order_date), 'MMM d, yyyy') : 'N/A'}`, leftColX, yPos);
  doc.text(`Expected Delivery: ${po?.expected_delivery_date ? format(new Date(po.expected_delivery_date), 'MMM d, yyyy') : 'TBD'}`, rightColX, yPos);
  
  yPos += 8;
  addLine();
  yPos += 4;

  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.lightText);
  
  doc.text('ITEM DESCRIPTION', margin, yPos);
  doc.text('QTY', pageWidth - margin - 65, yPos, { align: 'right' });
  doc.text('UNIT COST', pageWidth - margin - 35, yPos, { align: 'right' });
  doc.text('TOTAL', pageWidth - margin, yPos, { align: 'right' });
  
  yPos += 3;
  doc.setDrawColor(...colors.accent);
  doc.setLineWidth(0.5);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 5;

  const poItems = Array.isArray(items) ? items : [];

  for (const item of poItems) {
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'normal');
    
    const maxDescWidth = pageWidth - margin * 2 - 70;
    const descLines = item.description ? doc.splitTextToSize(item.description, maxDescWidth) : [];
    const lineHeight = 8 + (descLines.length * 3.5);

    checkPageBreak(lineHeight + 4);

    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...colors.primary);
    doc.text(item.item_name, margin, yPos);

    doc.setFontSize(8.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.text);
    doc.text(`${item.quantity || 1} ${item.unit || 'ea'}`, pageWidth - margin - 65, yPos, { align: 'right' });
    doc.text(`$${formatCurrency(item.unit_cost || 0)}`, pageWidth - margin - 35, yPos, { align: 'right' });
    doc.setFont(undefined, 'bold');
    doc.text(`$${formatCurrency((item.quantity || 1) * (item.unit_cost || 0))}`, pageWidth - margin, yPos, { align: 'right' });

    let itemY = yPos + 4;
    if (descLines.length > 0) {
      doc.setFontSize(7.5);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.lightText);
      doc.text(descLines, margin, itemY);
      itemY += descLines.length * 3.5;
    }

    yPos = Math.max(yPos + lineHeight, itemY + 2);
  }

  yPos += 2;
  doc.setLineWidth(0.3);
  doc.setDrawColor(...colors.border);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  checkPageBreak(40);
  const totalsX = pageWidth - 65;

  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...colors.text);

  doc.text('Subtotal:', totalsX, yPos);
  doc.setFont(undefined, 'bold');
  doc.text(`$${formatCurrency(po?.subtotal || 0)}`, pageWidth - margin - 2, yPos, { align: 'right' });
  yPos += 6;

  doc.setFont(undefined, 'normal');
  doc.text('Estimated Tax:', totalsX, yPos);
  doc.text(`$${formatCurrency(po?.tax || 0)}`, pageWidth - margin - 2, yPos, { align: 'right' });
  yPos += 6;

  doc.setFillColor(...colors.accent);
  doc.rect(totalsX - 5, yPos - 3, 60, 8, 'F');
  
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.primary);
  doc.text('PO TOTAL:', totalsX, yPos + 2);
  doc.setTextColor(255, 255, 255);
  doc.text(`$${formatCurrency(po?.total || 0)}`, pageWidth - margin - 2, yPos + 2, { align: 'right' });
  
  yPos += 15;

  if (po?.notes || po?.terms) {
    checkPageBreak(35);
    yPos += 4;
    addLine();
    yPos += 4;

    if (po?.notes) {
      checkPageBreak(25);
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.primary);
      doc.text('Delivery Notes & Instructions', margin, yPos);
      yPos += 6;
      
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.lightText);
      const noteLines = doc.splitTextToSize(po.notes, pageWidth - margin * 2);
      doc.text(noteLines, margin, yPos);
      yPos += noteLines.length * 4 + 6;
    }

    if (po?.terms) {
      checkPageBreak(25);
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...colors.primary);
      doc.text('Purchasing Terms', margin, yPos);
      yPos += 6;
      
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...colors.lightText);
      const termLines = doc.splitTextToSize(po.terms, pageWidth - margin * 2);
      doc.text(termLines, margin, yPos);
    }
  }

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.lightText);
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    const footerText = `${organization?.name || 'Fuzed Flow'} • PURCHASE ORDER ${po?.po_number || ''}`;
    doc.text(footerText, margin, pageHeight - 7);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  if (po?.returnBase64) {
    return doc.output('datauristring').split(',')[1];
  } else {
    doc.save(`${po?.po_number || 'Purchase_Order'}.pdf`);
  }
}

// PAYMENT RECEIPTS
export async function generateReceiptPDF(client, selectedPayments, invoices, organization, options = {}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  let yPos = margin;

  const settings = organization?.settings || {};
  const brandColorHex = settings?.pdf?.brand_color || '#10b981'; 

  const colors = {
    primary: [15, 23, 42],       
    accent: hexToRgb(brandColorHex),       
    text: [30, 30, 30],
    lightText: [100, 100, 100],
    border: [226, 232, 240],     
    background: [255, 255, 255],
  };

  doc.setFillColor(...colors.background);
  doc.rect(0, 0, pageWidth, 40, 'F');
  
  const logoUrl = organization?.logo_url || organization?.company_logo_url;
  if (logoUrl) {
    await safelyAddImage(doc, logoUrl, 'PNG', margin, 5, 30, 30);
  } else {
    doc.setFontSize(24);
    doc.setTextColor(...colors.primary);
    doc.setFont(undefined, 'bold');
    doc.text(organization?.name || 'Your Company', margin, 26);
  }

  doc.setFontSize(10);
  doc.setTextColor(...colors.accent);
  doc.text('PAYMENT RECEIPT', pageWidth - margin, 18, { align: 'right' });
  
  doc.setFontSize(14);
  doc.setTextColor(...colors.primary);
  doc.text(format(new Date(), "MMM d, yyyy"), pageWidth - margin, 26, { align: 'right' });

  yPos = 50;

  doc.setFontSize(9);
  doc.setTextColor(...colors.text);
  doc.setFont(undefined, 'bold');
  doc.text('RECEIVED FROM', margin, yPos);
  yPos += 6;
  
  doc.setFont(undefined, 'normal');
  doc.setFontSize(10);
  doc.text(client?.name || 'Client', margin, yPos);
  
  doc.setFontSize(8);
  doc.setTextColor(...colors.lightText);
  if (client?.email) doc.text(client.email, margin, yPos + 4);

  yPos += 15;
  doc.setDrawColor(...colors.border);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 6;

  doc.setFontSize(8);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.lightText);
  
  doc.text('DATE', margin, yPos);
  doc.text('INVOICE #', margin + 40, yPos);
  doc.text('METHOD', margin + 80, yPos);
  doc.text('AMOUNT', pageWidth - margin, yPos, { align: 'right' });
  
  yPos += 3;
  doc.setDrawColor(...colors.accent);
  doc.setLineWidth(0.5);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 6;

  doc.setFontSize(9);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(...colors.text);

  let totalAmount = 0;

  for (const p of selectedPayments) {
    const inv = invoices.find(i => i.id === p.invoice_id);
    const dateStr = p.payment_date ? format(new Date(p.payment_date + "T00:00:00"), "MMM d, yyyy") : format(new Date(p.created_at), "MMM d, yyyy");
    const amount = Number(p.amount || 0);
    totalAmount += amount;

    doc.text(dateStr, margin, yPos);
    doc.text(inv?.invoice_number || 'Unknown', margin + 40, yPos);
    doc.text(p.payment_method || 'Payment', margin + 80, yPos);
    doc.text(`$${formatCurrency(amount)}`, pageWidth - margin, yPos, { align: 'right' });

    yPos += 8;
  }

  yPos += 2;
  doc.setLineWidth(0.3);
  doc.setDrawColor(...colors.border);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 8;

  doc.setFillColor(...colors.accent);
  doc.rect(pageWidth - margin - 65, yPos - 3, 65, 8, 'F');
  
  doc.setFontSize(11);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...colors.primary);
  doc.text('TOTAL RECEIVED:', pageWidth - margin - 60, yPos + 2);
  doc.setTextColor(255, 255, 255);
  doc.text(`$${formatCurrency(totalAmount)}`, pageWidth - margin - 2, yPos + 2, { align: 'right' });

  yPos += 25;
  doc.setFontSize(10);
  doc.setTextColor(...colors.primary);
  doc.text('Thank you for your business!', margin, yPos);

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...colors.lightText);
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.2);
    doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);
    const footerText = `${organization?.name || 'Your Company'} • PAYMENT RECEIPT`;
    doc.text(footerText, margin, pageHeight - 7);
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
  }

  if (options.returnBase64) {
    return doc.output('datauristring').split(',')[1];
  } else {
    doc.save(`Receipt_${format(new Date(), 'MMM_dd_yyyy')}.pdf`);
  }
}