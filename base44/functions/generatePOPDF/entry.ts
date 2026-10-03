import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { jsPDF } from 'npm:jspdf@4.0.0';
import { format } from 'npm:date-fns@3.6.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { po_id } = await req.json();

    if (!po_id) {
      return Response.json({ error: 'Missing po_id' }, { status: 400 });
    }

    // Fetch PO data
    const pos = await base44.entities.PurchaseOrder.filter({ id: po_id });
    const po = pos[0];

    if (!po) {
      return Response.json({ error: 'Purchase Order not found' }, { status: 404 });
    }

    // Fetch related data
    const items = await base44.entities.PurchaseOrderItem.filter({ purchase_order_id: po_id });
    const vendors = await base44.entities.Vendor.filter({ id: po.vendor_id });
    const vendor = vendors[0];
    const orgs = await base44.entities.Organization.list();
    const org = orgs[0];

    // Create PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header section
    y = 20;

    // Company name
    doc.setFontSize(18); // text-3xl
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(org?.name || 'Pro-Trades', 20, y);
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(71, 85, 105); // slate-600
    if (org?.city) {
      doc.text(org.city, 20, y + 6);
    }

    // Right side: PO title and details (text-right)
    doc.setFontSize(14); // text-2xl
    doc.setFont(undefined, 'bold');
    doc.setTextColor(217, 119, 6); // amber-600
    doc.text('PURCHASE ORDER', pageWidth - 20, y + 5, { align: 'right' });
    
    // PO # line (text-sm)
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(71, 85, 105); // slate-600
    const poLine = `PO #: ${po.po_number || 'Draft'}`;
    doc.text(poLine, pageWidth - 20, y + 15, { align: 'right' });
    
    // Date line (text-sm)
    const dateStr = po.order_date ? format(new Date(po.order_date), 'MMM d, yyyy') : '—';
    const dateLine = `Date: ${dateStr}`;
    doc.text(dateLine, pageWidth - 20, y + 21, { align: 'right' });
    doc.setTextColor(0);

    y += 28;
    doc.setLineWidth(1);
    doc.setDrawColor(226, 232, 240); // slate-200 (border-b-2)
    doc.line(20, y, pageWidth - 20, y);
    y += 10;

    // Purpose box (if exists)
    if (po.purpose) {
      doc.setFillColor(254, 243, 199); // amber-50
      doc.setDrawColor(217, 119, 6); // amber-600
      doc.setLineWidth(0.5);
      doc.rect(20, y, pageWidth - 40, 15, 'FD');
      
      doc.setFontSize(7);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(120, 53, 15); // amber-900
      doc.text('PURPOSE', 22, y + 4);
      
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(0);
      const purposeLines = doc.splitTextToSize(po.purpose, pageWidth - 48);
      doc.text(purposeLines, 22, y + 9);
      
      y += 20;
    }

    // Vendor & Shipping (two columns)
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

    // Vendor quote attachment (if exists)
    if (po.vendor_quote_attachment) {
      doc.setFillColor(219, 234, 254); // blue-50
      doc.setDrawColor(37, 99, 235); // blue-600
      doc.setLineWidth(0.5);
      doc.rect(20, y, pageWidth - 40, 10, 'FD');
      
      doc.setFontSize(8);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(30, 58, 138); // blue-900
      doc.text('Vendor Quote Attached', 22, y + 6);
      doc.setTextColor(0);
      
      y += 15;
    }

    // Items section header
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0);
    doc.text('ITEMS', 20, y);
    y += 2;
    
    doc.setLineWidth(1);
    doc.setDrawColor(217, 119, 6); // amber-600
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
    doc.setDrawColor(226, 232, 240); // slate-200
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
        doc.setDrawColor(241, 245, 249); // slate-100
        doc.line(20, y + 2, pageWidth - 20, y + 2);
        y += 6;
      }
    }

    // Totals section
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
      doc.setDrawColor(203, 213, 225); // slate-300
      doc.line(labelX, y, totalsX, y);
      y += 6;

      doc.setFont(undefined, 'bold');
      doc.setFontSize(11);
      doc.setTextColor(0);
      doc.text('Total:', labelX, y);
      doc.setTextColor(217, 119, 6); // amber-600
      doc.text(`$${total.toFixed(2)}`, totalsX, y, { align: 'right' });
      doc.setTextColor(0);
      y += 10;
    }

    // Terms & Notes section
    if (po.terms || po.notes) {
      y += 8;
      if (y > 245) {
        doc.addPage();
        y = 20;
      }
      
      doc.setLineWidth(0.3);
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.line(20, y, pageWidth - 20, y);
      y += 8;
      
      if (po.terms) {
        doc.setFont(undefined, 'bold');
        doc.setFontSize(9);
        doc.text('Terms & Conditions', 20, y);
        y += 6;
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(51, 65, 85); // slate-700
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
        doc.setTextColor(51, 65, 85); // slate-700
        const notesLines = doc.splitTextToSize(po.notes, pageWidth - 40);
        doc.text(notesLines, 20, y);
        doc.setTextColor(0);
      }
    }

    const pdfBytes = doc.output('arraybuffer');

    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=PO-${po.po_number || 'draft'}.pdf`
      }
    });
  } catch (error) {
    console.error('Error generating PO PDF:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});