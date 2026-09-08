import { useState, useEffect, useRef } from 'react';

export function usePWA() {
  const [canInstall, setCanInstall]         = useState(false);
  const [isInstalled, setIsInstalled]       = useState(
    () => window.matchMedia('(display-mode: standalone)').matches ||
          window.navigator.standalone === true
  );
  const [notifPermission, setNotifPermission] = useState(
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const deferredPrompt = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();            // hold the prompt
      deferredPrompt.current = e;    // stash it
      setCanInstall(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setCanInstall(false);
      deferredPrompt.current = null;
    });

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt.current) return false;
    deferredPrompt.current.prompt();
    const { outcome } = await deferredPrompt.current.userChoice;
    deferredPrompt.current = null;
    setCanInstall(false);
    if (outcome === 'accepted') setIsInstalled(true);
    return outcome === 'accepted';
  };

  const requestNotifications = async () => {
    if (!('Notification' in window)) return 'unsupported';
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    return result;
  };

  return { canInstall, isInstalled, promptInstall, notifPermission, requestNotifications };
}
