import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const { po_id } = await req.json();

    if (!po_id) {
      return Response.json({ error: 'Missing po_id' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);

    // Fetch PO data using service role (no auth required)
    const pos = await base44.asServiceRole.entities.PurchaseOrder.filter({ id: po_id });
    const po = pos[0];

    if (!po) {
      return Response.json({ error: 'Purchase Order not found' }, { status: 404 });
    }

    // Fetch related data
    const items = await base44.asServiceRole.entities.PurchaseOrderItem.filter({ purchase_order_id: po_id });
    
    let vendor = null;
    if (po.vendor_id) {
      const vendors = await base44.asServiceRole.entities.Vendor.filter({ id: po.vendor_id });
      vendor = vendors[0];
    }

    const orgs = await base44.asServiceRole.entities.Organization.list();
    const org = orgs[0];

    return Response.json({
      po,
      items,
      vendor,
      org
    });

  } catch (error) {
    console.error('Error fetching public PO:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});