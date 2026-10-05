const image = (label, background, foreground = "ffffff") => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600" viewBox="0 0 1200 600"><rect width="1200" height="600" fill="#${background}"/><path d="M0 470L310 230l180 140 190-190 520 420H0z" fill="#${foreground}" opacity=".18"/><text x="600" y="315" text-anchor="middle" font-family="Arial,sans-serif" font-size="72" font-weight="700" fill="#${foreground}">${label}</text></svg>`)}`;

const bundle = {
  quote: {
    id: "quote-fixture",
    company_id: "company-fixture",
    client_id: "client-fixture",
    quote_number: "Q-1048",
    title: "Main Floor Renovation",
    status: "Sent",
    overall_scope: "Complete the main-floor renovation with coordinated demolition, framing, finishes, and final cleanup.",
    client_message: "Thank you for inviting us to prepare this proposal. We have organized the work into clear phases so the scope is easy to review.",
    terms: "Pricing is valid until the expiry date shown. Changes outside the listed scope require written approval.",
    deposit_amount: 2500,
    deposit_paid_amount: 0,
    discount_amount: 250,
    discount_type: "fixed",
    discount_percentage: 0,
    show_discount_amount: true,
    has_payment_schedule: true,
    hero_image_url: image("MAIN FLOOR RENOVATION", "172033"),
    end_photos: [image("PAST PROJECT", "334155")],
    documents: [{ file_name: "Project specification.pdf", file_url: "data:application/pdf;base64,JVBERi0xLjQ=" }],
    site_address: "140 Cedar Avenue, Calgary, AB",
    show_overall_scope: true,
    issue_date: "2026-10-05",
    expiry_date: "2026-10-20",
  },
  client: { id: "client-fixture", name: "Morgan Lee", billing_address: "88 Willow Street, Calgary, AB", site_address: "140 Cedar Avenue, Calgary, AB" },
  company: {
    id: "company-fixture",
    name: "North Ridge Construction",
    logo_url: image("NORTH RIDGE", "ffffff", "172033"),
    settings: {
      address: "200 Builders Way, Calgary, AB",
      phone: "403-555-0184",
      email: "projects@northridge.example",
      website: "northridge.example",
      tax_label: "GST",
      tax_rate: 5,
      enable_secondary_tax: false,
      currency: "CAD",
      pdf: { brand_color: "#f59e0b" },
    },
  },
  phases: [
    { id: "phase-1", phase_name: "Preparation & Framing", scope_of_work: "Protect adjacent finishes, complete selective demolition, and prepare the new wall layout.", sort_order: 1, is_optional: false, default_selected: true, photos: [] },
    { id: "phase-2", phase_name: "Optional Built-in Storage", scope_of_work: "Custom painted storage wall with adjustable shelving.", sort_order: 2, is_optional: true, default_selected: false, photos: [] },
  ],
  items: [
    { id: "item-1", phase_id: "phase-1", name: "Site protection and demolition", description: "Floor protection, dust control, selective removal, hauling, and disposal.", quantity: 1, unit: "allowance", unit_price: 4800, taxable: true, is_optional: false, default_selected: true, display_order: 1, photo_url: image("SITE WORK", "475569") },
    { id: "item-2", phase_id: "phase-1", name: "Framing package", description: "Labour and materials for the approved wall layout.", quantity: 1, unit: "package", unit_price: 7350, taxable: true, is_optional: false, default_selected: true, display_order: 2 },
    { id: "item-3", phase_id: "phase-2", name: "Custom storage wall", description: "Shop-built cabinets, installation, and painted finish.", quantity: 1, unit: "package", unit_price: 6200, taxable: true, is_optional: false, default_selected: true, display_order: 3, photo_url: image("BUILT-IN", "92400e") },
  ],
  schedule_items: [
    { id: "schedule-1", payment_name: "Project deposit", due_event: "upon_approval", amount_type: "percentage", percentage: 20, sort_order: 1 },
    { id: "schedule-2", payment_name: "Substantial completion", due_event: "substantial_completion", amount_type: "percentage", percentage: 80, sort_order: 2 },
  ],
  approval: { id: "approval-fixture", status: "Sent" },
  is_expired: false,
};

export const supabase = {
  rpc: async (name) => {
    if (name === "get_public_quote_bundle") return { data: bundle, error: null };
    if (name === "track_public_quote_view") return { data: true, error: null };
    if (name === "respond_to_public_quote") return { data: { status: "Approved" }, error: null };
    return { data: null, error: new Error(`Unexpected RPC: ${name}`) };
  },
  functions: { invoke: async () => ({ data: null, error: new Error("Not available in preview fixture") }) },
};
