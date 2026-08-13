import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Platform, Image } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import AppointmentModal from '@/components/AppointmentModal';
import HealthLogModal from '@/components/HealthLogModal';
import MedicineModal from '@/components/MedicineModal';
import { Appointment, HealthLog, MetricType } from '@/types';
import { useSubscription } from '@/context/SubscriptionContext';
import PaywallModal from '@/components/PaywallModal';

// DD/MM/YYYY display
function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function isUpcoming(appt: Appointment): boolean {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [y, mo, d] = appt.date.split('-').map(Number);
  return new Date(y, mo - 1, d) >= today;
}

function getTimePeriod(date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function getGreetingText(name?: string, timePeriod: 'morning' | 'afternoon' | 'evening' = 'morning'): string {
  const baseGreeting = timePeriod === 'morning' ? 'Good morning' : timePeriod === 'afternoon' ? 'Good afternoon' : 'Good evening';
  const trimmedName = name?.trim();
  if (!trimmedName) return `${baseGreeting}!`;
  const firstName = trimmedName.split(/\s+/)[0];
  return `${baseGreeting}, ${firstName}!`;
}

const QUOTE_POOLS: Record<'morning' | 'afternoon' | 'evening', string[]> = {
  morning: [
    'Love is the strongest medicine. It is more powerful than electricity.',
    'You are your own sunshine!',
    'You’ve got this!',
    'This is a beautiful day to take care of yourself!',
    'Small steps still move you forward!',
  ],
  afternoon: [
    'Love is everlasting forgiveness. Wisdom is to see everything in relation to the whole.',
    'Keep shining!',
    'One calm moment at a time!',
    'You are stronger than you think!',
    'Today is a fresh chance to begin again!',
  ],
  evening: [
    'You are doing great!',
    'You deserve kindness today!',
    'Let your heart be light!',
    'Stay hopeful and keep going!',
    'You are growing every day!',
    'Cheer up — you’re doing better than you think!',
    'A little progress is still progress!',
  ],
};

function getQuoteText(timePeriod: 'morning' | 'afternoon' | 'evening' = 'morning', date = new Date()): string {
  const pool = QUOTE_POOLS[timePeriod];
  const index = date.getDate() % pool.length;
  return pool[index];
}

type MetricColorKey = 'bpColor' | 'heartRateColor' | 'sugarColor' | 'menstrualColor' | 'weightColor' | 'tempColor';

const METRIC_META: Record<MetricType, { label: string; icon: string; colorKey: MetricColorKey }> = {
  bp: { label: 'Blood Pressure', icon: 'heart-pulse', colorKey: 'bpColor' },
  heart_rate: { label: 'Heart Rate', icon: 'heart-flash', colorKey: 'heartRateColor' },
  blood_sugar: { label: 'Blood Sugar', icon: 'water', colorKey: 'sugarColor' },
  menstrual: { label: 'Menstrual', icon: 'gender-female', colorKey: 'menstrualColor' },
  exercise: { label: 'Exercise', icon: 'run-fast', colorKey: 'weightColor' },
  weight: { label: 'Weight', icon: 'scale-bathroom', colorKey: 'weightColor' },
  temperature: { label: 'Temperature', icon: 'thermometer', colorKey: 'tempColor' },
};

function getMetricValue(log: HealthLog): string {
  switch (log.type) {
    case 'bp': return log.value1 && log.value2 ? `${log.value1}/${log.value2} mmHg` : '—';
    case 'heart_rate': return log.value1 ? `${log.value1} BPM` : '—';
    case 'blood_sugar': return log.value1 ? `${log.value1} mg/dL${log.label ? ` (${log.label})` : ''}` : '—';
    case 'menstrual': return log.label ?? (log.value1 ? `Day ${log.value1}` : 'Logged');
    case 'exercise': {
    if (!log.value1) return '—';
    const totalMinutes = Math.round(log.value1);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const duration = hours > 0 && minutes > 0 ? `${hours}h ${minutes}m` : hours > 0 ? `${hours}h` : `${minutes}m`;
    return `${duration}${log.label ? ` (${log.label})` : ''}`;
  }
    case 'weight': return log.value1 ? `${log.value1} ${log.label ?? 'kg'}` : '—';
    case 'temperature': return log.value1 ? `${log.value1}${log.label ?? '°C'}` : '—';
  }
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { appointments, healthLogs, medicines, addAppointment, addHealthLog, updateHealthLog, addMedicine, profile } = useApp();
  const { isPro } = useSubscription();
  const [showApptModal, setShowApptModal] = useState(false);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [showMedModal, setShowMedModal] = useState(false);
  const [healthModalDefaultType, setHealthModalDefaultType] = useState<MetricType>('bp');
  const [showPaywall, setShowPaywall] = useState(false);

  const isWeb = Platform.OS === 'web';
  const topPad = isWeb ? 67 : insets.top;

  const upcoming = appointments.filter(isUpcoming).slice(0, 2);
  const nextAppt = upcoming[0];
  const activeMeds = medicines.filter(m => m.active).slice(0, 3);

  const latestByType: Partial<Record<MetricType, HealthLog>> = {};
  for (const log of healthLogs) {
    if (!latestByType[log.type]) latestByType[log.type] = log;
  }
  const summaryMetrics: MetricType[] = ['bp', 'heart_rate', 'blood_sugar', 'menstrual', 'exercise'];

  const timePeriod = getTimePeriod();
  const greetingText = getGreetingText(profile.name, timePeriod);
  const quoteText = getQuoteText(timePeriod);

  const s = makeStyles(colors);

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      <LinearGradient colors={[colors.primary, '#2563EB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
        {/* TracMeds wordmark */}
        <View style={s.brandRow}>
          <Image source={require('../../assets/images/icon.png')} style={s.brandIcon} resizeMode="contain" />
          <Text style={s.brandWord}>TracMeds</Text>
        </View>
        <View style={s.heroTextWrap}>
          <Text style={s.greeting}>{greetingText}</Text>
          <Text style={s.quote}>{quoteText}</Text>
        </View>
        <Text style={s.heroDate}>{new Date().toLocaleDateString('en-GB', { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
        <View style={s.heroStats}>
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{medicines.filter(m => m.active).length}</Text>
            <Text style={s.heroStatLbl}>Active Meds</Text>
          </View>
          <View style={s.heroStatDivider} />
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{appointments.filter(isUpcoming).length}</Text>
            <Text style={s.heroStatLbl}>Upcoming</Text>
          </View>
          <View style={s.heroStatDivider} />
          <View style={s.heroStat}>
            <Text style={s.heroStatVal}>{healthLogs.length}</Text>
            <Text style={s.heroStatLbl}>Readings</Text>
          </View>
        </View>
      </LinearGradient>

      <ScrollView style={s.scroll} contentContainerStyle={[s.scrollContent, { paddingBottom: (isWeb ? 34 : insets.bottom) + 90 }]} showsVerticalScrollIndicator={false}>

        {/* Quick actions */}
        <View style={s.quickRow}>
          <TouchableOpacity style={[s.quickBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '30' }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowMedModal(true); }}>
            <View style={[s.quickBtnIcon, { backgroundColor: colors.medicineColor }]}>
              <Ionicons name="add" size={18} color="#fff" />
            </View>
            <Text style={[s.quickBtnText, { color: colors.primary }]}>Add Medicine</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.quickBtn, { backgroundColor: colors.accent + '15', borderColor: colors.accent + '30' }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowApptModal(true); }}>
            <View style={[s.quickBtnIcon, { backgroundColor: colors.accent }]}>
              <Ionicons name="calendar-outline" size={18} color="#fff" />
            </View>
            <Text style={[s.quickBtnText, { color: colors.foreground }]}>Appointment</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.quickBtn, { backgroundColor: colors.bpColor + '12', borderColor: colors.bpColor + '25' }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setHealthModalDefaultType('bp'); setShowHealthModal(true); }}>
            <View style={[s.quickBtnIcon, { backgroundColor: colors.bpColor }]}>
              <Ionicons name="pulse" size={18} color="#fff" />
            </View>
            <Text style={[s.quickBtnText, { color: colors.bpColor }]}>Health Log</Text>
          </TouchableOpacity>
        </View>

        {/* Family Sharing CTA */}
        {!isPro && (
          <TouchableOpacity style={s.familyBanner} activeOpacity={0.9}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowPaywall(true); }}>
            <LinearGradient colors={[colors.primary, '#2563EB']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.familyBannerGradient}>
              <View style={s.familyBannerIcon}>
                <Ionicons name="people" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.familyBannerTitle}>Unlock Family Sharing</Text>
                <Text style={s.familyBannerSub}>Share health updates & reports with loved ones</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Active medicines */}
        {activeMeds.length > 0 && (
          <>
            <Text style={s.sectionTitle}>Active Medicines</Text>
            {activeMeds.map(med => (
              <View key={med.id} style={s.medCard}>
                <View style={[s.medDot, { backgroundColor: colors.medicineColor }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.medName}>{med.name}</Text>
                  <Text style={s.medSub}>{med.dosage} {med.unit} · {med.frequency.replace('_', ' ')}</Text>
                </View>
                {med.times.length > 0 && (
                  <View style={[s.timePill, { backgroundColor: colors.medicineColor + '18' }]}>
                    <Ionicons name="time-outline" size={12} color={colors.medicineColor} />
                    <Text style={[s.timePillText, { color: colors.medicineColor }]}>{formatTime(med.times[0])}</Text>
                  </View>
                )}
              </View>
            ))}
          </>
        )}

        {/* Next appointment */}
        <Text style={s.sectionTitle}>Next Appointment</Text>
        {nextAppt ? (
          <View style={s.apptCard}>
            <View style={[s.apptBar, { backgroundColor: nextAppt.type === 'doctor' ? colors.doctorColor : colors.diagnosticColor }]} />
            <View style={s.apptBody}>
              <View style={s.apptRow}>
                <View style={[s.apptIcon, { backgroundColor: (nextAppt.type === 'doctor' ? colors.doctorColor : colors.diagnosticColor) + '18' }]}>
                  <Ionicons name={nextAppt.type === 'doctor' ? 'medkit-outline' : 'flask-outline'} size={20}
                    color={nextAppt.type === 'doctor' ? colors.doctorColor : colors.diagnosticColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.apptTitle} numberOfLines={1}>{nextAppt.title}</Text>
                  {nextAppt.specialty && <Text style={s.apptSub}>{nextAppt.specialty}</Text>}
                  {nextAppt.facility && !nextAppt.specialty && <Text style={s.apptSub}>{nextAppt.facility}</Text>}
                </View>
              </View>
              <View style={s.apptPills}>
                <View style={s.pill}><Ionicons name="calendar-outline" size={12} color={colors.mutedForeground} /><Text style={s.pillText}>{formatDate(nextAppt.date)}</Text></View>
                <View style={s.pill}><Ionicons name="time-outline" size={12} color={colors.mutedForeground} /><Text style={s.pillText}>{formatTime(nextAppt.time)}</Text></View>
              </View>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={s.emptyCard} onPress={() => setShowApptModal(true)}>
            <Ionicons name="calendar-outline" size={26} color={colors.mutedForeground} />
            <Text style={s.emptyText}>No upcoming appointments</Text>
            <Text style={[s.emptyLink, { color: colors.primary }]}>Schedule one</Text>
          </TouchableOpacity>
        )}

        {/* Health summary */}
        <Text style={s.sectionTitle}>Latest Readings</Text>
        <View style={s.metricsGrid}>
          {summaryMetrics.map(key => {
            const meta = METRIC_META[key];
            const log = latestByType[key];
            const mColor = colors[meta.colorKey];
            return (
              <TouchableOpacity key={key} style={s.metricCard} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setHealthModalDefaultType(key); setShowHealthModal(true); }} activeOpacity={0.85}>
                <View style={[s.metricIcon, { backgroundColor: mColor + '18' }]}>
                  <MaterialCommunityIcons name={meta.icon as any} size={20} color={mColor} />
                </View>
                <Text style={s.metricLabel}>{meta.label}</Text>
                {log ? (
                  <Text style={[s.metricValue, { color: mColor }]}>{getMetricValue(log)}</Text>
                ) : (
                  <Text style={s.metricEmpty}>No data</Text>
                )}
                {log && <Text style={s.metricDate}>{formatDate(log.date)}</Text>}
                {key === 'exercise' && log ? (
                  <TouchableOpacity
                    style={[s.metricToggle, { backgroundColor: log.completed ? colors.success : colors.muted }]}
                    onPress={(event) => {
                      event.stopPropagation();
                      updateHealthLog(log.id, { completed: !Boolean(log.completed) });
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.metricToggleText, { color: log.completed ? '#fff' : colors.foreground }]}>{log.completed ? 'Done' : 'Not done'}</Text>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <AppointmentModal visible={showApptModal} onClose={() => setShowApptModal(false)} onSave={addAppointment} />
      <HealthLogModal visible={showHealthModal} defaultType={healthModalDefaultType} onClose={() => setShowHealthModal(false)} onSave={addHealthLog} />
      <MedicineModal visible={showMedModal} onClose={() => setShowMedModal(false)} onSave={addMedicine} />
      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} onUnlocked={() => setShowPaywall(false)} />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    hero: {
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.24,
      shadowRadius: 14,
      elevation: 5,
    },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    brandIcon: { width: 18, height: 18, borderRadius: 4, flexShrink: 0 },
    brandWord: { fontSize: 14, fontFamily: 'Inter_700Bold', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.8, textTransform: 'uppercase' },
    heroTextWrap: { width: '100%', marginBottom: 10 },
    greeting: { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#fff', marginBottom: 4, maxWidth: '100%' },
    quote: { fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.85)', lineHeight: 18, maxWidth: '100%' },
    heroDate: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.7)', marginBottom: 16 },
    heroStats: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 14 },
    heroStat: { flex: 1, alignItems: 'center' },
    heroStatVal: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff' },
    heroStatLbl: { fontSize: 11, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.75)', marginTop: 2 },
    heroStatDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 8 },
    scroll: { flex: 1 },
    scrollContent: { padding: 20, gap: 10 },
    sectionTitle: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.mutedForeground, letterSpacing: 1, textTransform: 'uppercase', marginTop: 6 },
    quickRow: { flexDirection: 'row', gap: 10 },
    quickBtn: { flex: 1, alignItems: 'center', gap: 8, padding: 14, borderRadius: 16, borderWidth: 1 },
    quickBtnIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    quickBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
    familyBanner: { borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 3 },
    familyBannerGradient: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
    familyBannerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
    familyBannerTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
    familyBannerSub: { fontSize: 11, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.85)', marginTop: 2 },
    medCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 14, padding: 14, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
    medDot: { width: 10, height: 10, borderRadius: 5 },
    medName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
    medSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 },
    timePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
    timePillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
    apptCard: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
    apptBar: { width: 5 },
    apptBody: { flex: 1, padding: 14 },
    apptRow: { flexDirection: 'row', gap: 12, marginBottom: 10 },
    apptIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    apptTitle: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.foreground },
    apptSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 },
    apptPills: { flexDirection: 'row', gap: 8 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.muted, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
    pillText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
    emptyCard: { backgroundColor: colors.card, borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 },
    emptyText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
    emptyLink: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
    metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    metricCard: { width: '47%', backgroundColor: colors.card, borderRadius: 16, padding: 14, gap: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
    metricIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
    metricLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
    metricValue: { fontSize: 15, fontFamily: 'Inter_700Bold' },
    metricEmpty: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
    metricDate: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
    metricToggle: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, alignSelf: 'center' },
    metricToggleText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  });
}
