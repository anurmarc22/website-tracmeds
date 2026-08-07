// app/payment/complete.tsx
//
// This screen exists purely so Expo Router has somewhere to land when the
// checkout page redirects to `tracmeds://payment/complete`. The actual
// state update (marking the account as Pro, saving the subscription
// record, reporting the event to the server) already happens in
// SubscriptionContext's global `Linking` listener — that fires regardless
// of whether a matching route exists. Without this file, Router falls back
// to its default "Page not found" screen even though the unlock itself
// worked, which is exactly what was showing up.
import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { router } from 'expo-router';

export default function PaymentCompleteScreen() {
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/');
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" />
      <Text style={styles.title}>Payment successful</Text>
      <Text style={styles.subtitle}>Unlocking family sharing…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '600', marginTop: 8 },
  subtitle: { fontSize: 14, color: '#5c6785' },
});
