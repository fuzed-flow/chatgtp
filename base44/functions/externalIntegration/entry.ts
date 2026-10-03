import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

// QuickBooks Integration Handler
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { action, data } = await req.json();

    if (action === 'sync_invoice') {
      // Sync invoice to QuickBooks
      const invoice = data;
      
      // QuickBooks API would sync here using stored API credentials
      // This is a placeholder for the actual integration
      const quickbooksPayload = {
        DocNumber: invoice.invoice_number,
        TotalAmt: invoice.total,
        CustomerRef: { value: invoice.client_id },
        Line: invoice.line_items.map((item) => ({
          DetailType: 'SalesItemLineDetail',
          Description: item.description,
          Amount: item.line_total,
          SalesItemLineDetail: {
            ItemRef: { value: item.product_id },
            Qty: item.quantity,
            UnitPrice: item.unit_price,
          },
        })),
      };

      console.log('Would sync to QuickBooks:', quickbooksPayload);
      return Response.json({ 
        success: true, 
        message: 'Invoice queued for QuickBooks sync',
        payload: quickbooksPayload
      });
    }

    if (action === 'sync_customer') {
      // Sync client to QuickBooks
      const client = data;
      
      const quickbooksCustomer = {
        DisplayName: client.name,
        PrimaryPhone: { FreeFormNumber: client.phone },
        PrimaryEmailAddr: { Address: client.email },
        BillingAddr: {
          Line1: client.billing_address,
          City: client.city,
        },
      };

      console.log('Would sync to QuickBooks:', quickbooksCustomer);
      return Response.json({ 
        success: true, 
        message: 'Customer queued for QuickBooks sync',
        payload: quickbooksCustomer
      });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('Integration error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});