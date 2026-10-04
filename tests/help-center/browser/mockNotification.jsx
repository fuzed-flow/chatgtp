import React from 'react';
import { Bell } from 'lucide-react';
export default function MockNotification() {
 return <button type="button" aria-label="Notifications preview" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400"><Bell className="h-5 w-5" aria-hidden="true"/></button>;
}
