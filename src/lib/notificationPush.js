import { supabase } from '@/api/supabaseClient';

const WORKER = '/notification-worker.js';
export const supportsNotificationPush = () => typeof window !== 'undefined' && window.isSecureContext
  && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const decodeKey = value => {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
};
export async function notificationPushStatus() {
  if (!supportsNotificationPush()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const registration = await navigator.serviceWorker.getRegistration(WORKER);
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return 'off';
  const { data, error } = await supabase.from('notification_push_subscriptions').select('id').eq('endpoint', subscription.endpoint).maybeSingle();
  if (error) throw error;
  return data ? 'on' : 'off';
}
export async function enableNotificationPush() {
  if (!supportsNotificationPush()) throw new Error('Push is unavailable in this browser. On iPhone or iPad, add Fuzed Flow to your Home Screen and open it there.');
  // Request only inside an explicit user click. No permission prompts during login or page load.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'Notifications are blocked. Allow them in your browser settings, then try again.' : 'Notification permission was not granted.');
  const { data: config, error: configError } = await supabase.rpc('notification_push_config');
  if (configError || !config?.public_key) throw new Error('Push delivery is not configured yet. Please try again later.');
  const registration = await navigator.serviceWorker.register(WORKER, { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const { data } = await supabase.from('notification_push_subscriptions').select('id').eq('endpoint', subscription.endpoint).maybeSingle();
    // A shared browser must not silently inherit another account's subscription.
    if (!data) { await subscription.unsubscribe(); subscription = null; }
  }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.public_key) });
  const { error } = await supabase.rpc('register_notification_push', { p_subscription: subscription.toJSON(), p_device: navigator.userAgent.slice(0, 180) });
  if (error) { await subscription.unsubscribe(); throw new Error('Could not register this device. Please try again.'); }
  return 'on';
}
export async function disableNotificationPush() {
  if (!supportsNotificationPush()) return;
  const registration = await navigator.serviceWorker.getRegistration(WORKER);
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    const { error } = await supabase.rpc('remove_notification_push', { p_endpoint: subscription.endpoint });
    if (error) throw new Error('Could not disable this device. Please try again.');
    await subscription.unsubscribe();
  }
  await registration?.getNotifications().then(notifications => notifications.forEach(notification => notification.close()));
}

export async function clearNotificationPushOnSignOut() {
  try { await disableNotificationPush(); } catch {
    // Remove the browser subscription even if an expired session cannot revoke the server row.
    const registration = await navigator.serviceWorker?.getRegistration(WORKER);
    await registration?.pushManager.getSubscription().then(subscription => subscription?.unsubscribe());
    await registration?.getNotifications().then(notifications => notifications.forEach(notification => notification.close()));
  }
}
