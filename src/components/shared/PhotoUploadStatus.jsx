import React from 'react';
import { CheckCircle2, AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const labels = { queued: 'Waiting', preparing: 'Preparing', uploading: 'Uploading', retrying: 'Reconnecting', saving: 'Saving', done: 'Saved', error: 'Needs retry' };

export default function PhotoUploadStatus({ items = [], active = false, onRetry }) {
  if (!items.length) return null;
  const done = items.filter(item => item.status === 'done').length;
  const failed = items.filter(item => item.status === 'error');
  const working = items.filter(item => !['done', 'queued'].includes(item.status));
  const visible = active ? working : failed;
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3" data-photo-upload-status>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-sm font-semibold text-slate-800">
          {done} of {items.length} photos uploaded{active ? '…' : failed.length ? ` · ${failed.length} need a retry` : ''}
        </p>
        {!active && failed.length > 0 && <Button type="button" size="sm" variant="outline" onClick={onRetry}><RotateCcw className="mr-1.5 h-4 w-4" />Retry failed photos</Button>}
        {!active && !failed.length && <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-label="All photos saved" />}
      </div>
      <div role="progressbar" aria-label="Photos saved" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${done / items.length * 100}%` }} />
      </div>
      {visible.length > 0 && <ul className="mt-3 space-y-2">
        {visible.map(item => <li key={item.id} className="min-w-0 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            {item.status === 'error' ? <AlertCircle className="h-4 w-4 shrink-0 text-red-600" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-600" />}
            <span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
            <span className="shrink-0 font-medium">{labels[item.status]}{item.status === 'uploading' && item.percent > 0 ? ` ${item.percent}%` : ''}</span>
          </div>
          {item.status === 'error' && <p className="mt-1 break-words pl-6 text-red-700">{item.error}</p>}
        </li>)}
      </ul>}
    </div>
  );
}
