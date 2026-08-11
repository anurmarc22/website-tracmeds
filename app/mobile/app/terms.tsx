import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';

const EFFECTIVE_DATE = 'August 11, 2026';
const APP_NAME = 'Tracmeds';
const OWNER = 'the Tracmeds owner and developer';

export default function TermsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { acceptTerms } = useApp();
  const router = useRouter();
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  const isWeb = Platform.OS === 'web';
  const topPad = isWeb ? 67 : insets.top;
  const bottomPad = isWeb ? 34 : insets.bottom;
  const s = makeStyles(colors);

  const handleScroll = useCallback((event: any) => {
    if (hasReachedEnd) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (distanceFromBottom <= 24) {
      setHasReachedEnd(true);
    }
  }, [hasReachedEnd]);

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      <LinearGradient colors={[colors.primary, '#2563EB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        <View style={s.iconWrap}>
          <Image source={require('../assets/images/icon.png')} style={s.heroIcon} resizeMode="contain" />
        </View>
        <Text style={s.appName}>{APP_NAME}</Text>
        <Text style={s.tagline}>Terms of Use & Privacy Policy</Text>
        <Text style={s.effectiveDate}>Effective: {EFFECTIVE_DATE}</Text>
      </LinearGradient>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: bottomPad + 24 }]}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >

        {/* ── WELCOME ── */}
        <Text style={s.heading}>Welcome to {APP_NAME}</Text>
        <Text style={s.body}>
          {APP_NAME} is a personal health-tracking application that helps you manage medicines, appointments, and health readings. By tapping "I Agree & Get Started" below, you confirm that you have read, understood, and agree to be bound by these Terms of Use and Privacy Policy in their entirety.
        </Text>
        <Text style={s.body}>
          If you do not agree with any part of these terms, please do not use this application.
        </Text>
        <Text style={[s.body, s.warning]}>
          Once the Family Sharing Unlock feature has been purchased and made available to you, it is non-refundable. Refunds will not be issued after activation or access has been granted.
        </Text>

        {/* ── 1. ACCEPTANCE ── */}
        <Text style={s.sectionNum}>1. Acceptance of Terms</Text>
        <Text style={s.body}>
          Your access to and use of {APP_NAME} is conditioned on your acceptance of and compliance with these Terms. These Terms apply to all users of the application. By using {APP_NAME} you agree to these Terms. Use of the application by minors must be supervised by a parent or legal guardian who accepts these Terms on the minor's behalf.
        </Text>

        {/* ── 2. MEDICAL DISCLAIMER ── */}
        <Text style={s.sectionNum}>2. Medical Disclaimer — Not Medical Advice</Text>
        <Text style={[s.body, s.warning]}>
          ⚠️  IMPORTANT: {APP_NAME} IS NOT A MEDICAL DEVICE, MEDICAL SERVICE, OR PROVIDER OF MEDICAL ADVICE.
        </Text>
        <Text style={s.body}>
          All content, data entry fields, reminders, and information provided within the application are intended solely for personal organisational and tracking purposes. Nothing in {APP_NAME} constitutes, replaces, or should be construed as professional medical advice, clinical diagnosis, treatment recommendation, prescription guidance, or emergency medical assistance.
        </Text>
        <Text style={s.body}>
          Always consult a licensed and qualified healthcare professional before making any decision related to your health, medications, dosage, or treatment plan. In a medical emergency, contact your local emergency services immediately.
        </Text>

        {/* ── 3. LIMITATION OF LIABILITY ── */}
        <Text style={s.sectionNum}>3. Limitation of Liability & Disclaimer of Warranties</Text>
        <Text style={s.body}>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW:
        </Text>
        {[
          `${APP_NAME}, ${OWNER}, their affiliates, licensors, employees, agents, contractors, and any person associated with the development, distribution, or maintenance of ${APP_NAME} shall not be liable for any direct, indirect, incidental, special, consequential, exemplary, punitive, or any other damages of any kind.`,
          'This limitation applies regardless of the cause of action — whether in contract, tort (including negligence), strict liability, or otherwise — even if advised of the possibility of such damages.',
          'Excluded damages include but are not limited to: loss of life or personal injury, missed medications or dosage errors, incorrect health readings or data entry, missed or delayed medical appointments, reliance on app-generated reminders that failed to trigger, WhatsApp message delivery failures or unintended disclosures, loss of data due to device failure or app error, and any other health, financial, or consequential losses.',
          `${APP_NAME} is provided "AS IS" and "AS AVAILABLE" without warranties of any kind, either express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, accuracy, reliability, or non-infringement.`,
          `${OWNER} does not warrant that the application will be uninterrupted, error-free, secure, or free of viruses or other harmful components.`,
        ].map((item, i) => (
          <View key={i} style={s.bulletRow}>
            <View style={[s.bullet, { backgroundColor: colors.primary }]} />
            <Text style={s.bulletText}>{item}</Text>
          </View>
        ))}

        {/* ── 4. USER RESPONSIBILITIES ── */}
        <Text style={s.sectionNum}>4. User Responsibilities</Text>
        <Text style={s.body}>You are solely responsible for:</Text>
        {[
          'The accuracy and completeness of all health data, medication details, dosages, and appointment information you enter into the application.',
          'Verifying all medication names, dosages, schedules, and reminders with your licensed healthcare provider before acting on them.',
          'Ensuring that WhatsApp sharing features are used only with contacts who have consented to receive health-related messages from you.',
          'Compliance with all applicable local laws and regulations regarding health information sharing.',
          'Maintaining the security and confidentiality of your device on which the application is installed.',
          'Not using the application as your sole system for critical medication management without a redundant professional oversight mechanism in place.',
        ].map((item, i) => (
          <View key={i} style={s.bulletRow}>
            <View style={[s.bullet, { backgroundColor: colors.primary }]} />
            <Text style={s.bulletText}>{item}</Text>
          </View>
        ))}

        {/* ── 5. INDEMNIFICATION ── */}
        <Text style={s.sectionNum}>5. Indemnification</Text>
        <Text style={s.body}>
          You agree to indemnify, defend, and hold harmless {OWNER}, their affiliates, agents, employees, contractors, and any associated parties from and against any and all claims, liabilities, damages, losses, costs, expenses, or fees (including reasonable legal fees) arising from: (a) your use of or inability to use {APP_NAME}; (b) your violation of these Terms; (c) your violation of any rights of a third party; or (d) any data you enter, share, or transmit through the application.
        </Text>

        {/* ── 6. PRIVACY ── */}
        <Text style={s.sectionNum}>6. Privacy Policy — Data Storage & Sharing</Text>
        <Text style={s.body}>
          {APP_NAME} is designed with your privacy as the highest priority:
        </Text>
        <Text style={s.body}>
          Where premium family-sharing features are purchased, the app may keep a local record of the selected plan, status, and purchase timestamp on your device to support access review and renewals. Separately, at checkout we collect your name, phone number, and email for every purchase — required to process payment, generate your invoice, verify your access, and enable "Restore Purchase" on a new or reinstalled device. If you request a GST invoice, we additionally collect your GSTIN. We also record your device identifier against your purchase to enforce the reinstall limit described in Section 6.1. This billing information is stored with the payment record on Razorpay and/or in a secure internal record — it is not sold or shared with third parties for marketing purposes.
        </Text>
        {[
          'All health data — medicines, appointments, health readings, contact lists — is stored exclusively on your device using local storage (AsyncStorage). No health data is transmitted to any server, database, or third-party service.',
          `${APP_NAME} does not collect, store, process, or have access to your health information — that stays exclusively on your device. Billing information described above is handled separately, as part of processing your payment.`,
          'No analytics, crash reporting, advertising identifiers, or tracking technologies are embedded in the application.',
          'WhatsApp sharing is entirely user-initiated. Tapping a share button opens WhatsApp on your device with a pre-filled message. The message is sent by you via your own WhatsApp account. The app owner has no visibility into, control over, or responsibility for any WhatsApp messages you send.',
          'Contact information you store in the app (for WhatsApp sharing) remains solely on your device and is never uploaded or shared with the app developer.',
        ].map((item, i) => (
          <View key={i} style={s.bulletRow}>
            <View style={[s.bullet, { backgroundColor: colors.primary }]} />
            <Text style={s.bulletText}>{item}</Text>
          </View>
        ))}

        <Text style={s.sectionNum}>6.1 Device Changes and Reinstallation</Text>
        <Text style={s.body}>
          If you reinstall the app or switch to a new phone during an active subscription period, your subscription can be restored on the new device at no extra cost — provided you use the same registered email and phone number. This restoration is limited to 3 devices per subscription. Once you have used all 3 restorations, any further device change or reinstallation — even within your current subscription period — will require purchasing a new plan. We recommend exporting your readings/data before reinstalling or switching devices, as a precaution.
        </Text>

        {/* ── 7. WHATSAPP ── */}
        <Text style={s.sectionNum}>7. WhatsApp Sharing Features</Text>
        <Text style={s.body}>
          {APP_NAME} uses the WhatsApp deep-link feature to open WhatsApp with pre-composed messages. By using this feature you acknowledge that: (a) WhatsApp is a separate third-party application governed by Meta's own Terms of Service and Privacy Policy; (b) {APP_NAME} is not affiliated with, endorsed by, or in partnership with WhatsApp or Meta Platforms Inc.; (c) you are solely responsible for any health information you choose to share via WhatsApp; (d) the app owner bears no liability for messages sent, received, or exposed through WhatsApp.
        </Text>

        {/* ── 8. NOTIFICATIONS ── */}
        <Text style={s.sectionNum}>8. Notification Reminders</Text>
        <Text style={s.body}>
          Medication and appointment reminders within {APP_NAME} are convenience features only. They do not constitute a guaranteed system and may fail to trigger due to device settings, battery-saving modes, operating system restrictions, or other technical factors. You must NOT rely exclusively on {APP_NAME} reminders for critical medication adherence. The app owner accepts no liability for missed medications resulting from notification failures.
        </Text>

        {/* ── 9. INTELLECTUAL PROPERTY ── */}
        <Text style={s.sectionNum}>9. Intellectual Property</Text>
        <Text style={s.body}>
          {APP_NAME} and all its content, features, branding, icons, and functionality are owned by {OWNER} and are protected by applicable intellectual property laws. You are granted a limited, non-exclusive, non-transferable, revocable licence to use the application for your personal, non-commercial health-tracking purposes only.
        </Text>

        {/* ── 10. PROHIBITED USES ── */}
        <Text style={s.sectionNum}>10. Prohibited Uses</Text>
        <Text style={s.body}>You agree NOT to:</Text>
        {[
          'Use the application for any unlawful purpose or in violation of any applicable law.',
          'Use the application for any unfair, illegal, anti-security, or otherwise prohibited activity, whether under local, national, or international law.',
          'Reverse-engineer, decompile, or attempt to extract the source code of the application.',
          'Use the application to transmit unsolicited messages or spam via WhatsApp.',
          'Impersonate any person or misrepresent your affiliation with any entity.',
          'Use the application for commercial purposes without written permission from the owner.',
        ].map((item, i) => (
          <View key={i} style={s.bulletRow}>
            <View style={[s.bullet, { backgroundColor: colors.primary }]} />
            <Text style={s.bulletText}>{item}</Text>
          </View>
        ))}

        {/* ── 11. LEGAL USE & LIABILITY ── */}
        <Text style={s.sectionNum}>11. Legal Use, Waiver, and Limitation of Responsibility</Text>
        <Text style={s.body}>
          The application is provided solely for lawful, personal, non-commercial, and non-harmful use. You shall not use {APP_NAME}, any affiliated services, or any related functionality for any unlawful, unfair, fraudulent, anti-security, deceptive, harmful, or otherwise prohibited purpose. Any use that violates applicable law, regulation, public policy, or cybersecurity standards is strictly prohibited.
        </Text>
        <Text style={s.body}>
          You agree that you are solely and fully responsible for any legal, regulatory, civil, criminal, administrative, or other consequences arising from your use or misuse of {APP_NAME} or any affiliated service. {OWNER}, the app developer, the app owner, and all persons related to the creation, operation, distribution, or support of {APP_NAME} shall not be liable for any claim, action, demand, penalty, fine, loss, damage, expense, or proceeding arising from your conduct or from any unlawful, improper, or prohibited use of the application.
        </Text>
        <Text style={s.body}>
          To the fullest extent permitted by law, {OWNER}, the app developer, the app owner, and any related party are expressly waived and released from any liability, responsibility, or obligation in connection with any legal process, claim, complaint, investigation, demand, or enforcement action arising out of, related to, or connected with your use of {APP_NAME} or associated services.
        </Text>

        {/* ── 12. GOVERNING LAW ── */}
        <Text style={s.sectionNum}>12. Governing Law & Dispute Resolution</Text>
        <Text style={s.body}>
          These Terms shall be governed by and construed in accordance with the laws of the jurisdiction in which the app owner is located, without regard to its conflict of law provisions. Any disputes arising under these Terms shall first be attempted to be resolved through good-faith negotiation. If unresolved, disputes shall be submitted to binding arbitration before a mutually agreed arbitrator, with each party bearing its own costs.
        </Text>

        {/* ── 13. CHANGES ── */}
        <Text style={s.sectionNum}>13. Changes to These Terms</Text>
        <Text style={s.body}>
          {OWNER} reserves the right to modify these Terms at any time. Updated Terms will be presented within the application upon next launch. Your continued use of {APP_NAME} after any changes constitutes your acceptance of the revised Terms.
        </Text>

        {/* ── 14. TERMINATION ── */}
        <Text style={s.sectionNum}>14. Termination</Text>
        <Text style={s.body}>
          You may stop using {APP_NAME} at any time by uninstalling it from your device. Since all data is stored locally on your device, uninstalling the app will permanently delete all your data. {OWNER} reserves the right to discontinue the application at any time without notice.
        </Text>

        {/* ── 15. SEVERABILITY ── */}
        <Text style={s.sectionNum}>15. Severability & Entire Agreement</Text>
        <Text style={s.body}>
          If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary, and the remaining provisions shall continue in full force and effect. These Terms, together with the Privacy Policy contained herein, constitute the entire agreement between you and {OWNER} regarding the use of {APP_NAME}.
        </Text>

        {/* ── 16. CONTACT ── */}
        <Text style={s.sectionNum}>16. Contact</Text>
        <Text style={s.body}>
          For any questions or concerns about these Terms, please contact the app owner via the contact information provided on the {APP_NAME} website or through the applicable app store listing.
        </Text>

        {/* ── ACKNOWLEDGEMENT ── */}
        <View style={s.ackBox}>
          <Text style={s.ackText}>
            By tapping the button below you confirm that you have read and fully understood these Terms of Use and Privacy Policy, and you agree to be legally bound by them. If you are agreeing on behalf of a minor, you confirm you are their parent or legal guardian.
          </Text>
        </View>

        <TouchableOpacity
          style={[s.acceptBtn, !hasReachedEnd && s.acceptBtnDisabled]}
          disabled={!hasReachedEnd}
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            acceptTerms();
            router.replace('/(tabs)');
          }}
          activeOpacity={0.85}
        >
          <Text style={s.acceptBtnText}>{hasReachedEnd ? 'I Agree & Get Started' : 'Scroll to the end to continue'}</Text>
        </TouchableOpacity>

        <Text style={s.footer}>Effective Date: {EFFECTIVE_DATE} · Version 1.1</Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hero: { paddingVertical: 32, alignItems: 'center', gap: 6 },
    iconWrap: { width: 90, height: 90, borderRadius: 45, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 4, overflow: 'hidden' },
    heroIcon: { width: 70, height: 70, borderRadius: 20 },
    appName: { fontSize: 30, fontFamily: 'Inter_700Bold', color: '#fff' },
    tagline: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: 'rgba(255,255,255,0.9)' },
    effectiveDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.7)' },
    scroll: { flex: 1 },
    content: { padding: 20, gap: 10 },
    heading: { fontSize: 20, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 2 },
    sectionNum: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.primary, marginTop: 12 },
    body: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 21 },
    warning: { color: '#B45309', fontFamily: 'Inter_600SemiBold', backgroundColor: '#FEF3C7', padding: 10, borderRadius: 8, lineHeight: 20 },
    bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingLeft: 4 },
    bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 8, flexShrink: 0 },
    bulletText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, lineHeight: 21 },
    ackBox: { backgroundColor: colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
    ackText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.foreground, lineHeight: 20, textAlign: 'center' },
    acceptBtn: { backgroundColor: colors.primary, borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
    acceptBtnDisabled: { opacity: 0.55 },
    acceptBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
    footer: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', marginTop: 8 },
  });
}
