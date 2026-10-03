import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from "https://esm.sh/openai@4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { query, currentPath } = await req.json()
    if (!query) return new Response(JSON.stringify({ error: 'No query provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Embed the user's query
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    })

    // 2. Use the new Hybrid Search (combines meaning + keywords)
    const { data: chunks, error: searchError } = await supabase.rpc('hybrid_search_knowledge_chunks', {
      query_embedding: embeddingResponse.data[0].embedding,
      query_text: query,
      match_threshold: 0.3,
      match_count: 3
    })

    if (searchError) throw searchError

    // 3. Format the new Knowledge Chunks into context
    const contextText = chunks && chunks.length > 0 
      ? chunks.map((chunk: any) => `Topic: ${chunk.title}\nDetails: ${chunk.content}`).join('\n\n')
      : "No relevant help articles found in the database."

    // 4. Updated System Prompt with the Soft Fallback
    const systemPrompt = `You are the FuzedFlow Helper, a friendly and expert support assistant for FuzedFlow (a construction and contractor management software). 
    
    CRITICAL CONTEXT: The user is currently viewing this page/URL in the app: "${currentPath || 'Unknown'}". Use this context to understand what they are trying to do.
    
    Answer the user's question using ONLY the provided database context below. If the specific FuzedFlow steps are not in the context, tell the user you don't have the exact app instructions yet, but provide general construction industry best practices to help them.

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

    return new Response(JSON.stringify({ reply: completion.choices[0].message.content }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})