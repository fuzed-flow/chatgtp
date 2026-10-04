export const supabase = { functions: { invoke: async () => {
  await new Promise(resolve => setTimeout(resolve, 250));
  return { data: { reply: '## Add a new lead\n\nSample answer for preview:\n\n1. Open **Leads** from the navigation.\n2. Select **Add New Lead**.\n3. Enter the contact details and select **Create Lead**.\n\n**Tip:** Add a follow-up date so your team knows the next step.\n\n- Use clear contact details.\n- Include a short description of the enquiry.' }, error: null };
} } };
