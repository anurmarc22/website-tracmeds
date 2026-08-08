import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Linking, AppState } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cancelDailyReportReminder } from '@/utils/notifications';

export const PREMIUM_ENTITLEMENT_ID = 'premium';
const STORAGE_KEY = '@tracmeds:isPro';
const SUBSCRIPTION_RECORD_KEY = '@tracmeds:subscriptionRecord';
const DEVICE_ID_KEY = '@tracmeds:deviceId';
// Use the backend-hosted checkout route so the details form, Razorpay callback,
// invoice email, and Google Sheets bookkeeping stay on the same controlled path.
const CHECKOUT_BASE_URL = 'https://checkout.tracmeds.com/checkout';

// Expiry durations — client-side enforcement only.
// NOTE: This is a one-time-charge setup (not recurring billing), so expiry is
// a best-effort local check based on device clock. It is not server-enforced and
// can be bypassed by manipulating the device clock. A future server-side validation
// step (e.g. via Razorpay webhooks + a user account API) could harden this.
const PLAN_DURATION_DAYS: Record<string, number> = {
  annual: 365,
  monthly: 30,
};
const DEFAULT_DURATION_DAYS = 30;

interface SubscriptionRecord {
  plan: string;
  title: string;
  priceString: string;
  status: 'active' | 'pending' | 'cancelled' | 'expired';
  startedAt: string;
  expiresAt: string;    // ISO date string computed at purchase time
  updatedAt: string;
  supportNote: string;
  // Captured off the Razorpay checkout return link so later lifecycle events
  // (renewed/expired) can still identify the customer for device tracking.
  customerEmail?: string;
  customerPhone?: string;
}

// Generates a lightweight per-install identifier (not cryptographically
// strong — this is only used to cap how many devices share one plan, not
// for security). Persisted once so it's stable across app restarts.
function generateDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getOrCreateDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = generateDeviceId();
    await AsyncStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    // Storage failure — fall back to a per-session id rather than blocking the caller.
    return generateDeviceId();
  }
}

const DEFAULT_PACKAGES = [
  {
    identifier: 'annual',
    packageType: 'ANNUAL',
    title: 'Annual',
    description: 'Best value for long-term family sharing.',
    priceString: '₹1299/year',
    raw: { plan: 'annual' },
  },
  {
    identifier: 'monthly',
    packageType: 'MONTHLY',
    title: 'Monthly',
    description: 'Flexible monthly access to family sharing.',
    priceString: '₹149/month',
    raw: { plan: 'monthly' },
  },
] as const;

export interface SubscriptionPackage {
  identifier: string;
  packageType: string;
  title: string;
  description: string;
  priceString: string;
  raw: unknown;
}

