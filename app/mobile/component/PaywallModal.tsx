import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, ScrollView, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { useSubscription, SubscriptionPackage } from '@/context/SubscriptionContext';

interface Props {
  visible: boolean;
  onClose: () => void;
  onUnlocked: () => void;
}

function packageLabel(pkg: SubscriptionPackage): string {
  switch (pkg.packageType) {
    case 'MONTHLY': return 'Monthly';
    case 'ANNUAL': return 'Annual';
    default: return pkg.title;
  }
}

export default function PaywallModal({ visible, onClose, onUnlocked }: Props) {
  const colors = useColors();
  const { packages, loadingOfferings, purchase, restore } = useSubscription();
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreEmail, setRestoreEmail] = useState('');
  const [restorePhone, setRestorePhone] = useState('');
  // Collected BEFORE checkout opens (not just from the return trip afterward).
  // This is what lets the app auto-unlock reliably even if the browser's
  // redirect back into the app fails — SubscriptionContext keeps checking the
  // server for this exact email/phone in the background until it's confirmed.
  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');

  const s = makeStyles(colors);

  const handlePurchase = async (pkg: SubscriptionPackage) => {
    const email = buyerEmail.trim();
    const phone = buyerPhone.trim();
    if (!email || !phone) {
      Alert.alert(
        'Email and phone required',
        'Enter your email and phone before checkout — this is what lets family sharing unlock automatically once payment goes through, even if you don\u2019t get redirected back to the app.'
      );
      return;
    }
    setPurchasingId(pkg.identifier);
    const result = await purchase(pkg, { name: buyerName.trim() || undefined, email, phone });
    setPurchasingId(null);
    if (result.success && !result.pending) {
      onUnlocked();
    } else if (result.pending) {
      Alert.alert('Razorpay checkout opened', 'Complete the payment in your browser. Family sharing will unlock automatically once it\u2019s confirmed \u2014 you don\u2019t need to do anything else.');
    } else if (result.error) {
      Alert.alert('Checkout Failed', result.error);
    }
  };

  const handleRestore = async () => {
    if (!restoreEmail.trim() || !restorePhone.trim()) {
      Alert.alert('Restore details needed', 'Enter both the email and phone used during purchase.');
      return;
    }
    setRestoring(true);
    const result = await restore({ email: restoreEmail, phone: restorePhone });
    setRestoring(false);
    if (result.success) {
      onUnlocked();
      Alert.alert('Restored', 'Your active family sharing plan has been restored.');
    } else if (result.error) {
      Alert.alert('Restore Failed', result.error);
    } else {
      Alert.alert('No active plan found', 'No matching active purchase was found for the email and phone you entered.');
    }
  };

  // Sort so Annual (best value) shows first, then Monthly
  const order = ['ANNUAL', 'MONTHLY'];
  const sorted = [...packages].sort((a, b) => order.indexOf(a.packageType) - order.indexOf(b.packageType));
  const recommendedPlan = sorted.find(pkg => pkg.packageType === 'ANNUAL') ?? sorted[0];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Unlock family sharing</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <Text style={s.subtitle}>
            Download TracMeds first. After installation, continue to Razorpay checkout
            to unlock the Daily Family Report for automatic end-of-day WhatsApp summaries.
          </Text>

          <View style={s.buyerCard}>
            <Text style={s.buyerTitle}>Your details</Text>
            <Text style={s.buyerHint}>Used to confirm your payment and unlock automatically — even if you don't get redirected back here.</Text>
            <TextInput
              value={buyerName}
              onChangeText={setBuyerName}
              placeholder="Name (optional)"
              placeholderTextColor={colors.mutedForeground}
              style={s.restoreInput}
            />
            <TextInput
              value={buyerEmail}
              onChangeText={setBuyerEmail}
              placeholder="Email"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              keyboardType="email-address"
              style={s.restoreInput}
            />
            <TextInput
              value={buyerPhone}
              onChangeText={setBuyerPhone}
              placeholder="Phone"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
              style={s.restoreInput}
            />
          </View>

          {loadingOfferings ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
          ) : sorted.length === 0 ? (
            <Text style={s.empty}>
              No plans available right now. Configure your Razorpay checkout links in the subscription flow.
            </Text>
          ) : (
            <>
              <ScrollView style={{ maxHeight: 320 }}>
                {sorted.map(pkg => (
                  <TouchableOpacity
                    key={pkg.identifier}
                    style={[s.planCard, pkg.packageType === 'ANNUAL' && s.planCardAnnual]}
                    onPress={() => handlePurchase(pkg)}
                    disabled={purchasingId !== null}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={s.planHeaderRow}>
                        <Text style={s.planLabel}>{packageLabel(pkg)}</Text>
                        {pkg.packageType === 'ANNUAL' && (
                          <View style={s.badge}><Text style={s.badgeText}>BEST VALUE</Text></View>
                        )}
                      </View>
                      <Text style={s.planPrice}>{pkg.priceString}</Text>
                    </View>
                    {purchasingId === pkg.identifier ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (
                      <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TouchableOpacity
                style={s.ctaWrap}
                onPress={() => recommendedPlan && handlePurchase(recommendedPlan)}
                disabled={purchasingId !== null || !recommendedPlan}
                activeOpacity={0.9}
              >
                <LinearGradient colors={[colors.primary, '#2563EB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.ctaBtn}>
                  {purchasingId === recommendedPlan?.identifier ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={s.ctaText}>Unlock Family Sharing</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}

          <View style={s.restoreCard}>
            <Text style={s.restoreTitle}>Restore access on a new phone or after reinstall</Text>
            <Text style={s.restoreHint}>If your plan is still active, you can restore it by entering the exact email and phone used for the payment.</Text>
            <TextInput
              value={restoreEmail}
              onChangeText={setRestoreEmail}
              placeholder="Email used during payment"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              keyboardType="email-address"
              style={s.restoreInput}
            />
            <TextInput
              value={restorePhone}
              onChangeText={setRestorePhone}
              placeholder="Phone used during payment"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="phone-pad"
              style={s.restoreInput}
            />
          </View>

          <TouchableOpacity style={s.restoreBtn} onPress={handleRestore} disabled={restoring}>
            {restoring ? (
              <ActivityIndicator color={colors.mutedForeground} />
            ) : (
              <Text style={s.restoreText}>Restore Family Unlock</Text>
            )}
          </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36, maxHeight: '92%' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    title: { fontSize: 19, fontFamily: 'Inter_700Bold', color: colors.foreground },
    subtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 20, marginBottom: 20 },
    empty: { fontSize: 14, color: colors.mutedForeground, textAlign: 'center', marginVertical: 24 },
    buyerCard: {
      marginBottom: 16,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    buyerTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
    buyerHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 16 },
    planCard: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: colors.background, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 3,
    },
    planCardAnnual: { borderColor: colors.primary, borderWidth: 2 },
    planHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    planLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.foreground },
    planPrice: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.mutedForeground, marginTop: 2 },
    badge: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
    badgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
    ctaWrap: {
      marginTop: 8,
      borderRadius: 14,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.26,
      shadowRadius: 14,
      elevation: 5,
    },
    ctaBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
    ctaText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#fff' },
    restoreCard: {
      marginTop: 14,
      padding: 12,
      borderRadius: 12,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
      gap: 8,
    },
    restoreTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
    restoreHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 16 },
    restoreInput: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 13,
      color: colors.foreground,
      fontFamily: 'Inter_400Regular',
      backgroundColor: colors.card,
    },
    restoreBtn: { alignItems: 'center', marginTop: 8, paddingVertical: 10 },
    restoreText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, textDecorationLine: 'underline' },
  });
}
