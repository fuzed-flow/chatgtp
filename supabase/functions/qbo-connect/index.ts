import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const CLIENT_ID = Deno.env.get('ABh0yHpeOSWecCiJMXsDMQs8LZmWdO2k0kF0nK6jeB2FnyRpfZ')!;
// Replace this URI with your actual Supabase project URL once deployed
const REDIRECT_URI = "https://ochqexofahdssmarnict.supabase.co/functions/v1/qbo-callback"; 

serve(async (req) => {
  const { company_id } = await req.json();

  if (!company_id) {
    return new Response(JSON.stringify({ error: "Missing company_id" }), { status: 400 });
  }

  // Generate a cryptographically secure random state variable
  const state = crypto.randomUUID();

  const authUrl = `https://appcenter.intuit.com/connect/oauth2` +
    `?client_id=${CLIENT_ID}` +
    `&response_type=code` +
    `&scope=com.intuit.quickbooks.accounting` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&state=${state}`;

  return new Response(JSON.stringify({ url: authUrl }), {
    headers: { "Content-Type": "application/json" },
  });
});