interface SubscriptionContextValue {
  isReady: boolean;
  isPro: boolean;
  packages: SubscriptionPackage[];
  loadingOfferings: boolean;
  /** ISO date string of when the current subscription period expires, or null if no active subscription. */
  expiresAt: string | null;
  /** Days remaining in the current subscription period. Negative means expired, null means no subscription. */
  daysRemaining: number | null;
  purchase: (pkg: SubscriptionPackage) => Promise<{ success: boolean; pending?: boolean; error?: string }>;
  restore: (identity: { email?: string; phone?: string }) => Promise<{ success: boolean; error?: string }>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function computeExpiresAt(plan: string, startedAt: Date): string {
  const days = PLAN_DURATION_DAYS[plan.toLowerCase()] ?? DEFAULT_DURATION_DAYS;
  return addDays(startedAt, days).toISOString();
}

function computeDaysRemaining(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const msRemaining = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

function getCheckoutUrl(pkg: SubscriptionPackage) {
  const plan = pkg.identifier.toLowerCase();
  const returnBaseUrl = ExpoLinking.createURL('payment/complete');
  const cancelBaseUrl = ExpoLinking.createURL('payment/cancel');
  const returnUrl = returnBaseUrl;
  const cancelUrl = cancelBaseUrl;
  const cacheBuster = Date.now();
  const resolvedPlan = plan.includes('annual') ? 'annual' : 'monthly';
  return `${CHECKOUT_BASE_URL}?plan=${resolvedPlan}&return_url=${encodeURIComponent(returnUrl)}&cancel_url=${encodeURIComponent(cancelUrl)}&v=${cacheBuster}`;
}

async function saveSubscriptionRecord(
  pkg: SubscriptionPackage,
  status: SubscriptionRecord['status'],
  identity?: { email?: string; phone?: string },
): Promise<SubscriptionRecord> {
  const now = new Date();
  const expiresAt = computeExpiresAt(pkg.identifier, now);
  // Preserve any previously-known email/phone (e.g. from the original purchase)
  // when a later event, like expiry, doesn't carry fresh identity of its own.
  let previousIdentity: { customerEmail?: string; customerPhone?: string } = {};
  try {
    const stored = await AsyncStorage.getItem(SUBSCRIPTION_RECORD_KEY);
    if (stored) {
      const prior: SubscriptionRecord = JSON.parse(stored);
      previousIdentity = { customerEmail: prior.customerEmail, customerPhone: prior.customerPhone };
    }
  } catch { /* ignore — fall back to whatever identity was passed in */ }

  const record: SubscriptionRecord = {
    plan: pkg.identifier,
    title: pkg.title,
    priceString: pkg.priceString,
    status,
    startedAt: now.toISOString(),
    expiresAt,
    updatedAt: now.toISOString(),
    supportNote: 'Family sharing access is managed through the app and can be reviewed for support or refund requests.',
    customerEmail: identity?.email || previousIdentity.customerEmail,
    customerPhone: identity?.phone || previousIdentity.customerPhone,
  };
  await AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(record));
  return record;
}

// Fire-and-forget: log any subscription state change to the server so Google
// Sheets reflects every lifecycle event (new, renewed, expired).
// NOTE: Client-initiated only — this is a one-time-charge setup, not recurring
// billing. The server does not enforce or validate these events; they are purely
// for bookkeeping visibility.
function reportSubscriptionEventToServer(
  record: SubscriptionRecord,
  status: 'active' | 'renewed' | 'expired',
  hadPriorExpiredRecord: boolean,
  userName?: string,
) {
  console.log('[reportSubscriptionEventToServer] called', { status, plan: record.plan, email: record.customerEmail, phone: record.customerPhone });
  try {
    // Fire-and-forget, but still resolve the device id first — the server
    // only writes to the Devices sheet when deviceId AND (email or phone)
    // are present on the request body.
    getOrCreateDeviceId().then((deviceId) => {
      console.log('[reportSubscriptionEventToServer] got deviceId, sending fetch', deviceId);
      fetch('https://website-tracmeds-backend-on-render.onrender.com/api/subscription-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: userName ?? '',
          plan: record.plan,
          purchasedAt: record.startedAt,
          expiresAt: record.expiresAt,
          status,
          // Lets the sheet distinguish a brand-new subscriber from a renewal.
          isRenewal: hadPriorExpiredRecord,
          deviceId,
          email: record.customerEmail,
          phone: record.customerPhone,
        }),
      }).then((res) => {
        console.log('[reportSubscriptionEventToServer] fetch resolved, status:', res.status);
      }).catch((err) => {
        console.log('[reportSubscriptionEventToServer] fetch FAILED:', err?.message || err);
      });
    }).catch((err) => {
      console.log('[reportSubscriptionEventToServer] getOrCreateDeviceId FAILED:', err?.message || err);
    });
  } catch (err) {
    console.log('[reportSubscriptionEventToServer] outer try/catch FAILED:', err);
  }
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [packages] = useState<SubscriptionPackage[]>(DEFAULT_PACKAGES as unknown as SubscriptionPackage[]);
  const [loadingOfferings] = useState(false);

  // On mount: load persisted subscription state and enforce expiry.
  useEffect(() => {
    (async () => {
      try {
        const [storedPro, storedRecord] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(SUBSCRIPTION_RECORD_KEY),
        ]);

        let record: SubscriptionRecord | null = null;
        if (storedRecord) {
          try { record = JSON.parse(storedRecord); } catch { /* corrupted — ignore */ }
        }

        const wasMarkedPro = storedPro === 'true';

        if (wasMarkedPro && record && isExpired(record.expiresAt)) {
          // Subscription period has elapsed — revoke access.
          const updated: SubscriptionRecord = { ...record, status: 'expired', updatedAt: new Date().toISOString() };
          await Promise.all([
            AsyncStorage.setItem(STORAGE_KEY, 'false'),
            AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(updated)),
          ]);
          await cancelDailyReportReminder();
          reportSubscriptionEventToServer(updated, 'expired', false);
          setIsPro(false);
          setExpiresAt(record.expiresAt);   // keep visible so UI can show "expired on…"
        } else {
          // Trust the stored state only if the record has a valid, non-expired expiresAt.
          // If there is no record (old install) fall back to the stored boolean.
          const active = wasMarkedPro && (!record || !isExpired(record?.expiresAt ?? null));
          setIsPro(active);
          setExpiresAt(record?.expiresAt ?? null);
        }
      } catch {
        setIsPro(false);
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  // Listen for Razorpay deep-link callbacks (success / cancel).
  useEffect(() => {
    const handleDeepLink = async (url: string | null) => {
      if (!url) return;
      const normalized = url.toLowerCase();
      let statusParam = '';
      let emailParam: string | undefined;
      let phoneParam: string | undefined;
      let pathname = '';
      try {
        const parsed = new URL(url);
        statusParam = (parsed.searchParams.get('status') || '').toLowerCase();
        emailParam = parsed.searchParams.get('email') || undefined;
        phoneParam = parsed.searchParams.get('phone') || undefined;
        pathname = parsed.pathname.toLowerCase();
      } catch {
        // Ignore parse failures and keep fallback checks below.
      }

      const isCompleteRoute = pathname.includes('/payment/complete') || normalized.includes('payment/complete');
      const isCancelRoute = pathname.includes('/payment/cancel') || normalized.includes('payment/cancel');
      const isSuccess =
        statusParam === 'success' ||
        statusParam === 'paid' ||
        normalized.includes('status=success') ||
        normalized.includes('success') ||
        normalized.includes('paid') ||
        (isCompleteRoute && !isCancelRoute && !['cancel', 'failed'].includes(statusParam));
      const isCancel =
        statusParam === 'cancel' ||
        statusParam === 'failed' ||
        isCancelRoute ||
        normalized.includes('status=cancel') ||
        normalized.includes('status=failed');

      if (isSuccess) {
        try {
          await AsyncStorage.setItem(STORAGE_KEY, 'true');
          const planFromUrl = normalized.includes('annual') ? DEFAULT_PACKAGES[0] : DEFAULT_PACKAGES[1];

          const storedRecord = await AsyncStorage.getItem(SUBSCRIPTION_RECORD_KEY);
          let hadPriorExpiredRecord = false;
          if (storedRecord) {
            try {
              const prior: SubscriptionRecord = JSON.parse(storedRecord);
              hadPriorExpiredRecord = prior.status === 'expired';
            } catch {
              // corrupted — treat as new
            }
          }

          const record = await saveSubscriptionRecord(planFromUrl as SubscriptionPackage, 'active', {
            email: emailParam,
            phone: phoneParam,
          });
          setExpiresAt(record.expiresAt);
          setIsPro(true);

          console.log('[handleDeepLink] about to call reportSubscriptionEventToServer', { emailParam, phoneParam });
          reportSubscriptionEventToServer(
            record,
            hadPriorExpiredRecord ? 'renewed' : 'active',
            hadPriorExpiredRecord,
          );
        } catch {
          // Ignore persistence issues and keep UI state updated.
        }
      } else if (isCancel) {
        try {
          await AsyncStorage.setItem(STORAGE_KEY, 'false');
          const storedRecord = await AsyncStorage.getItem(SUBSCRIPTION_RECORD_KEY);
          if (storedRecord) {
            const rec: SubscriptionRecord = JSON.parse(storedRecord);
            const updated = { ...rec, status: 'cancelled' as const, updatedAt: new Date().toISOString() };
            await AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(updated));
          }
        } catch {
          // Ignore persistence issues.
        }
        setIsPro(false);
      }
    };

    const handleAppStateChange = async (nextState: string) => {
      if (nextState !== 'active') return;
      try {
        const url = await Linking.getInitialURL();
        if (url) {
          await handleDeepLink(url);
        }
      } catch {
        // Ignore resume-time parsing issues.
      }
    };

    Linking.getInitialURL().then(handleDeepLink);
    const subscription = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    const appStateSub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
      appStateSub?.remove();
    };
  }, []);

  // While the app is open, continuously enforce expiry so access is revoked
  // as soon as the plan period lapses (without requiring app restart).
  useEffect(() => {
    if (!isPro || !expiresAt) return;

    const enforceExpiryNow = async () => {
      if (!isExpired(expiresAt)) return;
      try {
        const storedRecord = await AsyncStorage.getItem(SUBSCRIPTION_RECORD_KEY);
        if (storedRecord) {
          try {
            const rec: SubscriptionRecord = JSON.parse(storedRecord);
            const updated: SubscriptionRecord = {
              ...rec,
              status: 'expired',
              updatedAt: new Date().toISOString(),
            };
            await AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(updated));
            reportSubscriptionEventToServer(updated, 'expired', false);
          } catch {
            // corrupted record — continue with revocation
          }
        }
        await AsyncStorage.setItem(STORAGE_KEY, 'false');
        await cancelDailyReportReminder();
      } catch {
        // best-effort persistence
      } finally {
        setIsPro(false);
      }
    };

    // Run immediately and then poll at a low cadence.
    enforceExpiryNow();
    const intervalId = setInterval(enforceExpiryNow, 60 * 1000);
    return () => clearInterval(intervalId);
  }, [isPro, expiresAt]);

  const purchase = useCallback(async (pkg: SubscriptionPackage) => {
    const checkoutUrl = getCheckoutUrl(pkg);
    if (!checkoutUrl) {
      return { success: false, error: 'Razorpay checkout link is not configured yet.' };
    }
    try {
      const supported = await Linking.canOpenURL(checkoutUrl);
      if (!supported) {
        return { success: false, error: 'This device cannot open the Razorpay checkout link.' };
      }
      // Save a pending record now; expiresAt will be finalised when the success deep-link arrives.
      await saveSubscriptionRecord(pkg, 'pending');
      await Linking.openURL(checkoutUrl);
      return { success: true, pending: true };
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Unable to open the Razorpay checkout.' };
    }
  }, []);

  const restore = useCallback(async (identity: { email?: string; phone?: string }) => {
    const email = String(identity?.email || '').trim().toLowerCase();
    const phone = String(identity?.phone || '').trim();
    if (!email || !phone) {
      return { success: false, error: 'Enter both the email and phone used during payment to restore your plan.' };
    }

    try {
      const resp = await fetch('https://website-tracmeds-backend-on-render.onrender.com/api/restore-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        return { success: false, error: data?.error || 'No active plan found for these details.' };
      }

      const restoredPlan = String(data.plan || '').toLowerCase().includes('annual') ? 'annual' : 'monthly';
      const pkg = restoredPlan === 'annual' ? DEFAULT_PACKAGES[0] : DEFAULT_PACKAGES[1];
      const startedAt = data.startedAt || new Date().toISOString();
      const restoredExpiresAt = data.expiresAt || computeExpiresAt(pkg.identifier, new Date(startedAt));

      const record: SubscriptionRecord = {
        plan: pkg.identifier,
        title: pkg.title,
        priceString: pkg.priceString,
        status: 'active',
        startedAt,
        expiresAt: restoredExpiresAt,
        updatedAt: new Date().toISOString(),
        supportNote: 'Family sharing access was restored from a prior verified purchase record.',
      };

      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEY, 'true'),
        AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(record)),
      ]);

      setIsPro(true);
      setExpiresAt(restoredExpiresAt);
      return { success: true };
    } catch {
      return { success: false, error: 'Restore failed. Please try again in a moment.' };
    }
  }, []);

  const daysRemaining = computeDaysRemaining(expiresAt);

  return (
    <SubscriptionContext.Provider value={{ isReady, isPro, packages, loadingOfferings, expiresAt, daysRemaining, purchase, restore }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
