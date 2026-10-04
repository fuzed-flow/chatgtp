import React from "react";
import { FileSignature } from "lucide-react";
import DocumentWorkflows from "@/components/documents/DocumentWorkflows";

export default function DocumentRequests() {
  return <main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
    <header><h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><FileSignature className="h-7 w-7 text-amber-600" /> Document requests</h1><p className="mt-2 text-sm text-slate-600">Review your assigned documents, record a response and check the saved activity. Your company access determines which requests appear.</p></header>
    <DocumentWorkflows inbox />
  </main>;
}
