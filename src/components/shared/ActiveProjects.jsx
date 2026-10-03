import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderKanban, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StatusBadge from "./StatusBadge";

export default function ActiveProjectsSection({ activeProjects, clients }) {
  const navigate = useNavigate();

  // Helper to resolve the client name
  const getClientName = (clientId) => {
    if (!clientId) return 'No Client Linked';
    const client = clients.find(c => String(c.id) === String(clientId));
    if (!client) return 'Unknown Client';
    
    const name = client.name?.trim();
    const first = client.first_name?.trim();
    const last = client.surname?.trim();
    const primary = client.primary_contact_name?.trim();

    if (name && name !== "") return name;
    if (first || last) return [first, last].filter(Boolean).join(" ");
    if (primary && primary !== "") return primary;
    
    return 'Unnamed Client';
  };

  return (
    <Card className="p-5 md:p-6 border-slate-200 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-amber-500" /> Active Projects
        </h3>
        <Button variant="ghost" size="sm" onClick={() => navigate('/PMProjects')} className="text-slate-500 hover:text-slate-900">
          View All Projects
        </Button>
      </div>

      <div className="space-y-3">
        {activeProjects.slice(0, 3).map(project => (
          <div key={project.id} className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm transition-all hover:border-amber-400">
            <div className="p-4 flex items-center justify-between cursor-pointer group hover:bg-slate-50" onClick={() => navigate(`/PMProjectWorkspace?id=${project.id}`)}>
              <div className="min-w-0 flex-1">
                <h4 className="font-bold text-slate-900 truncate">{project.name}</h4>
                <p className="text-sm font-semibold text-amber-600 truncate">{getClientName(project.client_id)}</p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={project.status} />
                <ArrowRight className="h-5 w-5 text-slate-400 group-hover:text-amber-500 transition-colors" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}