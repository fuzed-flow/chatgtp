import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CLIENT_ID = Deno.env.get('ABh0yHpeOSWecCiJMXsDMQs8LZmWdO2k0kF0nK6jeB2FnyRpfZ')!;
const CLIENT_SECRET = Deno.env.get('YALc1MIhcqo4NfwxcZeBPycwuwLmGpyfYYZNkI4E')!;
// You will update this URL once you register your app in Intuit
const REDIRECT_URI = "https://your-api.com/functions/v1/qbo-callback";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId"); 

  if (!code || !realmId) {
    return new Response("Missing parameters from Intuit", { status: 400 });
  }

  // In production, you would validate the "state" parameter here to securely fetch the company_id.
  // We will use a placeholder here until your frontend state management is wired up.
  const companyId = "00000000-0000-0000-0000-000000000000"; 

  const credentials = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  
  try {
    const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      return new Response(JSON.stringify(tokenData), { status: 400 });
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Connect securely to your database using the built-in Supabase service keys
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!, 
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    // Save the tokens to your qbo_tokens table
    const { error } = await supabase
      .from('qbo_tokens')
      .upsert({
        company_id: companyId,
        qbo_realm_id: realmId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
      }, { onConflict: 'company_id' });

    if (error) throw error;

    // Redirect the user back to your SaaS dashboard on success
    return Response.redirect(`https://your-saas-app.com/settings?qbo=connected`, 302);
    
  } catch (err: any) {
    return new Response(`Sync Error: ${err.message}`, { status: 500 });
  }
});