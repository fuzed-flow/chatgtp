import React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";

import { supabase } from "@/api/supabaseClient";
import { ClientUpdatePreview } from "@/components/client-updates/ClientUpdatePreviewDialog";
import { generateClientUpdatePDF } from "@/components/pdf/PDFGenerator";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function ClientUpdateView() {
  const { profile, company } = useAuth();
  const [searchParams] = useSearchParams();
  const updateId = searchParams.get("id") || "";
  const companyId = profile?.company_id;
  const validId = UUID.test(updateId);

  const previewQuery = useQuery({
    queryKey: ["client-update-view", companyId, updateId],
    enabled: !!companyId && validId,
    queryFn: async () => {
      const { data: update, error } = await supabase.from("client_updates")
        .select("*").eq("id", updateId).eq("company_id", companyId).maybeSingle();
      if (error) throw error;
      if (!update) throw new Error("This client update could not be found.");

      const [projectResult, clientResult] = await Promise.all([
        supabase.from("projects").select("id,name,project_number,site_address").eq("id", update.project_id).eq("company_id", companyId).maybeSingle(),
        supabase.from("clients").select("id,name,email,phone,site_address").eq("id", update.client_id).eq("company_id", companyId).maybeSingle(),
      ]);
      if (projectResult.error) throw projectResult.error;
      if (clientResult.error) throw clientResult.error;
      return { update, project: projectResult.data, client: clientResult.data };
    },
  });

  const content = previewQuery.data;
  const error = !validId ? new Error("This client update link is invalid.") : previewQuery.error;

  return (
    <div className="min-h-[100dvh] bg-slate-100 pt-[env(safe-area-inset-top)]">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-4xl items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <Button variant="ghost" asChild className="min-h-11 px-2 sm:px-3">
            <Link to="/ClientUpdates"><ArrowLeft className="mr-2 h-4 w-4" />Back to Client Updates</Link>
          </Button>
          {content && (
            <Button variant="outline" className="min-h-11 shrink-0" onClick={() => generateClientUpdatePDF(content.update, content.project, content.client, company)}>
              <Download className="mr-2 h-4 w-4" /><span className="hidden sm:inline">Download </span>PDF
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 sm:py-8">
        {previewQuery.isPending && validId && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">Loading client update…</div>}
        {error && <div role="alert" className="rounded-2xl border border-red-200 bg-white p-6 text-red-800 shadow-sm"><h1 className="font-bold">Client update unavailable</h1><p className="mt-2 text-sm">{error.message}</p></div>}
        {content && <ClientUpdatePreview update={content.update} project={content.project} client={content.client} company={company} />}
      </main>
    </div>
  );
}
