import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

const fieldGuidance: Record<string, string> = {
  project_summary: 'Rewrite as a concise project progress summary in one or two short paragraphs.',
  completed_work: 'Rewrite each existing completed item clearly. Return one item per line with no bullets, numbering, heading, or added items.',
  upcoming_work: 'Rewrite each existing upcoming item clearly without turning estimates into commitments. Return one item per line with no bullets, numbering, heading, or added items.',
  client_notes: 'Rewrite as concise, helpful client-facing notes. Preserve any requests, access needs, decisions, and scheduling qualifications.',
  general_business_text: 'Rewrite as clear, concise, professional business writing. Preserve paragraph breaks and list formatting when they carry meaning.',
}

serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return respond({ error: 'Use POST.' }, 405)

  let admin: ReturnType<typeof createClient> | null = null
  let usageId = ''
  let companyId = ''
  let userId = ''
  const startedAt = Date.now()
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
    userId = user.id
    const { data: profile, error: profileError } = await supabase.from('profiles').select('company_id,is_active').eq('id', user.id).maybeSingle()
    if (profileError || !profile?.company_id || profile.is_active === false) {
      return respond({ error: 'Your account cannot use AI Rewrite right now.' }, 403)
    }
    companyId = profile.company_id

    let body: any
    try { body = await req.json() } catch { return respond({ error: 'Invalid request.' }, 400) }
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const field = typeof body.field === 'string' ? body.field : ''
    const requestId = typeof body.request_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id)
      ? body.request_id
      : crypto.randomUUID()
    if (!text || text.length > 10000) return respond({ error: 'Enter between 1 and 10,000 characters to rewrite.' }, 400)
    if (!fieldGuidance[field]) return respond({ error: 'This field does not support AI Rewrite.' }, 400)

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (!serviceKey) throw new Error('AI guardrail service is not configured')
    admin = createClient(Deno.env.get('SUPABASE_URL') || '', serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: claim, error: claimError } = await admin.rpc('claim_ai_rewrite', {
      p_company_id: companyId,
      p_user_id: user.id,
      p_request_id: requestId,
      p_input_chars: text.length,
      p_field_category: field,
    })
    if (claimError) throw new Error(`AI guardrail failed: ${claimError.message}`)
    if (!claim?.allowed) {
      const status = ['USER_HOURLY_LIMIT', 'COMPANY_HOURLY_LIMIT', 'COMPANY_DAILY_LIMIT'].includes(claim?.code)
        ? 429
        : claim?.code === 'INPUT_TOO_LONG' ? 400 : claim?.code === 'DUPLICATE_REQUEST' ? 409 : 403
      const response = respond({
        error: claim?.message || 'AI Rewrite is unavailable right now.',
        code: claim?.code || 'AI_REWRITE_DENIED',
        retry_after_seconds: claim?.retry_after_seconds || undefined,
      }, status)
      if (status === 429 && claim?.retry_after_seconds) response.headers.set('Retry-After', String(claim.retry_after_seconds))
      return response
    }
    usageId = claim.usage_id
    if (!Deno.env.get('OPENAI_API_KEY')) throw new Error('AI provider is not configured')

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
    const completion = await openai.chat.completions.create({
      model: 'gpt-5.6-terra',
      max_completion_tokens: 1800,
      messages: [
        { role: 'system', content: `You rewrite business communications and construction operations text. Improve clarity, grammar, tone, and readability while keeping the language professional and natural. Match the source's intended audience, confidentiality, voice, and purpose. Preserve every fact, name, date, amount, measurement, status, qualification, and line-level meaning. Never invent completed work, upcoming work, dates, commitments, approvals, problems, or recommendations. Do not add a greeting, sign-off, commentary, markdown, or quotation marks unless one already exists in the source. ${fieldGuidance[field]} Return only the rewritten text.` },
        { role: 'user', content: text },
      ],
    })
    const rewritten = completion.choices[0]?.message.content?.trim() || ''
    if (!rewritten || rewritten.length > 10000) throw new Error('AI provider returned an invalid response')
    const { error: completionError } = await admin.rpc('complete_ai_rewrite_usage', {
      p_usage_id: usageId,
      p_company_id: companyId,
      p_user_id: userId,
      p_status: 'succeeded',
      p_output_chars: rewritten.length,
      p_duration_ms: Date.now() - startedAt,
      p_error_code: null,
    })
    if (completionError) console.error('AI Rewrite usage completion failed:', completionError.message)
    return respond({ text: rewritten })
  } catch (error) {
    console.error('AI Rewrite request failed:', error instanceof Error ? error.message : 'Unknown error')
    if (admin && usageId && companyId && userId) {
      try {
        await admin.rpc('complete_ai_rewrite_usage', {
          p_usage_id: usageId,
          p_company_id: companyId,
          p_user_id: userId,
          p_status: 'failed',
          p_output_chars: null,
          p_duration_ms: Date.now() - startedAt,
          p_error_code: 'PROVIDER_ERROR',
        })
      } catch { /* The original provider error remains the client-facing result. */ }
    }
    return respond({ error: 'AI Rewrite is unavailable right now. Please try again.' }, 500)
  }
})
