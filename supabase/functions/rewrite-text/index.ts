import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const fieldGuidance: Record<string, string> = {
  project_summary: 'Rewrite as a concise project progress summary in one or two short paragraphs.',
  completed_work: 'Rewrite each existing completed item clearly. Return one item per line with no bullets, numbering, heading, or added items.',
  upcoming_work: 'Rewrite each existing upcoming item clearly without turning estimates into commitments. Return one item per line with no bullets, numbering, heading, or added items.',
  client_notes: 'Rewrite as concise, helpful client-facing notes. Preserve any requests, access needs, decisions, and scheduling qualifications.',
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Use POST.' }, 405)

  try {
    const authorization = req.headers.get('Authorization') || ''
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return respond({ error: 'Sign in to use AI Rewrite.' }, 401)

    const supabase = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return respond({ error: 'Sign in to use AI Rewrite.' }, 401)
    const { data: profile, error: profileError } = await supabase.from('profiles').select('company_id,is_active').eq('id', user.id).maybeSingle()
    if (profileError || !profile?.company_id || profile.is_active === false) {
      return respond({ error: 'Your account cannot use AI Rewrite right now.' }, 403)
    }

    let body: any
    try { body = await req.json() } catch { return respond({ error: 'Invalid request.' }, 400) }
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const field = typeof body.field === 'string' ? body.field : ''
    if (!text || text.length > 10000) return respond({ error: 'Enter between 1 and 10,000 characters to rewrite.' }, 400)
    if (!fieldGuidance[field]) return respond({ error: 'This field does not support AI Rewrite.' }, 400)
    if (!Deno.env.get('OPENAI_API_KEY')) throw new Error('AI provider is not configured')

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
    const completion = await openai.chat.completions.create({
      model: 'gpt-5.6-terra',
      max_completion_tokens: 1800,
      messages: [
        { role: 'system', content: `You rewrite construction project updates for clients. Improve clarity, grammar, tone, and readability while keeping the language professional and natural. Preserve every fact, name, date, amount, measurement, status, qualification, and line-level meaning. Never invent completed work, upcoming work, dates, commitments, approvals, problems, or recommendations. Do not add a greeting, sign-off, commentary, markdown, or quotation marks. ${fieldGuidance[field]} Return only the rewritten text.` },
        { role: 'user', content: text },
      ],
    })
    const rewritten = completion.choices[0]?.message.content?.trim() || ''
    if (!rewritten || rewritten.length > 10000) throw new Error('AI provider returned an invalid response')
    return respond({ text: rewritten })
  } catch (error) {
    console.error('AI Rewrite request failed:', error instanceof Error ? error.message : 'Unknown error')
    return respond({ error: 'AI Rewrite is unavailable right now. Please try again.' }, 500)
  }
})
