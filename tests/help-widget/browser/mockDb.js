export const supabase = { functions: { invoke: async () => {
  await new Promise(resolve => setTimeout(resolve, 250));
  return { data: { reply: 'Sample reply: open Leads from the navigation, then select Add New Lead. Your conversation stays here while you use the helper.' }, error: null };
} } };
