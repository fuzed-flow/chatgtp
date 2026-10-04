import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

export const NOTIFICATION_CATEGORIES = ['Leads', 'Projects', 'Tasks', 'Quotes', 'Change Orders', 'Financial', 'Scheduling', 'Daily Logs', 'Timesheets', 'Documents', 'Subcontractors', 'Inventory', 'Mentions', 'Warranty', 'Admin', 'Security', 'Platform', 'Support', 'Updates'];
export const DEFAULT_NOTIFICATION_PREFERENCES = {
  in_app: true, email: false, sms: false, push: false, categories: {},
  quiet_enabled: false, quiet_start: '22:00', quiet_end: '08:00', timezone: 'America/Edmonton',
  digest_frequency: 'off', digest_hour: 8, digest_weekday: 1,
};
export function useNotificationPreferences(profile) {
  return useQuery({
    queryKey: ['notification-preferences', profile?.id], enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('notification_preferences').select('*').eq('user_id', profile.id).maybeSingle();
      if (error) throw error;
      return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...data, categories: data?.categories || {} };
    },
    staleTime: 60000,
  });
}
export function mutedNotificationCategories(preferences) {
  return Object.entries(preferences?.categories || {}).filter(([category, enabled]) => enabled === false && NOTIFICATION_CATEGORIES.includes(category)).map(([category]) => category);
}
