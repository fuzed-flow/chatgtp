import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { calculateSalesPerformance } from "@/lib/salesPerformance";

const LEAD_FIELDS = "id,company_id,contact_name,source,value_estimate,pipeline_stage,created_at,priority,next_follow_up_date,next_meeting_date,next_meeting_time,assigned_to,assigned_to_user_id,stage_changed_at,first_contact_at,qualified_at,appointment_at,quote_sent_at,won_at,lost_at,lost_reason,probability,expected_close_date,service_type,campaign,branch,client_id";
const QUOTE_FIELDS = "id,company_id,lead_id,client_id,user_id,quote_number,title,status,total,is_template,created_at,issue_date,sent_at,signed_at,viewed_at,updated_at,next_follow_up_date,decline_reason";
const PAYMENT_FIELDS = "id,company_id,invoice_id,quote_id,amount,payment_method,payment_date,created_at";
const ACTIVITY_FIELDS = "id,company_id,lead_id,client_id,quote_id,user_id,activity_type,title,description,metadata,occurred_at";

async function checked(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data || [];
}

export function useSalesPerformance({ companyId, range, filters, interval }) {
  const queryClient = useQueryClient();
  const rangeStart = range.previousStart.toISOString();
  const rangeEnd = range.end.toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const queryKey = ["sales-performance", companyId, rangeStart, rangeEnd, monthStart];

  const query = useQuery({
    queryKey,
    enabled: !!companyId,
    staleTime: 30_000,
    queryFn: async () => {
      const [leads, quotes, payments, invoices, activities, profiles, reminders, targets] = await Promise.all([
        checked(supabase.from("leads").select(LEAD_FIELDS).eq("company_id", companyId).gte("created_at", rangeStart).lte("created_at", rangeEnd).order("created_at", { ascending: false }), "Leads"),
        checked(supabase.from("quotes").select(QUOTE_FIELDS).eq("company_id", companyId).eq("is_template", false).order("created_at", { ascending: false }).limit(5000), "Quotes"),
        checked(supabase.from("payments").select(PAYMENT_FIELDS).eq("company_id", companyId).or(`payment_date.gte.${rangeStart.slice(0, 10)},created_at.gte.${rangeStart}`).order("created_at", { ascending: false }).limit(5000), "Payments"),
        checked(supabase.from("invoices").select("id,quote_id").eq("company_id", companyId).not("quote_id", "is", null).limit(5000), "Invoices"),
        checked(supabase.from("sales_activities").select(ACTIVITY_FIELDS).eq("company_id", companyId).gte("occurred_at", rangeStart).lte("occurred_at", rangeEnd).order("occurred_at", { ascending: false }).limit(1000), "Sales activity"),
        checked(supabase.from("profiles").select("id,full_name,email,role,is_active").eq("company_id", companyId).order("full_name"), "Team"),
        checked(supabase.from("client_reminders").select("id,lead_id,client_id,status,due_date,assigned_to").eq("company_id", companyId).order("due_date"), "Reminders"),
        checked(supabase.from("sales_targets").select("id,company_id,user_id,period_start,revenue_target,deals_target").eq("company_id", companyId).eq("period_start", monthStart), "Sales targets"),
      ]);
      const quoteMap = new Map(quotes.map(quote => [quote.id, quote]));
      const invoiceQuote = new Map(invoices.map(invoice => [invoice.id, invoice.quote_id]));
      const hydratedPayments = payments.map(payment => {
        const quoteId = payment.quote_id || invoiceQuote.get(payment.invoice_id) || null;
        return { ...payment, quote_id: quoteId, lead_id: quoteMap.get(quoteId)?.lead_id || null };
      });
      return { leads, quotes, payments: hydratedPayments, activities, profiles, reminders, target: targets.find(item => item.user_id == null) || null };
    },
  });

  useEffect(() => {
    if (!companyId) return undefined;
    const refresh = () => queryClient.invalidateQueries({ queryKey: ["sales-performance", companyId] });
    const channel = supabase.channel(`sales-performance-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_activities", filter: `company_id=eq.${companyId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_targets", filter: `company_id=eq.${companyId}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [companyId, queryClient]);

  const report = useMemo(() => query.data ? calculateSalesPerformance(query.data, { range, filters, interval }) : null, [query.data, range, filters, interval]);
  return { ...query, report, monthStart };
}
