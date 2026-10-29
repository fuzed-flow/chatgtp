export const template = {
  id: 'template-one', company_id: 'company-one', is_template: true, title: 'Master Template',
  overall_scope: 'Saved introduction', client_message: 'Saved client message', terms: 'Saved terms', notes: 'Saved internal notes',
  hero_image_url: 'https://fixtures.invalid/hero.webp', end_photos: ['https://fixtures.invalid/end.webp'],
  documents: [{ file_name: 'Saved attachment.pdf', file_url: 'https://fixtures.invalid/attachment.pdf' }],
  show_overall_scope: false, deposit_amount: 77, discount_amount: 12, discount_type: 'percentage', discount_percentage: 5,
  show_discount_amount: true, has_payment_schedule: true, margin: 15, margin_adjustment_type: 'percentage',
  pdf_customization_settings_json: JSON.stringify({ primary_color: '#123456', show_line_item_images: true, page_margins: { top: 1.25 } }),
  client_id: 'old-template-client', status: 'Approved', issue_date: '2020-01-01', internal_review_status: 'Approved',
};

export const supabase = {
  from(table) {
    const query = { table, columns: '', filters: [], single: false };
    const chain = {
      select(columns) { query.columns = columns; return chain; },
      eq(key, value) { query.filters.push([key, value]); return chain; },
      order() { return chain; },
      single() { query.single = true; return chain; },
      insert() { throw new Error('A template load must never write to the database'); },
      update() { throw new Error('A template load must never write to the database'); },
      delete() { throw new Error('A template load must never write to the database'); },
      async then(resolve, reject) {
        try {
          const test = window.templateTest;
          test.queries.push(query);
          if (table === 'quotes' && query.single) await test.detailGate;
          if (test.failTable === table) return resolve({ data: null, error: { message: 'Synthetic read failure' } });
          const rows = {
            companies: { id: 'company-one', name: 'Example Company' },
            quotes: query.single ? { ...template, ...test.templateOverrides } : [template],
            quote_phases: [{ id: 'saved-phase', phase_name: 'Saved bathroom', sort_order: 0 }],
            quote_line_items: [{ id: 'saved-line', phase_id: 'saved-phase', name: 'Saved faucet', quantity: 1, unit_cost: 60, unit_price: 100, material_cost: 40, labor_cost: 20, photo_url: 'https://fixtures.invalid/faucet.webp' }],
            quote_payment_schedules: [{ id: 'saved-payment', payment_name: 'Saved deposit', amount_type: 'percentage', percentage: 30 }],
          };
          return resolve({ data: rows[table] || [], error: null });
        } catch (error) { return reject(error); }
      },
    };
    return chain;
  },
};
