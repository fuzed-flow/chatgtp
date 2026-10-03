import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, Mail, Shield, Trash2, Plus, AlertCircle } from "lucide-react";
import { toast } from "sonner"; // Assuming you use Sonner for toasts!

export default function TeamSettings() {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("user");

  // 1. Fetch Active Team Members
  const { data: team = [] } = useQuery({
    queryKey: ["team", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("company_id", companyId);
      if (error) throw error; return data;
    }
  });

  // 2. Fetch Pending Invites
  const { data: invites = [] } = useQuery({
    queryKey: ["invites", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("team_invites").select("*").eq("company_id", companyId);
      if (error) throw error; return data;
    }
  });

  // 3. The Invite Mutation (Where we hit the bouncer!)
  const inviteUser = useMutation({
    mutationFn: async (e) => {
      e.preventDefault();
      
      const { data, error } = await supabase
        .from("team_invites")
        .insert([{ company_id: companyId, email: inviteEmail, role: inviteRole }]);
        
      if (error) throw error; // If the bouncer blocks it, this throws the error to the catch block!
      return data;
    },
    onSuccess: () => {
      toast.success("Invite sent successfully!");
      setInviteEmail("");
      queryClient.invalidateQueries(["invites", companyId]);
    },
    onError: (error) => {
      // THIS IS WHERE WE CATCH THE BOUNCER!
      if (error.message.includes("PLAN LIMIT REACHED")) {
        toast.error("Upgrade Required: You have reached your user limit!", { duration: 5000 });
      } else {
        toast.error(error.message);
      }
    }
  });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Team Settings</h1>
        <p className="text-slate-500 mt-1">Manage your employees and pending invites.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* LEFT COLUMN: The Invite Form */}
        <div className="md:col-span-1 space-y-6">
          <Card className="p-5 border-2 border-slate-200">
            <h3 className="text-lg font-bold text-slate-800 flex items-center mb-4">
              <Mail className="h-5 w-5 mr-2 text-amber-500" />
              Invite Team Member
            </h3>
            
            <form onSubmit={inviteUser.mutate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-amber-500 focus:border-amber-500"
                  placeholder="employee@company.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white focus:ring-amber-500 focus:border-amber-500"
                >
                  <option value="user">Standard User</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <Button 
                type="submit" 
                className="w-full bg-slate-900 text-white hover:bg-slate-800"
                disabled={inviteUser.isLoading}
              >
                {inviteUser.isLoading ? "Sending..." : "Send Invite"}
              </Button>
            </form>
          </Card>
        </div>

        {/* RIGHT COLUMN: Active Team & Pending Invites */}
        <div className="md:col-span-2 space-y-6">
          
          <Card className="p-0 overflow-hidden border-2 border-slate-200">
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-800 flex items-center">
                <Users className="h-5 w-5 mr-2 text-blue-500" />
                Active Team ({team.length})
              </h3>
            </div>
            <div className="divide-y divide-slate-100">
              {team.map((member) => (
                <div key={member.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">
                      {member.full_name?.charAt(0).toUpperCase() || "U"}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{member.full_name}</p>
                      <p className="text-xs text-slate-500 capitalize flex items-center">
                        {member.role === 'admin' && <Shield className="h-3 w-3 mr-1 text-emerald-500" />}
                        {member.role}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {invites.length > 0 && (
            <Card className="p-0 overflow-hidden border-2 border-amber-200">
              <div className="bg-amber-50 p-4 border-b border-amber-200 flex items-center">
                <AlertCircle className="h-5 w-5 mr-2 text-amber-600" />
                <h3 className="text-lg font-bold text-slate-800">Pending Invites</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {invites.map((invite) => (
                  <div key={invite.id} className="p-4 flex items-center justify-between bg-white">
                    <div>
                      <p className="font-medium text-slate-900">{invite.email}</p>
                      <p className="text-xs text-slate-500 capitalize">Role: {invite.role}</p>
                    </div>
                    <button className="text-red-400 hover:text-red-600 p-2">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}