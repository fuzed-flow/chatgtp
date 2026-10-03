import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@16.12.0';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const body = await req.json();
    const { quote_id, deposit_amount, client_email, client_name } = body;

    if (!quote_id || !deposit_amount) {
      return Response.json({ error: 'quote_id and deposit_amount are required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);

    const quotes = await base44.asServiceRole.entities.Quote.filter({ id: quote_id });
    if (!quotes || quotes.length === 0) {
      return Response.json({ error: 'Quote not found' }, { status: 404 });
    }
    const quote = quotes[0];

    const stripeInstance = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

    const session = await stripeInstance.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: `Deposit for Quote #${quote.quote_number}`,
              description: `Deposit for project: ${quote.title}`,
            },
            unit_amount: Math.round(deposit_amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${Deno.env.get('APP_DOMAIN')}/PublicQuoteView?id=${quote_id}&payment=success`,
      cancel_url: `${Deno.env.get('APP_DOMAIN')}/PublicQuoteView?id=${quote_id}`,
      customer_email: client_email,
      metadata: {
        quote_id: quote_id,
        base44_app_id: Deno.env.get('BASE44_APP_ID'),
        client_name: client_name || '',
      },
    });

    return Response.json({
      success: true,
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error.message || 'Failed to create checkout session' }, { status: 500 });
  }
});