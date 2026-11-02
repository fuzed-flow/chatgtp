import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Download, Monitor, Share2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getInstallPlatform, getInstallServerState, getScopedInstallState, requestAppInstall, subscribeInstallState } from '@/lib/installApp';
import { applyPortalInstallMetadata, companyPortalInitials, portalDesktopShortcut, portalInstallMetadata } from '@/lib/portalInstall';

const STEPS = {
  ios: ['Open this private portal link in Safari.', 'Tap Share (the square with an up arrow), then Add to Home Screen.', 'Keep the name “Client Portal” and tap Add.'],
  android: ['Open this private portal link in Chrome.', 'Open the three-dot menu and choose Install app or Add to Home screen.', 'Keep the name “Client Portal” and confirm.'],
  windows: ['Open this portal in Chrome or Microsoft Edge.', 'Use the Install app icon in the address bar, or choose Install app from the browser menu.', 'Confirm “Client Portal”. You can also download a desktop link below.'],
  mac: ['Open this portal in Safari or Chrome.', 'In Safari choose File → Add to Dock. In Chrome use Install app from the browser menu.', 'Keep the name “Client Portal” and confirm.'],
  other: ['Open this portal in your device’s main browser.', 'Choose Install app, Create shortcut or Add to Home Screen from the browser menu.', 'Keep the name “Client Portal” and confirm.'],
};

function PortalCompanyIcon({ metadata, className = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [metadata.iconUrl]);
  return <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}>
    {failed
      ? <span className="text-xl font-black text-slate-900" aria-label={`${metadata.companyName} company icon`}>{companyPortalInitials(metadata.companyName)}</span>
      : <img src={metadata.iconUrl} alt={`${metadata.companyName} logo`} width="64" height="64" className="h-full w-full object-contain" onError={() => setFailed(true)} />}
  </span>;
}

export default function PortalInstallCard({ clientId, company }) {
  const href = window.location.href;
  const metadata = useMemo(() => {
    try { return portalInstallMetadata({ href, clientId, company }); }
    catch { return null; }
  }, [href, clientId, company]);
  const snapshot = useCallback(() => metadata ? getScopedInstallState(metadata.manifestUrl) : 'manual', [metadata]);
  const status = useSyncExternalStore(subscribeInstallState, snapshot, getInstallServerState);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const detectedPlatform = getInstallPlatform();
  const platform = detectedPlatform === 'other' && /Mac/i.test(navigator.platform || '') ? 'mac' : detectedPlatform;
  const mobile = platform === 'ios' || platform === 'android';
  const PlatformIcon = platform === 'ios' ? Share2 : mobile ? Smartphone : Monitor;

  useEffect(() => metadata ? applyPortalInstallMetadata(document, metadata) : undefined, [metadata]);

  if (!metadata) return null;

  const install = async () => {
    setOpen(true);
    setError('');
    if (status !== 'ready' || installing) return;
    setInstalling(true);
    try {
      const result = await requestAppInstall(metadata.manifestUrl);
      if (result?.outcome === 'accepted') setNotice('Your browser is adding Client Portal to this device.');
    } catch {
      setError('Use the browser steps below to add Client Portal.');
    } finally { setInstalling(false); }
  };

  const download = () => {
    try {
      const shortcut = portalDesktopShortcut({ href, metadata, platform });
      const blob = new Blob([shortcut.content], { type: shortcut.type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = shortcut.name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Desktop link downloaded. Move “Client Portal” from Downloads to your desktop.');
      setError('');
    } catch { setError('The link could not be downloaded. Use the browser installation steps above.'); }
  };

  return <>
    <section aria-labelledby="portal-install-heading" className="mb-6 flex flex-col gap-4 rounded-2xl border-2 border-amber-300 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <PortalCompanyIcon metadata={metadata} className="h-14 w-14 sm:h-16 sm:w-16" />
        <div className="min-w-0">
          <p className="break-words text-xs font-bold uppercase tracking-wide text-slate-600">{metadata.companyName}</p>
          <h2 id="portal-install-heading" className="text-xl font-black text-slate-950">Client Portal</h2>
          <p className="mt-1 text-sm leading-5 text-slate-600">Add to your desktop or home screen for easy access.</p>
        </div>
      </div>
      <Button onClick={install} disabled={installing} className="min-h-12 w-full shrink-0 gap-2 whitespace-normal bg-amber-400 px-5 font-bold text-slate-950 hover:bg-amber-500 focus-visible:ring-slate-950 sm:w-auto">
        <Download className="h-5 w-5 shrink-0" aria-hidden="true" />{installing ? 'Opening installation…' : 'Download Client Portal'}
      </Button>
    </section>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showAIHelp={false} className="max-h-[90dvh] max-w-md overflow-y-auto rounded-2xl p-5 sm:p-6">
        <DialogHeader className="pr-7 text-left">
          <div className="mb-3 flex items-center gap-3"><PortalCompanyIcon metadata={metadata} className="h-16 w-16" /><div className="min-w-0"><p className="break-words text-xs font-semibold text-slate-600">{metadata.companyName}</p><DialogTitle className="text-xl font-black">Client Portal</DialogTitle></div></div>
          <DialogDescription className="leading-6">Save this portal to your {mobile ? 'home screen' : 'desktop or app list'}. The shortcut keeps your private portal link.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm font-bold text-slate-900"><PlatformIcon className="h-5 w-5" aria-hidden="true" />{mobile ? 'Add to home screen' : 'Add to your desktop'}</div>
        <ol className="space-y-3">{(STEPS[platform] || STEPS.other).map((step, index) => <li key={step} className="flex gap-3 text-sm leading-6 text-slate-700"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{index + 1}</span><span>{step}</span></li>)}</ol>
        {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
        <div className="flex flex-col gap-2">
          {status === 'ready' && <Button disabled={installing} onClick={install} className="min-h-11 bg-amber-400 font-bold text-slate-950 hover:bg-amber-500">Install Client Portal</Button>}
          {!mobile && <Button variant="outline" onClick={download} className="min-h-11 gap-2"><Download className="h-4 w-4" aria-hidden="true" />Download desktop link</Button>}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
