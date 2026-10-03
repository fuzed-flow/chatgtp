import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@4.0.0';
import { format } from 'npm:date-fns@3.6.0';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { po_id, vendor_email, custom_message } = body;

    if (!po_id || !vendor_email) {
      return Response.json({ error: 'po_id and vendor_email are required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    // Fetch the purchase order
    const pos = await base44.asServiceRole.entities.PurchaseOrder.filter({ id: po_id });
    if (!pos || pos.length === 0) {
      return Response.json({ error: 'Purchase order not found' }, { status: 404 });
    }
    const po = pos[0];

    // Fetch vendor
    const vendors = await base44.asServiceRole.entities.Vendor.filter({ id: po.vendor_id });
    const vendor = vendors[0];

    // Fetch organization for company info
    const orgs = await base44.asServiceRole.entities.Organization.list();
    const org = orgs[0];

    // Fetch items
    const items = await base44.asServiceRole.entities.PurchaseOrderItem.filter({ purchase_order_id: po_id });

    // Get organization name for email
    const companyName = org?.name || 'Pro-Trades';

    // Compose email subject
    const subject = `Purchase Order ${po.po_number} from ${companyName}`;

    // Compose email body as HTML
    let htmlBody = '';
    
    if (vendor?.name) {
      htmlBody += `<p>Hi ${vendor.name},</p>`;
    } else {
      htmlBody += `<p>Hello,</p>`;
    }

    htmlBody += `<p>Please find attached purchase order for your review.</p>`;

    if (custom_message) {
      htmlBody += `<p>${custom_message}</p>`;
    }

    // Add PO summary
    htmlBody += `<hr><h3>PURCHASE ORDER SUMMARY</h3>`;
    htmlBody += `<p>`;
    htmlBody += `<strong>PO #:</strong> ${po.po_number}<br>`;
    if (po.purpose) {
      htmlBody += `<strong>Purpose:</strong> ${po.purpose}<br>`;
    }
    htmlBody += `<strong>Subtotal:</strong> $${(po.subtotal || 0).toFixed(2)}<br>`;
    htmlBody += `<strong>Tax:</strong> $${(po.tax || 0).toFixed(2)}<br>`;
    htmlBody += `<strong>Total:</strong> $${(po.total || 0).toFixed(2)}<br>`;
    
    if (po.expected_delivery_date) {
      htmlBody += `<strong>Expected Delivery:</strong> ${po.expected_delivery_date}<br>`;
    }

    htmlBody += `</p>`;

    htmlBody += `<p>The complete purchase order is attached as a PDF to this email.</p>`;

    htmlBody += `<p>If you have any questions, please don't hesitate to contact us.</p>`;
    htmlBody += `<p>Thank you!</p>`;

    htmlBody += `<hr><p>`;
    if (org?.name) {
      htmlBody += `${org.name}`;
    }
    if (org?.city) {
      htmlBody += ` - ${org.city}`;
    }
    htmlBody += `</p>`;

    // Generate PDF inline (same logic as generatePOPDF)
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header section
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(org?.name || 'Pro-Trades', 20, y);
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(71, 85, 105);
    if (org?.city) {
      doc.text(org.city, 20, y + 6);
    }

    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(217, 119, 6);
    doc.text('PURCHASE ORDER', pageWidth - 20, y + 5, { align: 'right' });
    
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(71, 85, 105);
    const poLine = `PO #: ${po.po_number || 'Draft'}`;
    doc.text(poLine, pageWidth - 20, y + 15, { align: 'right' });
    
    const dateStr = po.order_date ? format(new Date(po.order_date), 'MMM d, yyyy') : '—';
    const dateLine = `Date: ${dateStr}`;
    doc.text(dateLine, pageWidth - 20, y + 21, { align: 'right' });
    doc.setTextColor(0);

    y += 28;
    doc.setLineWidth(1);
    doc.setDrawColor(226, 232, 240);
    doc.line(20, y, pageWidth - 20, y);
    y += 10;

    // Purpose box
    if (po.purpose) {
      doc.setFillColor(254, 243, 199);
      doc.setDrawColor(217, 119, 6);
      doc.setLineWidth(0.5);
      doc.rect(20, y, pageWidth - 40, 15, 'FD');
      
      doc.setFontSize(7);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(120, 53, 15);
      doc.text('PURPOSE', 22, y + 4);
      
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0);
      const purposeLines = doc.splitTextToSize(po.purpose, pageWidth - 48);
      doc.text(purposeLines, 22, y + 9);
      
      y += 20;
    }

    // Vendor & Shipping
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(100);
    doc.text('VENDOR', 20, y);
    
    y += 5;
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0);
    if (vendor) {
      doc.text(vendor.company_name || vendor.name || 'Unknown Vendor', 20, y);
      y += 5;
      doc.setFont(undefined, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100);
      if (vendor.email) {
        doc.text(vendor.email, 20, y);
        y += 4;
      }
      if (vendor.phone) {
        doc.text(vendor.phone, 20, y);
        y += 4;
      }
    }
    doc.setTextColor(0);

    let shippingY = y - (vendor?.email ? 18 : vendor?.phone ? 14 : 10);
    if (po.shipping_address) {
      doc.setFontSize(7);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(100);
      doc.text('SHIP TO', 110, shippingY);
      shippingY += 5;
      
      doc.setFontSize(8);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0);
      const lines = doc.splitTextToSize(po.shipping_address, 70);
      doc.text(lines, 110, shippingY);
    }

    y = Math.max(y, shippingY + (po.shipping_address ? doc.splitTextToSize(po.shipping_address, 70).length * 4 : 0));
    y += 8;

    // Expected delivery
    if (po.expected_delivery_date) {
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Expected Delivery: `, 20, y);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0);
      doc.text(po.expected_delivery_date, 55, y);
      doc.setFont(undefined, 'normal');
      y += 8;
    }

    // Items section
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0);
    doc.text('ITEMS', 20, y);
    y += 2;
    
    doc.setLineWidth(1);
    doc.setDrawColor(217, 119, 6);
    doc.line(20, y, pageWidth - 20, y);
    y += 8;

    // Table headers
    doc.setFontSize(7);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(100);
    doc.text('ITEM', 20, y);
    doc.text('QTY', 130, y, { align: 'right' });
    doc.text('UNIT COST', 155, y, { align: 'right' });
    doc.text('TOTAL', pageWidth - 20, y, { align: 'right' });
    y += 2;
    
    doc.setLineWidth(0.3);
    doc.setDrawColor(226, 232, 240);
    doc.line(20, y, pageWidth - 20, y);
    y += 6;

    // Items
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0);
    
    if (items.length === 0) {
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text('No items added', pageWidth / 2, y + 15, { align: 'center' });
      y += 25;
    } else {
      for (const item of items) {
        if (y > 265) {
          doc.addPage();
          y = 20;
        }

        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        const nameLines = doc.splitTextToSize(item.product_name, 100);
        doc.text(nameLines, 20, y);
        
        doc.setFont(undefined, 'normal');
        doc.text(item.quantity.toString(), 130, y, { align: 'right' });
        doc.text(`$${item.unit_cost.toFixed(2)}`, 155, y, { align: 'right' });
        doc.setFont(undefined, 'bold');
        doc.text(`$${item.line_total.toFixed(2)}`, pageWidth - 20, y, { align: 'right' });
        doc.setFont(undefined, 'normal');
        
        y += nameLines.length * 5;
        
        if (item.description) {
          doc.setFontSize(7);
          doc.setTextColor(100);
          const descLines = doc.splitTextToSize(item.description, 100);
          doc.text(descLines, 20, y);
          doc.setTextColor(0);
          y += descLines.length * 4;
        }
        
        doc.setLineWidth(0.1);
        doc.setDrawColor(241, 245, 249);
        doc.line(20, y + 2, pageWidth - 20, y + 2);
        y += 6;
      }
    }

    // Totals
    if (items.length > 0) {
      y += 5;
      const subtotal = items.reduce((sum, item) => sum + (item.line_total || 0), 0);
      const tax = subtotal * 0.05;
      const total = subtotal + tax;
      
      const totalsX = pageWidth - 20;
      const labelX = pageWidth - 65;
      
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(100);
      doc.text('Subtotal:', labelX, y);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0);
      doc.text(`$${subtotal.toFixed(2)}`, totalsX, y, { align: 'right' });
      y += 6;

      doc.setFont(undefined, 'normal');
      doc.setTextColor(100);
      doc.text('Tax (5%):', labelX, y);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0);
      doc.text(`$${tax.toFixed(2)}`, totalsX, y, { align: 'right' });
      y += 2;
      
      doc.setLineWidth(0.5);
      doc.setDrawColor(203, 213, 225);
      doc.line(labelX, y, totalsX, y);
      y += 6;

      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(0);
      doc.text('Total:', labelX, y);
      doc.setTextColor(217, 119, 6);
      doc.text(`$${total.toFixed(2)}`, totalsX, y, { align: 'right' });
      doc.setTextColor(0);
    }

    // Terms & Notes
    if (po.terms || po.notes) {
      y += 18;
      if (y > 245) {
        doc.addPage();
        y = 20;
      }
      
      doc.setLineWidth(0.3);
      doc.setDrawColor(226, 232, 240);
      doc.line(20, y, pageWidth - 20, y);
      y += 8;
      
      if (po.terms) {
        doc.setFont(undefined, 'bold');
        doc.setFontSize(9);
        doc.text('Terms & Conditions', 20, y);
        y += 6;
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        const termsLines = doc.splitTextToSize(po.terms, pageWidth - 40);
        doc.text(termsLines, 20, y);
        doc.setTextColor(0);
        y += termsLines.length * 4.5 + 8;
      }
      
      if (po.notes) {
        doc.setFont(undefined, 'bold');
        doc.setFontSize(9);
        doc.text('Notes', 20, y);
        y += 6;
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85);
        const notesLines = doc.splitTextToSize(po.notes, pageWidth - 40);
        doc.text(notesLines, 20, y);
        doc.setTextColor(0);
      }
    }

    const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
    const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));

    // Get Gmail access token
    const accessToken = await base44.asServiceRole.connectors.getAccessToken('gmail');

    // Create multipart MIME email with PDF attachment
    const boundary = '----=_Part_' + Date.now();
    const emailMessage = [
      `To: ${vendor_email}`,
      `Subject: ${subject}`,
      `From: ${user?.email || 'noreply@example.com'}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      ``,
      htmlBody,
      ``,
      `--${boundary}`,
      `Content-Type: application/pdf; name="PO-${po.po_number}.pdf"`,
      `Content-Disposition: attachment; filename="PO-${po.po_number}.pdf"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      pdfBase64,
      ``,
      `--${boundary}--`
    ].join('\r\n');

    // Base64 encode for Gmail API
    const encoder = new TextEncoder();
    const messageBytes = encoder.encode(emailMessage);
    const base64Message = btoa(String.fromCharCode(...messageBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    // Send email via Gmail API with BCC
    const result = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: base64Message,
        threadId: null,
        labelIds: []
      })
    });
    
    // Send BCC copy to user
    await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: btoa(String.fromCharCode(...encoder.encode([
          `To: ${user?.email || 'noreply@example.com'}`,
          `Subject: PO Sent: ${subject}`,
          `From: ${user?.email || 'noreply@example.com'}`,
          `MIME-Version: 1.0`,
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          ``,
          `--${boundary}`,
          `Content-Type: text/html; charset=UTF-8`,
          ``,
          `<p>You sent the following purchase order to ${vendor?.company_name || vendor?.name}:</p><hr>${htmlBody}`,
          ``,
          `--${boundary}`,
          `Content-Type: application/pdf; name="PO-${po.po_number}.pdf"`,
          `Content-Disposition: attachment; filename="PO-${po.po_number}.pdf"`,
          `Content-Transfer-Encoding: base64`,
          ``,
          pdfBase64,
          ``,
          `--${boundary}--`
        ].join('\r\n'))))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '')
      })
    }).catch(err => console.error('BCC send failed:', err));

    if (!result.ok) {
      const errorData = await result.json();
      console.error('Gmail API error:', errorData);
      throw new Error(`Failed to send email: ${errorData.error?.message || result.statusText}`);
    }

    const gmailResponse = await result.json();

    // Update PO status to Sent
    await base44.asServiceRole.entities.PurchaseOrder.update(po_id, { status: 'Sent' });

    return Response.json({
      success: true,
      sent_at: new Date().toISOString(),
      po_id: po_id,
      message_id: gmailResponse.id
    });

  } catch (error) {
    console.error('Error sending PO email:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});