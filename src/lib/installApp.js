let deferredInstallPrompt = null;
let deferredManifestUrl = null;
const installStateListeners = new Set();

const isStandalone = () => typeof window !== 'undefined'
  && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);

const notifyInstallState = () => installStateListeners.forEach(listener => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    deferredManifestUrl = document.querySelector('link[rel="manifest"]')?.href || null;
    notifyInstallState();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    deferredManifestUrl = null;
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
  const manifestUrl = typeof document !== 'undefined' ? document.querySelector('link[rel="manifest"]')?.href : null;
  return deferredInstallPrompt && deferredManifestUrl === manifestUrl ? 'ready' : 'manual';
};

export const getInstallServerState = () => 'manual';

export const getScopedInstallState = manifestUrl => {
  const expected = typeof window !== 'undefined' ? new URL(manifestUrl, window.location.href).href : null;
  return deferredInstallPrompt && deferredManifestUrl === expected ? 'ready' : 'manual';
};

export async function requestAppInstall(manifestUrl) {
  const expected = manifestUrl || (typeof document !== 'undefined' ? document.querySelector('link[rel="manifest"]')?.href : null);
  if (expected && getScopedInstallState(expected) !== 'ready') return { outcome: 'unavailable' };
  if (!deferredInstallPrompt) return { outcome: 'unavailable' };
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  deferredManifestUrl = null;
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
