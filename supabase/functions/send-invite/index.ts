import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from "https://esm.sh/openai@4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { query, currentPath } = await req.json()
    
    if (!query) {
      return new Response(JSON.stringify({ error: 'No query provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 👇 1. Convert the user's typo-filled query into an embedding vector
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    })
    const queryEmbedding = embeddingResponse.data[0].embedding

    // 👇 2. Search the database by MEANING instead of keywords
    const { data: faqs, error: searchError } = await supabase.rpc('match_help_faqs', {
      query_embedding: queryEmbedding,
      match_threshold: 0.3, // 0.3 is lenient to catch typos and odd phrasing
      match_count: 3
    })

    if (searchError) throw searchError

    const contextText = faqs && faqs.length > 0 
      ? faqs.map((faq: any) => `Q: ${faq.question}\nA: ${faq.answer_short}`).join('\n\n')
      : "No relevant help articles found in the database."

    const systemPrompt = `You are the FuzedFlow Helper, a friendly and expert support assistant for FuzedFlow (a construction and contractor management software). 
    
    CRITICAL CONTEXT: The user is currently viewing this page/URL in the app: "${currentPath || 'Unknown'}". Use this context to understand what they are trying to do.

    Answer the user's question using ONLY the provided database context below. If the database context does not contain the answer, politely tell them you don't have that specific information yet and recommend they reach out to support. Do not invent features that are not in the context.

    Context from FuzedFlow Database:
    ${contextText}`

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query }
      ],
      temperature: 0.2, 
    })

    const reply = completion.choices[0].message.content

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})