import { api } from './api';

// Web Push: the browser gives us a subscription (an endpoint at Google,
// Apple or Mozilla plus encryption keys), we store it, and the worker sends
// messages to that endpoint. On iPhone this needs iOS 16.4 or later and the
// app added to the home screen.

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// getRegistration() resolves straight away; serviceWorker.ready would wait
// forever if the worker never registered.
async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const existing = await navigator.serviceWorker.getRegistration('/');
  return existing ? existing.pushManager.getSubscription() : null;
}

export async function enablePush(): Promise<void> {
  const { publicKey } = await api.get<{ publicKey: string | null }>('/api/push/public-key');
  if (!publicKey) throw new Error("Push isn't set up on the server yet (VAPID keys are missing).");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
  const subscription = await (await registration()).pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.post('/api/push/subscriptions', subscription.toJSON());
}

export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api.del('/api/push/subscriptions', { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
