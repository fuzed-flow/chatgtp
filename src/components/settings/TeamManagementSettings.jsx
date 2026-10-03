import React, { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Users, UserPlus, Shield, HardHat, Mail, DollarSign, Edit, Search, Briefcase, Trash2, Loader2, CreditCard, AlertTriangle } from 'lucide-react';

export default function TeamManagementSettings() {
  const { company } = useAuth();
  const queryClient = useQueryClient();

  // Modal & Loading States
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [isCheckingLimit, setIsCheckingLimit] = useState(false);
  
  // State to control the Limit Reached Popup
  const [limitWarning, setLimitWarning] = useState({ show: false, max: 0, current: 0 });

  // Form & Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [inviteForm, setInviteForm] = useState({ email: '', full_name: '', role: 'employee', hourly_rate: 0 });
  const [editForm, setEditForm] = useState({ role: 'employee', hourly_rate: 0, is_active: true });

  // --- QUERIES ---
  // 1. Fetch Active Team Members (from profiles)
  const { data: team = [], isLoading: teamLoading } = useQuery({
    queryKey: ['team', company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('company_id', company.id)
        .order('full_name', { ascending: true });
      
      if (error) throw error;
      return data || [];
    }
  });

  // 2. Fetch Pending Invites (from team_invites)
  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ['team_invites', company?.id],
    enabled: !!company?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_invites')
        .select('*')
        .eq('company_id', company.id)
        .eq('is_pending', true); 
      
      if (error) throw error;
      return data || [];
    }
  });

  const isLoading = teamLoading || invitesLoading;

  // Combine Active Team and Pending Invites into one list
  const combinedTeam = [
    ...team.map(user => ({ ...user, is_pending: false })),
    ...invites.map(invite => ({ 
      id: invite.id || invite.email, 
      email: invite.email, 
      full_name: invite.full_name || 'Awaiting Sign Up', 
      role: invite.role,
      is_pending: invite.is_pending 
    }))
  ];

  // --- MUTATIONS ---
  const inviteUserMutation = useMutation({
    mutationFn: async (formData) => {
      const { data, error } = await supabase.from('team_invites').insert([{
        company_id: company.id,
        email: formData.email,
        role: formData.role,
        full_name: formData.full_name,
        hourly_rate: Number(formData.hourly_rate),
        is_pending: true
      }]).select(); 

      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Security policy blocked the save.");
      
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team_invites', company.id] });
      toast.success('Invite sent! They can now sign up.');
      setIsInviteOpen(false);
      setInviteForm({ email: '', full_name: '', role: 'employee', hourly_rate: 0 });
    },
    onError: (error) => {
      console.error(error);
      toast.error(`Failed: ${error.message}`);
    }
  });

  const deleteInviteMutation = useMutation({
    mutationFn: async (inviteId) => {
      const { error } = await supabase.from('team_invites').delete().eq('id', inviteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team_invites', company.id] });
      toast.success('Pending invite canceled.');
    },
    onError: (error) => toast.error(`Failed to cancel invite: ${error.message}`)
  });

  const deleteActiveUserMutation = useMutation({
    mutationFn: async (user) => {
      const { data, error } = await supabase.functions.invoke('delete-user', { body: { userId: user.id, email: user.email } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team', company.id] });
      queryClient.invalidateQueries({ queryKey: ['team_invites', company.id] });
      toast.success('Team member permanently deleted.');
    },
    onError: (error) => toast.error(`Failed to delete user: ${error.message}`)
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, is_pending, updates }) => {
      // If it's a pending invite, update the team_invites table
      if (is_pending) {
        // We strip out is_active because team_invites doesn't have that column
        const { is_active, ...inviteUpdates } = updates;
        const { error } = await supabase.from('team_invites').update(inviteUpdates).eq('id', id);
        if (error) throw error;
      } else {
        // If it's an active user, update the profiles table
        const { error } = await supabase.from('profiles').update(updates).eq('id', id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      // Invalidate both queries so the UI updates regardless of which table changed
      queryClient.invalidateQueries({ queryKey: ['team', company.id] });
      queryClient.invalidateQueries({ queryKey: ['team_invites', company.id] });
      toast.success('Team member updated successfully!');
      setIsEditOpen(false);
      setSelectedUser(null);
    },
    onError: (error) => toast.error(`Failed to update user: ${error.message}`)
  });

  // --- HANDLERS ---

  const handleInviteSubmit = async (e) => {
    e.preventDefault();
    if (!inviteForm.email || !inviteForm.full_name) {
      toast.error('Name and Email are required.');
      return;
    }

    setIsCheckingLimit(true);

    try {
      const { data: companyData, error: companyError } = await supabase
        .from('companies')
        .select('max_users')
        .eq('id', company.id)
        .single();

      if (companyError) throw companyError;

      const currentSeatCount = combinedTeam.length;

      if (currentSeatCount >= companyData.max_users) {
        setLimitWarning({ show: true, max: companyData.max_users, current: currentSeatCount });
        setIsCheckingLimit(false);
        setIsInviteOpen(false); 
        return; 
      }

      inviteUserMutation.mutate(inviteForm);
    } catch (err) {
      console.error(err);
      toast.error("Could not verify your subscription limits. Please try again.");
    } finally {
      setIsCheckingLimit(false);
    }
  };

  const handleManageUsers = async () => {
    setIsPortalLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session', {
        body: { return_url: window.location.href }
      });

      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      console.error(err);
      toast.error("Failed to open billing portal. Please contact support.");
      setIsPortalLoading(false);
    }
  };

  const openEditModal = (user) => {
    setSelectedUser(user);
    setEditForm({
      full_name: user.full_name || '', 
      role: user.role || 'employee',
      hourly_rate: user.hourly_rate || 0,
      is_active: user.is_active !== false
    });
    setIsEditOpen(true);
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    updateUserMutation.mutate({
      id: selectedUser.id,
      is_pending: selectedUser.is_pending, 
      updates: { 
        full_name: editForm.full_name,
        role: editForm.role, 
        hourly_rate: Number(editForm.hourly_rate), 
        is_active: editForm.is_active 
      }
    });
  };

  // --- FILTER LOGIC ---
  const filteredTeam = combinedTeam.filter((user) => {
    const term = searchQuery.toLowerCase();
    return (
      user.full_name?.toLowerCase().includes(term) ||
      user.email?.toLowerCase().includes(term) ||
      user.role?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 pb-12">
      
      {/* Header & Stats */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-amber-500" /> Team Management
          </h3>
          <p className="text-sm text-slate-500 mt-1">Manage employee access, roles, and payroll rates.</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleManageUsers} 
            disabled={isPortalLoading}
            variant="outline" 
            className="border-slate-300 text-slate-700 font-bold shadow-sm shrink-0"
          >
            {isPortalLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin text-slate-400" /> : <CreditCard className="h-4 w-4 mr-2 text-slate-400" />}
            Manage Seats
          </Button>
          <Button onClick={() => setIsInviteOpen(true)} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md shrink-0">
            <UserPlus className="h-4 w-4 mr-2" /> Invite Member
          </Button>
        </div>
      </div>

      {/* Roster Container */}
      <Card className="border-slate-200 shadow-sm overflow-hidden bg-white flex flex-col">
        
        {/* Search Bar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input 
              type="text" 
              placeholder="Search by name, email, or role..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-white"
            />
          </div>
        </div>

        {/* Roster List */}
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Loading team...</div>
        ) : filteredTeam.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {searchQuery ? "No team members match your search." : "No team members found. Invite someone to get started!"}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredTeam.map((user) => (
              <div key={user.id} className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors hover:bg-slate-50 ${user.is_active === false ? 'opacity-60' : ''}`}>
                
                {/* User Info */}
                <div className="flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-full flex items-center justify-center font-black text-lg shrink-0 
                    ${user.role === 'admin' ? 'bg-slate-900 text-amber-400' : 
                      user.role === 'manager' ? 'bg-blue-100 text-blue-700' : 
                      user.is_pending ? 'bg-purple-100 text-purple-700' :
                      'bg-amber-100 text-amber-700'}`}>
                    {user.full_name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 flex items-center gap-2">
                      {user.full_name}
                      {user.is_pending && (
                        <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">
                          Pending Invite
                        </span>
                      )}
                      {user.is_active === false && !user.is_pending && (
                        <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">
                          Inactive
                        </span>
                      )}
                    </h4>
                    <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-0.5"><Mail className="h-3 w-3" /> {user.email}</p>
                  </div>
                </div>

                {/* Role & Settings */}
                <div className="flex items-center gap-6 sm:gap-8">
                  {/* Role Badge */}
                  <div className="flex items-center gap-2 w-24">
                    {user.role === 'admin' ? (
                      <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full border border-slate-200">
                        <Shield className="h-3.5 w-3.5 text-slate-500" /> Admin
                      </span>
                    ) : user.role === 'manager' ? (
                      <span className="flex items-center gap-1.5 text-xs font-bold text-blue-800 bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
                        <Briefcase className="h-3.5 w-3.5 text-blue-600" /> Manager
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs font-bold text-amber-800 bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                        <HardHat className="h-3.5 w-3.5 text-amber-600" /> Employee
                      </span>
                    )}
                  </div>

                  {/* Hourly Rate */}
                  {!user.is_pending && (
                    <div className="hidden sm:block text-right min-w-[80px]">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pay Rate</p>
                      <p className="font-semibold text-slate-900">${(user.hourly_rate || 0).toFixed(2)}<span className="text-xs text-slate-500 font-medium">/hr</span></p>
                    </div>
                  )}

                  {/* Edit / Delete Buttons */}
                  {!user.is_pending ? (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditModal(user)} className="text-slate-400 hover:text-amber-600 hover:bg-amber-50 shrink-0">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => {
                          if (window.confirm(`Are you sure you want to permanently delete ${user.full_name}? This will remove their login access completely.`)) {
                            deleteActiveUserMutation.mutate(user);
                          }
                        }}
                        disabled={deleteActiveUserMutation.isPending}
                        className="text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                        title="Delete User"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => deleteInviteMutation.mutate(user.id)} 
                      disabled={deleteInviteMutation.isPending}
                      className="text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                      title="Cancel Invite"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* --- INVITE MODAL --- */}
      <Dialog open={isInviteOpen} onOpenChange={setIsInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-amber-500" /> Invite Team Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleInviteSubmit} className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Full Name *</Label>
                <Input value={inviteForm.full_name} onChange={e => setInviteForm({...inviteForm, full_name: e.target.value})} placeholder="John Doe" required className="mt-1" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Email Address *</Label>
                <Input type="email" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} placeholder="john@company.com" required className="mt-1" />
              </div>
              
              <div className="col-span-2 sm:col-span-1">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Access Role</Label>
                <Select value={inviteForm.role} onValueChange={v => setInviteForm({...inviteForm, role: v})}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee (Field Only)</SelectItem>
                    <SelectItem value="manager">Manager (Ops Access)</SelectItem>
                    <SelectItem value="admin">Admin (Full Access)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 sm:col-span-1">
                <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Hourly Pay Rate</Label>
                <div className="relative mt-1">
                  <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <Input type="number" step="0.01" value={inviteForm.hourly_rate} onChange={e => setInviteForm({...inviteForm, hourly_rate: e.target.value})} className="pl-9" />
                </div>
              </div>
            </div>
            
            <DialogFooter className="pt-4 border-t border-slate-100">
              <Button type="button" variant="ghost" onClick={() => setIsInviteOpen(false)}>Cancel</Button>
              <Button 
                type="submit" 
                disabled={inviteUserMutation.isPending || isCheckingLimit} 
                className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold"
              >
                {isCheckingLimit ? "Verifying..." : inviteUserMutation.isPending ? "Sending..." : "Send Invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- EDIT MODAL --- */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit className="h-5 w-5 text-amber-500" /> Edit Team Member
            </DialogTitle>
          </DialogHeader>
          {selectedUser && (
            <form onSubmit={handleEditSubmit} className="space-y-4 pt-4">
              
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 mb-2 space-y-3">
                <div>
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Full Name</Label>
                  <Input 
                    value={editForm.full_name} 
                    onChange={e => setEditForm({...editForm, full_name: e.target.value})} 
                    className="mt-1 bg-white" 
                    required 
                  />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Email Address</p>
                  <p className="text-sm font-medium text-slate-700 mt-1">{selectedUser.email}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Access Role</Label>
                  <Select value={editForm.role} onValueChange={v => setEditForm({...editForm, role: v})}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Employee (Field Only)</SelectItem>
                      <SelectItem value="manager">Manager (Ops Access)</SelectItem>
                      <SelectItem value="admin">Admin (Full Access)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Hourly Pay Rate</Label>
                  <div className="relative mt-1">
                    <DollarSign className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input 
                      type="number" 
                      step="0.01" 
                      value={editForm.hourly_rate} 
                      onChange={e => setEditForm({...editForm, hourly_rate: e.target.value})} 
                      className="pl-9" 
                    />
                  </div>
                </div>
              </div>

              {/* Hide Active Account toggle for pending invites */}
              {!selectedUser.is_pending && (
                <div className="pt-4 pb-2">
                  <div className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg">
                    <div>
                      <Label className="font-bold text-slate-900">Active Account</Label>
                      <p className="text-xs text-slate-500 mt-0.5">Turn off to instantly revoke login access.</p>
                    </div>
                    <Switch checked={editForm.is_active} onCheckedChange={v => setEditForm({...editForm, is_active: v})} />
                  </div>
                </div>
              )}
              
              <DialogFooter className="pt-4 border-t border-slate-100">
                <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={updateUserMutation.isPending} className="bg-slate-900 hover:bg-slate-800 text-white font-bold">
                  {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* LIMIT REACHED POPUP */}
      <Dialog open={limitWarning.show} onOpenChange={(open) => setLimitWarning(prev => ({ ...prev, show: open }))}>
        <DialogContent className="sm:max-w-md text-center border-0 ring-1 ring-slate-200 shadow-2xl">
          <div className="mx-auto w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-2 mt-4 shadow-inner">
            <AlertTriangle className="h-8 w-8 text-amber-600" />
          </div>
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-slate-900 mx-auto">Seat Limit Reached</DialogTitle>
          </DialogHeader>
          
          <div className="py-2">
            <p className="text-slate-500 font-medium">
              You have used <strong>{limitWarning.current}</strong> of your <strong>{limitWarning.max}</strong> available Fuzed Flow seats.
            </p>
            <p className="text-slate-500 text-sm mt-3">
              To invite a new team member, please click below to securely add another seat to your subscription via Stripe.
            </p>
          </div>
          
          <DialogFooter className="flex-col sm:flex-row gap-3 w-full mt-4">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={() => setLimitWarning({ show: false, max: 0, current: 0 })} 
              className="w-full sm:w-1/3 text-slate-500 font-bold"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleManageUsers} 
              disabled={isPortalLoading} 
              className="w-full sm:w-2/3 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold shadow-md"
            >
              {isPortalLoading ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <CreditCard className="h-5 w-5 mr-2" />
              )}
              Manage Seats in Stripe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}