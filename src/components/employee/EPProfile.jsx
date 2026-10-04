import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
export default function EPProfile() {
 const {profile:authProfile}=useAuth(); const qc=useQueryClient(); const [form,setForm]=useState(null);
 const {data:profile,isLoading,error}=useQuery({queryKey:['ep_profile',authProfile?.id],enabled:!!authProfile?.id,queryFn:async()=>{
  const {data,error}=await supabase.from('profiles').select('id,full_name,phone,email,role,hourly_rate,is_active').eq('id',authProfile.id).single();if(error)throw error;return data;
 }});
 const save=useMutation({mutationFn:async()=>{
  const {error}=await supabase.from('profiles').update({full_name:form.full_name.trim(),phone:form.phone.trim()}).eq('id',authProfile.id);if(error)throw error;
 },onSuccess:()=>{qc.invalidateQueries({queryKey:['ep_profile']});qc.invalidateQueries({queryKey:['currentUserData']});setForm(null);toast.success('Profile updated');},onError:e=>toast.error(e.message)});
 if(isLoading)return <p role="status">Loading profile…</p>;if(error)return <p role="alert">Your profile could not be loaded. Please try again.</p>;if(!profile)return null;
 return <section className="max-w-xl space-y-4 rounded-xl border bg-white p-6"><h2 className="text-xl font-bold">My Profile</h2>
 {form?<form className="space-y-4" onSubmit={e=>{e.preventDefault();save.mutate();}}><label className="block">Full name<Input required maxLength={150} value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/></label><label className="block">Phone<Input type="tel" maxLength={40} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></label><Button disabled={save.isPending}>Save</Button><Button type="button" variant="outline" onClick={()=>setForm(null)}>Cancel</Button></form>:<><dl className="grid grid-cols-2 gap-3"><dt>Name</dt><dd>{profile.full_name}</dd><dt>Email</dt><dd className="break-all">{profile.email}</dd><dt>Phone</dt><dd>{profile.phone||'—'}</dd><dt>Role</dt><dd>{profile.role}</dd></dl><Button onClick={()=>setForm({full_name:profile.full_name||'',phone:profile.phone||''})}>Edit contact details</Button></>}
 <p className="text-sm text-slate-600">Your administrator manages your role, pay rate and account access.</p></section>;
}
