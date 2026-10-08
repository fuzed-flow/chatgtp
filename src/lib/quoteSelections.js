function savedSelections(quote) {
  const raw = quote?.client_selected_items_json ?? quote?.client_selected_items;
  if (!raw) return {};

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function initialQuoteSelections(quote, phases = [], items = []) {
  const saved = savedSelections(quote);
  const result = {};

  for (const phase of phases) {
    if (!phase?.is_optional || !phase.id) continue;
    result[phase.id] = typeof saved[phase.id] === "boolean"
      ? saved[phase.id]
      : phase.default_selected === true;
  }

  for (const item of items) {
    if (!item?.is_optional || !item.id) continue;
    result[item.id] = typeof saved[item.id] === "boolean"
      ? saved[item.id]
      : item.default_selected === true;
  }

  return result;
}
