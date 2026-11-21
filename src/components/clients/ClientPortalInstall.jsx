import React, { useEffect, useState } from 'react';
import { Download, Check, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useInstallApp } from '@/components/shared/InstallAppDialog';
import { resetAppInstallPrompt } from '@/lib/installApp';
import { portalAssetUrl } from '@/lib/clientPortalManifest';

export default function ClientPortalInstall({ company, clientId, token }) {
  const { status, platform, install } = useInstallApp();
  const [helpOpen, setHelpOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const name = `${company.name || 'Your Contractor'} Client Portal`;
  const logo = company.logo_url || company.company_logo_url;

  useEffect(() => {
    if (!token) return;
    const title = document.title;
    const entries = [
      ['link[rel="manifest"]', 'href', portalAssetUrl(clientId, token)],
      ['link[rel="apple-touch-icon"]', 'href', portalAssetUrl(clientId, token, 'icon', 192)],
      ['meta[name="apple-mobile-web-app-title"]', 'content', name],
    ].map(([selector, attribute, value]) => {
      const element = document.querySelector(selector);
      const original = element?.getAttribute(attribute);
      element?.setAttribute(attribute, value);
      return { element, attribute, original };
    });
    document.title = name;
    resetAppInstallPrompt();
    return () => {
      document.title = title;
      entries.forEach(({ element, attribute, original }) => {
        if (original === null) element?.removeAttribute(attribute);
        else if (original !== undefined) element?.setAttribute(attribute, original);
      });
      resetAppInstallPrompt();
    };
  }, [clientId, token, name]);

  const addPortal = async () => {
    if (status !== 'ready') { setHelpOpen(true); return; }
    setInstalling(true);
    try { const result = await install(); if (result.outcome === 'unavailable') setHelpOpen(true); }
    catch { setHelpOpen(true); }
    finally { setInstalling(false); }
  };

  return <>
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {logo ? <img src={logo} alt={`${company.name} logo`} className="h-12 w-12 rounded-lg border border-slate-100 bg-white object-contain p-1" /> : <Smartphone className="h-10 w-10 text-slate-700" />}
        <div><p className="font-bold text-slate-900">{name}</p><p className="text-sm text-slate-500">Keep your portal handy on your phone or computer.</p></div>
      </div>
      <Button type="button" onClick={addPortal} disabled={status === 'installed' || installing || !token} className="min-h-11 shrink-0 bg-amber-500 font-bold text-slate-950 hover:bg-amber-400">
        {status === 'installed' ? <Check className="mr-2 h-4 w-4" /> : <Download className="mr-2 h-4 w-4" />}
        {status === 'installed' ? 'Portal added' : installing ? 'Adding portal…' : 'Add Client Portal'}
      </Button>
    </div>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent showAIHelp={false} className="max-w-md bg-white">
        <DialogHeader><DialogTitle>Add {name}</DialogTitle><DialogDescription>Save this portal so you can return directly to your project documents and updates.</DialogDescription></DialogHeader>
        <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-700">
          {platform === 'ios' ? <><li>Open this portal link in Safari.</li><li>Tap Share, then Add to Home Screen.</li><li>Name it “{name}” and tap Add.</li></> : platform === 'android' ? <><li>Open this portal link in Chrome.</li><li>Open the three-dot menu, then choose Install app or Add to Home screen.</li><li>Confirm the name “{name}” and tap Add or Install.</li></> : <><li>Open this portal link in Chrome or Microsoft Edge.</li><li>Choose Install from the address bar, or open the browser menu and look for Install app.</li><li>If installation is unavailable, bookmark this page as “{name}” for quick access.</li></>}
        </ol>
        <p className="text-xs text-slate-500">Your portal shortcut keeps your private access link. Add it only on your own device.</p>
      </DialogContent>
    </Dialog>
  </>;
}
