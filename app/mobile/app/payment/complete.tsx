// app/payment/complete.tsx
//
// This screen exists so Expo Router has somewhere to land when the checkout
// page redirects to `tracmeds://payment/complete`. The actual verification
// and unlock work happens in SubscriptionContext's global `Linking` listener
// (and its background reconciliation effect) — that runs independently of
// this screen and keeps working even after the user navigates away from it.
//
// What changed: unlock is no longer instant. The deep link is only a signal
// to go verify with the server, which can take a few seconds up to a couple
// of minutes if the backend was asleep. So this screen now reflects the
// SubscriptionContext's real state (isVerifyingPayment / isPro /
// verificationFailed) instead of showing "successful" on a fixed timer and
// redirecting home regardless of what actually happened.
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useSubscription } from '@/context/SubscriptionContext';

// Once unlocked (or confirmed failed), give the user a moment to read the
// result before sending them home — but never hold them on this screen
// indefinitely. If verification is still genuinely in progress past this
// point, let them leave anyway; the background check in SubscriptionContext
// keeps retrying and will unlock automatically the next time they open the
// app, so nothing is lost by not waiting here.
const MAX_WAIT_MS = 20000;

export default function PaymentCompleteScreen() {
  const { isPro, isVerifyingPayment, verificationFailed, retryVerification } = useSubscription();
  const [timedOut, setTimedOut] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), MAX_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  // Once unlocked, leave this screen after a short pause so the confirmation
  // is actually readable instead of flashing by.
  useEffect(() => {
    if (!isPro) return;
    const timer = setTimeout(() => router.replace('/'), 1500);
    return () => clearTimeout(timer);
  }, [isPro]);

  if (isPro) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Payment successful</Text>
        <Text style={styles.subtitle}>Family sharing is unlocked.</Text>
      </View>
    );
  }

  if (verificationFailed || timedOut) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Still confirming your payment</Text>
        <Text style={styles.subtitle}>
          This can take a little longer than usual. If you were charged, your plan will
          unlock automatically the next time you open the app — or you can try again now.
        </Text>
        <Pressable
          style={styles.button}
          disabled={retrying}
          onPress={async () => {
            setRetrying(true);
            await retryVerification({});
            setRetrying(false);
          }}
        >
          <Text style={styles.buttonText}>{retrying ? 'Checking…' : 'Try again'}</Text>
        </Pressable>
        <Pressable style={styles.linkButton} onPress={() => router.replace('/')}>
          <Text style={styles.linkButtonText}>Continue to the app</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.title}>Confirming your payment…</Text>
      <Text style={styles.subtitle}>This only takes a moment.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#5c6785', textAlign: 'center' },
  button: {
    marginTop: 12,
    backgroundColor: '#6f4fd8',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  linkButton: { marginTop: 4, padding: 8 },
  linkButtonText: { color: '#6f4fd8', fontSize: 14 },
});
