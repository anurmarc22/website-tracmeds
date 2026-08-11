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
// Single source of truth for the backend base URL — was previously repeated
// as a literal string at every fetch() call site.
const SERVER_BASE = 'https://website-tracmeds-backend-on-render.onrender.com';

// How long to keep retrying the post-payment verification check before giving
// up and asking the user to retry manually. Render's free-tier instance can
// take 50+ seconds to wake from sleep, so this deliberately spans a couple of
// minutes with growing gaps between attempts, rather than a few quick tries.
const VERIFY_RETRY_DELAYS_MS = [0, 3000, 6000, 10000, 15000, 20000, 25000, 30000, 30000];

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
  status: 'active' | 'pending' | 'cancelled' | 'expired' | 'refunded';
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
  purchase: (pkg: SubscriptionPackage, identity?: { email?: string; phone?: string; name?: string }) => Promise<{ success: boolean; pending?: boolean; error?: string }>;
  restore: (identity: { email?: string; phone?: string }) => Promise<{ success: boolean; error?: string }>;
  /** True while the app is actively confirming a just-completed payment with the server. Show a "Confirming your payment…" state while this is true — do not treat app-reopen alone as success. */
  isVerifyingPayment: boolean;
  /** Set when a payment's deep-link fired but the server could not confirm it after retrying (e.g. backend was down, not just slow). Prompt the user to use "Restore purchase" with the email/phone they paid with. */
  verificationFailed: boolean;
  /** Manually re-run the same server verification used after a payment deep-link. Same underlying check as `restore`, exposed under a clearer name for a "We couldn't confirm your payment — retry" UI. */
  retryVerification: (identity: { email?: string; phone?: string }) => Promise<{ success: boolean; error?: string }>;
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

