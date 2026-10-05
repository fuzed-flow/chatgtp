import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2, Smartphone } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_CATEGORIES, useNotificationPreferences } from '@/lib/notificationPreferences';
import { disableNotificationPush, enableNotificationPush, notificationPushStatus } from '@/lib/notificationPush';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function PersonalNotificationSettings({ compact = false }) {
  const { profile, user, company } = useAuth();
  const queryClient = useQueryClient();
  const preferences = useNotificationPreferences(profile);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState('checking');
  useEffect(() => {
    if (preferences.data) setForm({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...preferences.data,
      timezone: preferences.data.timezone || company?.timezone || 'America/Edmonton',
      sms_phone: preferences.data.sms_phone || profile?.phone || '' });
  }, [preferences.data, profile?.phone, company?.timezone]);
  useEffect(() => {
    let active = true;
    const refresh = () => notificationPushStatus().then(value => { if (active) setPushStatus(value); }).catch(() => { if (active) setPushStatus('error'); });
    refresh();
    const listener = event => { if (event.data?.type === 'fuzedflow-push-expired') refresh(); };
    navigator.serviceWorker?.addEventListener('message', listener);
    return () => { active = false; navigator.serviceWorker?.removeEventListener('message', listener); };
  }, [profile?.id]);
  const change = (field, value) => setForm(previous => ({ ...previous, [field]: value }));
  const save = async event => {
    event.preventDefault();
    if (saving || !form) return;
    if (form.sms && !/^\+[1-9]\d{7,14}$/.test(form.sms_phone.trim())) {
      toast.error('Use an international mobile number, such as +17805551234.'); return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('save_notification_preferences', { p_preferences: form });
      if (error) throw error;
      queryClient.setQueryData(['notification-preferences', profile.id], { ...DEFAULT_NOTIFICATION_PREFERENCES, ...data });
      queryClient.invalidateQueries({ queryKey: ['notifications', profile.company_id, profile.id] });
      toast.success('Your notification preferences are saved.');
    } catch { toast.error('Could not save your notification preferences. Please try again.'); }
    finally { setSaving(false); }
  };
  const connectPush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try { setPushStatus(await enableNotificationPush()); change('push', true); toast.success('This device is connected. Save preferences to enable push alerts.'); }
    catch (error) { toast.error(error.message); }
    finally { setPushBusy(false); }
  };
  const disconnectPush = async () => {
    setPushBusy(true);
    try { await disableNotificationPush(); setPushStatus('off'); toast.success('Push notifications are disabled on this device.'); }
    catch (error) { toast.error(error.message); }
    finally { setPushBusy(false); }
  };
  if (preferences.isError) return <div className="p-4"><p role="alert" className="text-sm text-red-700">Your notification preferences could not load.</p><Button variant="outline" onClick={() => preferences.refetch()}>Retry</Button></div>;
  if (preferences.isPending || !form) return <div role="status" className="p-4 text-sm text-slate-500">Loading your notification preferences…</div>;
  return <form onSubmit={save} className={`space-y-5 ${compact ? 'p-4' : 'rounded-xl border border-slate-200 bg-white p-5 sm:p-6'}`}>
    <div><h3 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Bell className="h-5 w-5 text-amber-600" />My notifications</h3><p className="mt-1 text-sm text-slate-600">Choose how you receive updates for your role and assigned work. Email, SMS and push start off until you enable them.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      {[
        ['in_app', 'In-app notification bell', 'Keep updates available while using Fuzed Flow.'],
        ['email', 'Instant email', `Send to ${user?.email || profile?.email || 'your verified account email'}.`],
        ['sms', 'SMS text messages', 'Send alerts to your mobile number. Message and data rates may apply.'],
        ['push', 'Device push notifications', 'Receive alerts on connected browsers and installed mobile apps.'],
      ].map(([key, title, hint]) => <label key={key} className="flex min-h-20 items-center justify-between gap-4 rounded-lg border border-slate-200 p-3"><span><span className="block text-sm font-semibold text-slate-900">{title}</span><span className="mt-1 block text-xs text-slate-500">{hint}</span></span><Switch className="data-[state=checked]:bg-amber-500" aria-label={title} checked={!!form[key]} onCheckedChange={value => change(key, value)} /></label>)}
    </div>
    {form.sms && <label className="block text-sm font-semibold text-slate-700">My mobile number<Input type="tel" autoComplete="tel" value={form.sms_phone} onChange={event => change('sms_phone', event.target.value)} placeholder="+17805551234" className="mt-1 min-h-11 text-base focus-visible:ring-amber-500" /><span className="mt-1 block text-xs font-normal text-slate-500">Include the country code. Enabling SMS confirms you want Fuzed Flow alerts at this number.</span></label>}
    <div className="rounded-lg bg-amber-50 p-3 text-sm text-slate-700"><p className="flex items-center gap-2 font-semibold"><Smartphone className="h-4 w-4 text-amber-700" />This device</p><p className="mt-1 text-xs">{pushStatus === 'on' ? 'Connected for push notifications.' : pushStatus === 'unsupported' ? 'Push is unavailable here. On iPhone or iPad, add Fuzed Flow to your Home Screen and open it there.' : pushStatus === 'blocked' ? 'Notifications are blocked. Allow them in browser settings before reconnecting.' : pushStatus === 'error' ? 'Could not check this device. Try connecting again.' : 'Connect this browser to receive push notifications.'}</p><Button type="button" size="sm" disabled={pushBusy || pushStatus === 'unsupported' || pushStatus === 'checking'} onClick={pushStatus === 'on' ? disconnectPush : connectPush} className="mt-3 min-h-11 bg-amber-500 text-slate-900 hover:bg-amber-600">{pushBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}{pushStatus === 'on' ? 'Disable on this device' : 'Connect this device'}</Button></div>
    <fieldset><legend className="text-sm font-bold text-slate-900">Categories</legend><p className="mb-3 mt-1 text-xs text-slate-500">Applies to all your channels and digests. You only receive events your account can access.</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{NOTIFICATION_CATEGORIES.map(category => <label key={category} className="flex min-h-11 items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.categories?.[category] !== false} onChange={event => change('categories', { ...form.categories, [category]: event.target.checked })} className="h-4 w-4 accent-amber-500" />{category}</label>)}</div></fieldset>
    <fieldset className="space-y-3 border-t border-slate-200 pt-4"><legend className="text-sm font-bold text-slate-900">Timing</legend><label className="flex min-h-11 items-center justify-between gap-4 text-sm text-slate-700"><span>Quiet hours for email, SMS and push</span><Switch className="data-[state=checked]:bg-amber-500" aria-label="Quiet hours" checked={form.quiet_enabled} onCheckedChange={value => change('quiet_enabled', value)} /></label>{form.quiet_enabled && <div className="grid grid-cols-2 gap-3"><label className="text-sm text-slate-700">From<Input type="time" required value={form.quiet_start.slice(0, 5)} onChange={event => change('quiet_start', event.target.value)} className="mt-1 min-h-11" /></label><label className="text-sm text-slate-700">Until<Input type="time" required value={form.quiet_end.slice(0, 5)} onChange={event => change('quiet_end', event.target.value)} className="mt-1 min-h-11" /></label></div>}<label className="block text-sm text-slate-700">Timezone<Input required value={form.timezone} onChange={event => change('timezone', event.target.value)} placeholder="America/Edmonton" className="mt-1 min-h-11" /></label><label className="block text-sm text-slate-700">Email digest<select value={form.digest_frequency} onChange={event => change('digest_frequency', event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base focus:ring-amber-500"><option value="off">Off</option><option value="daily">Daily summary</option><option value="weekly">Weekly summary</option></select></label>{form.digest_frequency !== 'off' && <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-700">Send after<select value={form.digest_hour} onChange={event => change('digest_hour', Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3">{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>{form.digest_frequency === 'weekly' && <label className="text-sm text-slate-700">Day<select value={form.digest_weekday} onChange={event => change('digest_weekday', Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3">{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>}</div>}<p className="text-xs text-slate-500">Digests are emailed separately from instant email alerts and contain new updates after you opt in. Quiet hours delay delivery; they do not remove updates.</p></fieldset>
    <Button type="submit" disabled={saving || pushBusy} className="min-h-11 w-full bg-amber-500 font-bold text-slate-900 hover:bg-amber-600 sm:w-auto">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save my preferences</Button>
  </form>;
}
