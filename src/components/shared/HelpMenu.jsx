import React from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, PlayCircle, MessageCircle, BookOpen } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

export default function HelpMenu({ onCloseSidebar }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label="Open help menu" className="group flex h-12 min-w-12 shrink-0 items-center justify-center rounded-lg px-1 text-sm font-semibold text-slate-900 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
        <span className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-2 transition-colors group-hover:bg-amber-400">
          <HelpCircle className="h-5 w-5" aria-hidden="true" /><span>Help</span>
        </span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} className="z-[70] w-64 max-w-[calc(100vw-2rem)] rounded-xl p-1.5">
      <DropdownMenuLabel className="text-xs text-slate-500">FuzedFlow support</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {[
        { path: '/HelpArticles', label: 'Help Articles', icon: BookOpen },
        { path: '/FAQ', label: 'Quick answers & FAQ', icon: HelpCircle },
        { path: '/Contact', label: 'Contact support', icon: MessageCircle },
        { path: '/Tutorials', label: 'Video tutorials', icon: PlayCircle },
      ].map(({ path, label, icon: Icon }) => <DropdownMenuItem asChild key={path} className="min-h-12 rounded-lg focus:bg-amber-50 focus:text-amber-900"><Link to={path} onClick={onCloseSidebar} className="flex items-center gap-3 px-3 text-sm font-medium"><Icon className="h-5 w-5 text-amber-600" aria-hidden="true" />{label}</Link></DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>;
}
