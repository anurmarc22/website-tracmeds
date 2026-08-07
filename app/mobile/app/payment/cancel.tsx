// app/payment/cancel.tsx
//
// Same reasoning as complete.tsx — gives Router a real screen to land on
// for `tracmeds://payment/cancel` instead of falling back to the default
// "Page not found" screen.
import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { router } from 'expo-router';

export default function PaymentCancelScreen() {
  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/');
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Payment not completed</Text>
      <Text style={styles.subtitle}>Taking you back…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  subtitle: { fontSize: 14, color: '#5c6785' },
});
