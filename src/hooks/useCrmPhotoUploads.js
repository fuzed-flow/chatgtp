import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/api/supabaseClient';
import { createCrmPhotoUploader } from '@/lib/crmPhotoUploads';

export function useCrmPhotoUploads({ kind, recordId, companyId }) {
  const queryClient = useQueryClient();
  const uploader = useMemo(() => createCrmPhotoUploader({
    client: supabase, kind, recordId, companyId, apiUrl: import.meta.env.VITE_SUPABASE_URL,
    onSaved: (saved, job) => {
      if (kind === 'Lead') {
        // Save responses from two workers can arrive out of order. Add this
        // job to the current cache, then reconcile with the server at batch end.
        queryClient.setQueryData(['lead', companyId, recordId], previous => previous ? { ...previous, photos: [...new Set([job.url, ...(previous.photos || [])])] } : previous);
      } else {
        queryClient.setQueryData(['client-attachments', recordId], previous => [saved, ...(previous || []).filter(photo => photo.id !== saved.id)]);
      }
    },
    onFinished: ({ items }) => {
      const failed = items.filter(item => item.status === 'error').length;
      const done = items.filter(item => item.status === 'done').length;
      if (failed) toast.error(`${failed} photo${failed === 1 ? '' : 's'} need${failed === 1 ? 's' : ''} a retry. ${done} saved.`);
      else toast.success(`${done} photo${done === 1 ? '' : 's'} uploaded successfully`);
      if (kind === 'Lead') {
        queryClient.invalidateQueries({ queryKey: ['lead', companyId, recordId] });
        queryClient.invalidateQueries({ queryKey: ['leads', companyId] });
      }
    },
  }), [kind, recordId, companyId, queryClient]);
  const state = useSyncExternalStore(uploader.subscribe, uploader.getSnapshot, uploader.getSnapshot);
  useEffect(() => {
    if (!state.active) return;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [state.active]);
  return { ...state, start: uploader.start, retry: uploader.retry };
}
