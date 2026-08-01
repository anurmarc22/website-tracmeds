import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const PREMIUM_ENTITLEMENT_ID = 'premium';
const STORAGE_KEY = '@tracmeds:isPro';
const SUBSCRIPTION_RECORD_KEY = '@tracmeds:subscriptionRecord';
const RAZORPAY_RETURN_URL = 'tracmeds://payment/complete';
const RAZORPAY_CANCEL_URL = 'tracmeds://payment/cancel';

interface SubscriptionRecord {
  plan: string;
  title: string;
  priceString: string;
  status: 'active' | 'pending' | 'cancelled';
  startedAt: string;
  updatedAt: string;
  supportNote: string;
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
  purchase: (pkg: SubscriptionPackage) => Promise<{ success: boolean; pending?: boolean; error?: string }>;
  restore: () => Promise<{ success: boolean; error?: string }>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | undefined>(undefined);

function getCheckoutUrl(pkg: SubscriptionPackage) {
  const plan = pkg.identifier.toLowerCase();
  // Hosted payment page that opens the Razorpay Standard Checkout and returns to the app
  // Replace with your production hosted payment page URL (we've added website-razorpay/index.html)
  const baseUrl = 'https://www.tracmeds.com/razorpay';
  if (plan.includes('annual')) return `${baseUrl}?plan=annual&return_url=${encodeURIComponent(RAZORPAY_RETURN_URL)}&cancel_url=${encodeURIComponent(RAZORPAY_CANCEL_URL)}`;
  if (plan.includes('month')) return `${baseUrl}?plan=monthly&return_url=${encodeURIComponent(RAZORPAY_RETURN_URL)}&cancel_url=${encodeURIComponent(RAZORPAY_CANCEL_URL)}`;
  return `${baseUrl}?plan=monthly&return_url=${encodeURIComponent(RAZORPAY_RETURN_URL)}&cancel_url=${encodeURIComponent(RAZORPAY_CANCEL_URL)}`;
}

async function saveSubscriptionRecord(pkg: SubscriptionPackage, status: SubscriptionRecord['status']) {
  const record: SubscriptionRecord = {
    plan: pkg.identifier,
    title: pkg.title,
    priceString: pkg.priceString,
    status,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    supportNote: 'Family sharing access is managed through the app and can be reviewed for support or refund requests.',
  };
  await AsyncStorage.setItem(SUBSCRIPTION_RECORD_KEY, JSON.stringify(record));
}

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [isPro, setIsPro] = useState(false);
  const [packages] = useState<SubscriptionPackage[]>(DEFAULT_PACKAGES as unknown as SubscriptionPackage[]);
  const [loadingOfferings] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        setIsPro(stored === 'true');
      } catch {
        setIsPro(false);
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    const handleDeepLink = async (url: string | null) => {
      if (!url) return;
      const normalized = url.toLowerCase();
      if (normalized.includes('success') || normalized.includes('paid')) {
        try {
          await AsyncStorage.setItem(STORAGE_KEY, 'true');
          const current = DEFAULT_PACKAGES[0];
          await saveSubscriptionRecord(current as SubscriptionPackage, 'active');
          setIsPro(true);
        } catch {
          // Ignore persistence issues and keep the UI state updated.
        }
      } else if (normalized.includes('cancel')) {
        try {
          await AsyncStorage.setItem(STORAGE_KEY, 'false');
          const current = DEFAULT_PACKAGES[0];
          await saveSubscriptionRecord(current as SubscriptionPackage, 'cancelled');
        } catch {
          // Ignore persistence issues and keep the UI state updated.
        }
        setIsPro(false);
      }
    };

    Linking.getInitialURL().then(handleDeepLink);
    const subscription = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    return () => subscription.remove();
  }, []);

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

      await saveSubscriptionRecord(pkg, 'pending');
      await Linking.openURL(checkoutUrl);
      return { success: true, pending: true };
    } catch (e: any) {
      return { success: false, error: e?.message ?? 'Unable to open the Razorpay checkout.' };
    }
  }, []);

  const restore = useCallback(async () => {
    return { success: false, error: 'Restore is not available for Razorpay yet. Please contact support.' };
  }, []);

  return (
    <SubscriptionContext.Provider value={{ isReady, isPro, packages, loadingOfferings, purchase, restore }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
