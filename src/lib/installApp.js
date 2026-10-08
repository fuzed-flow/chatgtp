let deferredInstallPrompt = null;
const installStateListeners = new Set();

const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);

const notifyInstallState = () => installStateListeners.forEach(listener => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    notifyInstallState();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    notifyInstallState();
  });

  const displayMode = window.matchMedia('(display-mode: standalone)');
  displayMode.addEventListener?.('change', notifyInstallState);
}

export const subscribeInstallState = listener => {
  installStateListeners.add(listener);
  return () => installStateListeners.delete(listener);
};

export const getInstallState = () => {
  if (isStandalone()) return 'installed';
  return deferredInstallPrompt ? 'ready' : 'manual';
};

export const getInstallServerState = () => 'manual';

export async function requestAppInstall() {
  if (!deferredInstallPrompt) return { outcome: 'unavailable' };
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  notifyInstallState();
  await prompt.prompt();
  return prompt.userChoice;
}

export function getInstallPlatform() {
  if (typeof navigator === 'undefined') return 'other';
  const userAgent = navigator.userAgent || '';
  const isAppleMobile = /iPad|iPhone|iPod/.test(userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isAppleMobile) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows/i.test(userAgent)) return 'windows';
  return 'other';
}

export async function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register('/notification-worker.js', { scope: '/' });
  } catch (error) {
    console.warn('FuzedFlow app installation is unavailable:', error);
    return null;
  }
}