function getCheckoutUrl(pkg: SubscriptionPackage, identity?: { email?: string; phone?: string; name?: string }) {
  const plan = pkg.identifier.toLowerCase();
  const returnBaseUrl = ExpoLinking.createURL('payment/complete');
  const cancelBaseUrl = ExpoLinking.createURL('payment/cancel');
  const returnUrl = returnBaseUrl;
  const cancelUrl = cancelBaseUrl;
  const cacheBuster = Date.now();
  const resolvedPlan = plan.includes('annual') ? 'annual' : 'monthly';
  let url = `${CHECKOUT_BASE_URL}?plan=${resolvedPlan}&return_url=${encodeURIComponent(returnUrl)}&cancel_url=${encodeURIComponent(cancelUrl)}&v=${cacheBuster}`;
  // Prefills the web checkout form so a returning customer doesn't have to
  // retype their details — and, just as importantly, means the app already
  // has this identity saved locally BEFORE the browser ever opens, instead
  // of only learning it from the fragile deep-link return trip.
  if (identity?.name) url += `&customer_name=${encodeURIComponent(identity.name)}`;
  if (identity?.email) url += `&customer_email=${encodeURIComponent(identity.email)}`;
  if (identity?.phone) url += `&customer_phone=${encodeURIComponent(identity.phone)}`;
  return url;
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
      fetch(`${SERVER_BASE}/api/subscription-event`, {
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

// The ONLY thing allowed to unlock Family Sharing. A deep link claiming
// "success" is treated purely as a signal to go ask the server — never as
// proof by itself. This calls the read-only /api/subscription-status route
// (same one the refund-check effect below already uses), which only ever
// returns active:true for a row that exists because a Razorpay signature was
// already verified server-side in /api/payment-callback or /api/verify-payment.
//
// Retries with backoff because the backend can be asleep (Render free tier)
// right when the customer's payment completes — a single failed attempt must
// not be read as "payment didn't happen".
async function verifySubscriptionActive(
  email?: string,
  phone?: string,
): Promise<{ confirmed: boolean; active?: boolean; refunded?: boolean; plan?: string; expiresAt?: string }> {
  if (!email || !phone) {
    return { confirmed: false };
  }

  for (let i = 0; i < VERIFY_RETRY_DELAYS_MS.length; i++) {
    const delay = VERIFY_RETRY_DELAYS_MS[i];
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      const resp = await fetch(`${SERVER_BASE}/api/subscription-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone }),
      });
      if (!resp.ok) continue; // likely still waking up — try the next delay
      const data = await resp.json().catch(() => null);
      if (!data || data.success !== true) continue;
      if (!data.found) {
        // Server is awake and reachable, but has no record of this payment
        // yet — the Sheets write may still be a few seconds behind the
        // redirect. Keep retrying rather than treating this as a final "no".
        continue;
      }
      return {
        confirmed: true,
        active: Boolean(data.active),
        refunded: Boolean(data.refunded),
        plan: data.plan,
        expiresAt: data.expiresAt,
      };
    } catch {
      // Network error / server still asleep — fall through to the next retry.
    }
  }

  return { confirmed: false };
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [packages] = useState<SubscriptionPackage[]>(DEFAULT_PACKAGES as unknown as SubscriptionPackage[]);
  const [loadingOfferings] = useState(false);
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [verificationFailed, setVerificationFailed] = useState(false);

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
      let planParam: string | undefined;
      let pathname = '';
      try {
        const parsed = new URL(url);
        statusParam = (parsed.searchParams.get('status') || '').toLowerCase();
        emailParam = parsed.searchParams.get('email') || undefined;
        phoneParam = parsed.searchParams.get('phone') || undefined;
        planParam = (parsed.searchParams.get('plan') || '').toLowerCase() || undefined;
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
        // IMPORTANT: the deep link itself is only a signal to go verify —
        // it is never treated as proof of payment on its own. Family Sharing
        // unlocks only if the server confirms an active, signature-verified
        // record for this email/phone. This closes two risks at once: a real
        // customer whose deep link fires but whose payment somehow didn't
        // verify won't get a false unlock, and a real customer who paid but
        // hit a sleeping/slow server (the callback never completing, or the
        // Sheets write lagging a few seconds behind) still gets unlocked once
        // the retries catch up, instead of being silently left locked out.
        try {
          // Trust the explicit `plan` param the checkout page sends back;
          // fall back to a substring check only for older app builds hitting
          // a not-yet-updated checkout page.
          const resolvedPlanId = planParam === 'annual' || planParam === 'monthly'
            ? planParam
            : (normalized.includes('annual') ? 'annual' : 'monthly');
          const planFromUrl = DEFAULT_PACKAGES.find((p) => p.identifier === resolvedPlanId) ?? DEFAULT_PACKAGES[1];

          const storedRecord = await AsyncStorage.getItem(SUBSCRIPTION_RECORD_KEY);
          let hadPriorExpiredRecord = false;
          let priorEmail: string | undefined;
          let priorPhone: string | undefined;
          if (storedRecord) {
            try {
              const prior: SubscriptionRecord = JSON.parse(storedRecord);
              hadPriorExpiredRecord = prior.status === 'expired';
              priorEmail = prior.customerEmail;
              priorPhone = prior.customerPhone;
            } catch {
              // corrupted — treat as new
            }
          }

          // Keep the record in "pending" state (already set by purchase())
          // and show a "confirming payment" state in the UI while we verify —
          // do NOT flip isPro to true yet.
          setIsVerifyingPayment(true);
          setVerificationFailed(false);

          const verifyEmail = emailParam || priorEmail;
          const verifyPhone = phoneParam || priorPhone;
          const result = await verifySubscriptionActive(verifyEmail, verifyPhone);

          if (result.confirmed && result.active && !result.refunded) {
            const resolvedPlan = result.plan === 'annual' || result.plan === 'monthly' ? result.plan : resolvedPlanId;
            const planToSave = DEFAULT_PACKAGES.find((p) => p.identifier === resolvedPlan) ?? planFromUrl;
            const record = await saveSubscriptionRecord(planToSave as SubscriptionPackage, 'active', {
              email: verifyEmail,
              phone: verifyPhone,
            });
            // Prefer the server's own expiry over the client-computed one, since
            // the server is the source of truth for when the plan started.
            const finalRecord: SubscriptionRecord = result.expiresAt
              ? { ...record, expiresAt: result.expiresAt }
              : record;
            if (result.expiresAt) {
              await AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(finalRecord));
            }
            await AsyncStorage.setItem(STORAGE_KEY, 'true');
            setExpiresAt(finalRecord.expiresAt);
            setIsPro(true);
            setIsVerifyingPayment(false);

            console.log('[handleDeepLink] verified, about to call reportSubscriptionEventToServer', { verifyEmail, verifyPhone });
            reportSubscriptionEventToServer(
              finalRecord,
              hadPriorExpiredRecord ? 'renewed' : 'active',
              hadPriorExpiredRecord,
            );
          } else {
            // Either the server explicitly said this isn't active/is refunded,
            // or every retry failed to reach it. Either way: stay locked. The
            // pending record stays on disk so "Restore purchase" (same
            // underlying check) can recover it once the server is reachable.
            setIsVerifyingPayment(false);
            setVerificationFailed(true);
            console.log('[handleDeepLink] could not confirm payment — leaving Family Sharing locked', { verifyEmail, verifyPhone, result });
          }
        } catch {
          setIsVerifyingPayment(false);
          setVerificationFailed(true);
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

  // Automatic unlock that does NOT depend on the deep-link handoff at all.
  // Requirement: once Razorpay has received the money, the customer's app
  // must unlock Family Sharing on its own — regardless of whether the
  // checkout browser's redirect back into the app ever fires. The deep link
  // is just one *fast path* to that; this is the guaranteed path.
  //
  // How: `purchase()` now saves customerEmail/customerPhone into the local
  // "pending" record BEFORE the browser even opens (see getCheckoutUrl /
  // purchase above), not only after a successful return trip. So as long as
  // a pending purchase is sitting on this device, the app can independently
  // ask the server "did this ever get paid?" on its own — every time it's
  // opened, and on a background timer while it's open — with zero action
  // from the customer. The very next time they open the app after paying,
  // even if the deep link failed outright, this confirms and unlocks it.
  useEffect(() => {
    if (!isReady) return;

    let cancelled = false;

    const reconcilePendingPurchase = async () => {
      try {
        const storedRecord = await AsyncStorage.getItem(SUBSCRIPTION_RECORD_KEY);
        if (!storedRecord) return;
        const rec: SubscriptionRecord = JSON.parse(storedRecord);
        if (rec.status !== 'pending') return; // already resolved (active/expired/refunded) — nothing to reconcile
        if (!rec.customerEmail || !rec.customerPhone) return; // nothing to check the server with

        // Give up auto-polling a checkout that was opened and never completed
        // more than 7 days ago (abandoned cart), so this doesn't poll forever.
        // The customer can still use "Restore purchase" manually at any time.
        const ageMs = Date.now() - new Date(rec.startedAt).getTime();
        if (ageMs > 7 * 24 * 60 * 60 * 1000) return;

        const resp = await fetch(`${SERVER_BASE}/api/subscription-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: rec.customerEmail, phone: rec.customerPhone }),
        });
        if (!resp.ok) return; // server likely still waking up — the next tick/foreground will catch it
        const data = await resp.json().catch(() => null);
        if (!data || data.success !== true || !data.found) return;
        if (cancelled) return;

        if (data.refunded) {
          const updated: SubscriptionRecord = { ...rec, status: 'refunded', updatedAt: new Date().toISOString() };
          await AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(updated));
          return;
        }
        if (data.active) {
          const updated: SubscriptionRecord = {
            ...rec,
            status: 'active',
            expiresAt: data.expiresAt || rec.expiresAt,
            updatedAt: new Date().toISOString(),
          };
          await AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(updated));
          await AsyncStorage.setItem(STORAGE_KEY, 'true');
          setExpiresAt(updated.expiresAt);
          setIsPro(true);
          setIsVerifyingPayment(false);
          setVerificationFailed(false);
        }
        // If found but not active and not refunded (e.g. expired instantly, or
        // some other server-side state), leave it as pending — nothing to do.
      } catch {
        // Offline or request failed — the next tick/foreground will retry.
      }
    };

    reconcilePendingPurchase();
    // Frequent enough to feel instant to the customer on their next open,
    // without hammering the server while the app just happens to be open.
    const intervalId = setInterval(reconcilePendingPurchase, 45 * 1000);
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') reconcilePendingPurchase();
    });

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      appStateSub?.remove();
    };
  }, [isReady]);

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

  // Local expiry enforcement (above) only catches the natural end of a plan
  // period — it can't catch a refund issued mid-subscription, since nothing
  // else in the app ever talks to the server after purchase/restore. This
  // closes that gap: check in with the server on app foreground and on a
  // background timer, and revoke access immediately if the server says this
  // customer's latest purchase was refunded.
  useEffect(() => {
    if (!isPro) return;

    const checkRefundStatus = async () => {
      try {
        const storedRecord = await AsyncStorage.getItem(SUBSCRIPTION_RECORD_KEY);
        if (!storedRecord) return;
        const rec: SubscriptionRecord = JSON.parse(storedRecord);
        if (!rec.customerEmail || !rec.customerPhone) return;

        const resp = await fetch(`${SERVER_BASE}/api/subscription-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: rec.customerEmail, phone: rec.customerPhone }),
        });
        if (!resp.ok) return; // network/server issue — fail open, don't revoke on an incomplete check
        const data = await resp.json();

        if (data?.refunded) {
          const updated: SubscriptionRecord = { ...rec, status: 'refunded', updatedAt: new Date().toISOString() };
          await AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(updated));
          await AsyncStorage.setItem(STORAGE_KEY, 'false');
          await cancelDailyReportReminder();
          setIsPro(false);
        }
      } catch {
        // Offline or request failed — fail open. The next successful check
        // (foreground or timer) will catch a genuine refund.
      }
    };

    checkRefundStatus();
    const statusIntervalId = setInterval(checkRefundStatus, 15 * 60 * 1000);
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') checkRefundStatus();
    });

    return () => {
      clearInterval(statusIntervalId);
      appStateSub?.remove();
    };
  }, [isPro]);

  const purchase = useCallback(async (pkg: SubscriptionPackage, identity?: { email?: string; phone?: string; name?: string }) => {
    const checkoutUrl = getCheckoutUrl(pkg, identity);
    if (!checkoutUrl) {
      return { success: false, error: 'Razorpay checkout link is not configured yet.' };
    }
    try {
      const supported = await Linking.canOpenURL(checkoutUrl);
      if (!supported) {
        return { success: false, error: 'This device cannot open the Razorpay checkout link.' };
      }
      // Save a pending record now, WITH identity if we already have it (e.g.
      // a returning customer, or one who entered it in-app). This is what
      // lets the background reconciliation check below confirm and unlock
      // the purchase automatically later even if the deep-link return trip
      // from checkout never fires — expiresAt is finalised once verified.
      await saveSubscriptionRecord(pkg, 'pending', identity);
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
      // Include deviceId so the server can enforce the 3-device restore cap
      // (evaluateDeviceAccessPolicy) — without this the cap was silently skipped.
      const deviceId = await getOrCreateDeviceId();
      const resp = await fetch(`${SERVER_BASE}/api/restore-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone, deviceId }),
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

  // Same server check as the deep-link path above, exposed for a "We
  // couldn't confirm your payment — retry" button so a customer isn't stuck
  // waiting on a deep link that already failed once. Reuses `restore`, which
  // does the identical active/refunded check plus device registration —
  // there's no need for a second, parallel code path. Falls back to the
  // email/phone already saved locally (from purchase() or an earlier deep
  // link) when the caller doesn't have them handy — e.g. a generic "Try
  // again" button on the payment-complete screen shouldn't need to ask the
  // customer to retype what they already entered once.
  const retryVerification = useCallback(async (identity: { email?: string; phone?: string }) => {
    setVerificationFailed(false);
    let email = identity?.email;
    let phone = identity?.phone;
    if (!email || !phone) {
      try {
        const storedRecord = await AsyncStorage.getItem(SUBSCRIPTION_RECORD_KEY);
        if (storedRecord) {
          const rec: SubscriptionRecord = JSON.parse(storedRecord);
          email = email || rec.customerEmail;
          phone = phone || rec.customerPhone;
        }
      } catch {
        // fall through — restore() will report the missing-identity error
      }
    }
    const result = await restore({ email, phone });
    if (!result.success) {
      setVerificationFailed(true);
    }
    return result;
  }, [restore]);

  const daysRemaining = computeDaysRemaining(expiresAt);

  return (
    <SubscriptionContext.Provider value={{ isReady, isPro, packages, loadingOfferings, expiresAt, daysRemaining, purchase, restore, isVerifyingPayment, verificationFailed, retryVerification }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
