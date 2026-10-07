import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BellRing, Loader2, X } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { DEFAULT_NOTIFICATION_PREFERENCES, useNotificationPreferences } from '@/lib/notificationPreferences';
import { enableNotificationPush, notificationPushStatus } from '@/lib/notificationPush';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function EmployeePushSetupPrompt() {
  const { profile, company } = useAuth();
  const queryClient = useQueryClient();
  const preferences = useNotificationPreferences(profile);
  const [status, setStatus] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const dismissalKey = profile?.id ? `fuzedflow-push-prompt-${profile.id}` : '';

  useEffect(() => {
    if (!dismissalKey) return;
    setDismissed(window.sessionStorage.getItem(dismissalKey) === 'dismissed');
  }, [dismissalKey]);

  useEffect(() => {
    let active = true;
    const refresh = () => notificationPushStatus()
      .then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setStatus('error'); });
    refresh();
    const listener = event => { if (event.data?.type === 'fuzedflow-push-expired') refresh(); };
    navigator.serviceWorker?.addEventListener('message', listener);
    return () => {
      active = false;
      navigator.serviceWorker?.removeEventListener('message', listener);
    };
  }, [profile?.id]);

  const dismiss = () => {
    if (dismissalKey) window.sessionStorage.setItem(dismissalKey, 'dismissed');
    setDismissed(true);
  };

  const enablePush = async () => {
    if (busy || !profile?.id) return;
    setBusy(true);
    try {
      if (status !== 'on') await enableNotificationPush();
      const nextPreferences = {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...preferences.data,
        push: true,
        categories: preferences.data?.categories || {},
        timezone: preferences.data?.timezone || company?.timezone || 'America/Edmonton',
        sms_phone: preferences.data?.sms_phone || profile.phone || '',
      };
      const { data, error } = await supabase.rpc('save_notification_preferences', { p_preferences: nextPreferences });
      if (error) throw error;
      queryClient.setQueryData(
        ['notification-preferences', profile.id],
        { ...DEFAULT_NOTIFICATION_PREFERENCES, ...data, categories: data?.categories || {} },
      );
      queryClient.invalidateQueries({ queryKey: ['notifications', profile.company_id, profile.id] });
      setStatus('on');
      toast.success('Push notifications are enabled on this device.');
    } catch (error) {
      toast.error(error?.message || 'Could not enable push notifications. Please try again.');
      setStatus(await notificationPushStatus().catch(() => 'error'));
    } finally {
      setBusy(false);
    }
  };

  if (dismissed || preferences.isPending || preferences.isError || status === 'checking') return null;
  if (status === 'on' && preferences.data?.push) return null;

  const unsupported = status === 'unsupported';
  const blocked = status === 'blocked';
  const detail = unsupported
    ? 'Push is unavailable in this browser. On iPhone or iPad, add Fuzed Flow to your Home Screen and open it there.'
    : blocked
      ? 'Notifications are blocked. Allow them for Fuzed Flow in your browser settings, then return here.'
      : status === 'on'
        ? 'This device is connected. Finish enabling push alerts for your assigned work.'
        : 'Get task, schedule, project, and company updates even when Fuzed Flow is not open.';

  return (
    <section aria-labelledby="employee-push-heading" className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm sm:mb-6 sm:flex sm:items-center sm:gap-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-slate-950">
        <BellRing className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="mt-3 min-w-0 flex-1 sm:mt-0">
        <h2 id="employee-push-heading" className="font-black text-slate-900">Turn on employee push notifications</h2>
        <p className="mt-1 text-sm leading-5 text-slate-600">{detail}</p>
      </div>
      <div className="mt-4 flex shrink-0 items-center gap-2 sm:mt-0">
        {!unsupported && !blocked ? (
          <Button type="button" onClick={enablePush} disabled={busy} className="min-h-11 bg-slate-900 font-bold text-white hover:bg-slate-800">
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BellRing className="mr-2 h-4 w-4" />}
            {status === 'on' ? 'Finish setup' : 'Enable push'}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" onClick={dismiss} className="h-11 w-11 shrink-0 text-slate-500" aria-label="Dismiss push notification setup for this session">
          <X className="h-5 w-5" />
        </Button>
      </div>
    </section>
  );
}

