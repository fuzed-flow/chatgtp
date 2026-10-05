-- The production schema already provides the same partial lead follow-up index
-- under sales_lead_followups. Keep that established index and remove only the
-- redundant index added by the Sales Performance foundation migration.
drop index if exists public.sales_leads_followup_health;
