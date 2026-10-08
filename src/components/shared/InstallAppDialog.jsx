import React, { useSyncExternalStore } from 'react';
import { Download, Share2, Smartphone, Monitor } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getInstallPlatform, getInstallServerState, getInstallState, requestAppInstall, subscribeInstallState } from '@/lib/installApp';

const INSTALL_STEPS = {
  ios: {
    title: 'Install on iPhone or iPad',
    icon: Share2,
    steps: ['Open FuzedFlow in Safari.', 'Tap the Share button (the square with an up arrow).', 'Scroll down and tap Add to Home Screen.', 'Tap Add.'],
  },
  android: {
    title: 'Install on Android',
    icon: Smartphone,
    steps: ['Open FuzedFlow in Chrome.', 'Tap the three-dot menu.', 'Choose Install app or Add to Home screen.', 'Tap Install.'],
  },
  windows: {
    title: 'Install on Windows',
    icon: Monitor,
    steps: ['Open FuzedFlow in Microsoft Edge or Chrome.', 'Select the Install app icon in the address bar.', 'If it is not shown, open the browser menu and choose Apps or Install FuzedFlow.', 'Confirm Install.'],
  },
  other: {
    title: 'Install FuzedFlow',
    icon: Download,
    steps: ['Open FuzedFlow in your device’s main browser.', 'Open the browser menu.', 'Choose Install app or Add to Home Screen.', 'Confirm the installation.'],
  },
};

export function useInstallApp() {
  const status = useSyncExternalStore(subscribeInstallState, getInstallState, getInstallServerState);
  return {
    status,
    platform: getInstallPlatform(),
    install: requestAppInstall,
  };
}

export default function InstallAppDialog({ open, onOpenChange, platform }) {
  const instructions = INSTALL_STEPS[platform] || INSTALL_STEPS.other;
  const PlatformIcon = instructions.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showAIHelp={false} className="max-w-md rounded-2xl p-6 sm:p-7">
        <DialogHeader className="pr-10 text-left">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <PlatformIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle className="text-xl font-black">{instructions.title}</DialogTitle>
          <DialogDescription className="leading-6 text-slate-600">
            FuzedFlow will open in its own app window and stay available from your Home Screen, Start menu, or desktop.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {instructions.steps.map((step, index) => (
            <li key={step} className="flex gap-3 text-sm leading-6 text-slate-700">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-amber-300">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </DialogContent>
    </Dialog>
  );
}
