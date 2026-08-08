import React, { useState, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, Platform, ScrollView, Modal, TextInput,
  Image,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Share } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import HealthLogModal from '@/components/HealthLogModal';
import DailyReportToggle from '@/components/DailyReportToggle';
import SimpleDatePicker from '@/components/SimpleDatePicker';
import { HealthLog, MetricType } from '@/types';

type Filter = 'all' | MetricType;
type MetricColorKey = 'bpColor' | 'heartRateColor' | 'sugarColor' | 'menstrualColor' | 'weightColor' | 'tempColor';
interface MetricMeta { label: string; icon: string; colorKey: MetricColorKey; unit: string; }

const METRIC_META: Record<MetricType, MetricMeta> = {
  bp: { label: 'Blood Pressure', icon: 'heart-pulse', colorKey: 'bpColor', unit: 'mmHg' },
  heart_rate: { label: 'Heart Rate', icon: 'heart-flash', colorKey: 'heartRateColor', unit: 'BPM' },
  blood_sugar: { label: 'Blood Sugar', icon: 'water', colorKey: 'sugarColor', unit: 'mg/dL' },
  menstrual: { label: 'Menstrual Cycle', icon: 'gender-female', colorKey: 'menstrualColor', unit: '' },
  exercise: { label: 'Exercise', icon: 'run-fast', colorKey: 'weightColor', unit: 'min' },
  weight: { label: 'Weight', icon: 'scale-bathroom', colorKey: 'weightColor', unit: '' },
  temperature: { label: 'Temperature', icon: 'thermometer', colorKey: 'tempColor', unit: '' },
};

const MAIN_METRICS: MetricType[] = ['exercise', 'bp', 'heart_rate', 'blood_sugar', 'menstrual'];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'exercise', label: 'Exercise' },
  { key: 'bp', label: 'BP' },
  { key: 'heart_rate', label: 'Heart Rate' },
  { key: 'blood_sugar', label: 'Sugar' },
  { key: 'menstrual', label: 'Cycle' },
  { key: 'weight', label: 'Weight' },
  { key: 'temperature', label: 'Temp' },
];

function getDisplayValue(log: HealthLog): string {
  switch (log.type) {
    case 'bp': return log.value1 && log.value2 ? `${log.value1}/${log.value2}` : '—';
    case 'heart_rate': return log.value1 ? `${log.value1}` : '—';
    case 'blood_sugar': return log.value1 ? `${log.value1}` : '—';
    case 'menstrual': return log.label ?? (log.value1 ? `Day ${log.value1}` : 'Logged');
    case 'exercise': {
      if (!log.value1) return '—';
      const totalMinutes = Math.round(log.value1);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      if (hours > 0 && minutes === 0) return `${hours} hr`;
      if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
      return `${minutes} min`;
    }
    case 'weight': return log.value1 ? `${log.value1}` : '—';
    case 'temperature': return log.value1 ? `${log.value1}` : '—';
    default: return '—';
  }
}

function getUnit(log: HealthLog): string {
  switch (log.type) {
    case 'bp': return 'mmHg';
    case 'heart_rate': return 'BPM';
    case 'blood_sugar': return 'mg/dL';
    case 'exercise': return '';
    case 'weight': return log.label ?? 'kg';
    case 'temperature': return log.label ?? '°C';
    default: return '';
  }
}

// DD/MM/YYYY display
function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

// 24h HH:MM → 12h AM/PM
function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function LogCard({ log, colors, onDelete, onShare }: {
  log: HealthLog; colors: ReturnType<typeof useColors>; onDelete: () => void; onShare: () => void;
}) {
  const meta = METRIC_META[log.type];
  const mColor = colors[meta.colorKey];
  const s = logCardStyles(colors);
  return (
    <View style={s.card}>
      <View style={[s.bar, { backgroundColor: mColor }]} />
      <View style={s.body}>
        <View style={s.row}>
          <View style={[s.iconWrap, { backgroundColor: mColor + '18' }]}>
            <MaterialCommunityIcons name={meta.icon as any} size={20} color={mColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.metricLabel}>{meta.label}</Text>
            <View style={s.valueRow}>
              <Text style={[s.value, { color: mColor }]}>{getDisplayValue(log)}</Text>
              {getUnit(log) ? <Text style={s.unit}>{getUnit(log)}</Text> : null}
            </View>
          </View>
          <View style={s.rightCol}>
            {/* Date & time stacked */}
            <View style={s.datetimeCol}>
              <Text style={s.date}>{formatDate(log.date)}</Text>
              {log.time ? <Text style={s.time}>{formatTime(log.time)}</Text> : null}
            </View>
            <View style={s.rowActions}>
              <TouchableOpacity onPress={onShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
              </TouchableOpacity>
              <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="trash-outline" size={17} color={colors.destructive} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
        {log.notes ? <Text style={s.notes} numberOfLines={2}>{log.notes}</Text> : null}
        {log.type === 'exercise' && (
          <View style={s.statusRow}>
            <View style={[s.statusPill, { backgroundColor: log.completed === true ? '#DCFCE7' : log.completed === false ? '#FEE2E2' : '#E5E7EB' }]}>
              <Text style={[s.statusText, { color: log.completed === true ? '#166534' : log.completed === false ? '#991B1B' : '#374151' }]}>
                {log.completed === true ? 'Done' : log.completed === false ? 'Not done' : 'Status not set'}
              </Text>
            </View>
          </View>
        )}
        {log.type === 'blood_sugar' && log.label ? (
          <View style={s.tagRow}><View style={[s.tag, { backgroundColor: mColor + '18' }]}><Text style={[s.tagText, { color: mColor }]}>{log.label}</Text></View></View>
        ) : null}
        {log.type === 'heart_rate' && log.label ? (
          <View style={s.tagRow}><View style={[s.tag, { backgroundColor: mColor + '18' }]}><Text style={[s.tagText, { color: mColor }]}>{log.label}</Text></View></View>
        ) : null}
        {log.type === 'exercise' && log.label ? (
          <View style={s.tagRow}><View style={[s.tag, { backgroundColor: mColor + '18' }]}><Text style={[s.tagText, { color: mColor }]}>{log.label}</Text></View></View>
        ) : null}
        {log.type === 'menstrual' && log.value1 ? (
          <View style={s.tagRow}><View style={[s.tag, { backgroundColor: mColor + '18' }]}><Text style={[s.tagText, { color: mColor }]}>Day {log.value1}</Text></View></View>
        ) : null}
      </View>
    </View>
  );
}

function logCardStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16, marginBottom: 10, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
    bar: { width: 5 },
    body: { flex: 1, padding: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    iconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    metricLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.5 },
    valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 2 },
    value: { fontSize: 22, fontFamily: 'Inter_700Bold' },
    unit: { fontSize: 13, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
    rightCol: { alignItems: 'flex-end', gap: 6 },
    datetimeCol: { alignItems: 'flex-end', gap: 2 },
    rowActions: { flexDirection: 'row', gap: 10 },
    date: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
    time: { fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
    notes: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 8, fontStyle: 'italic' },
    tagRow: { flexDirection: 'row', marginTop: 8 },
    tag: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
    tagText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
    statusRow: { flexDirection: 'row', marginTop: 8 },
    statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
    statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.2 },
  });
}

export default function HealthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { healthLogs, contacts, addHealthLog, deleteHealthLog, shareHealthLogToContacts, profile, updateProfile } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [showModal, setShowModal] = useState(false);
  const [defaultType, setDefaultType] = useState<MetricType>('bp');
  const [showDropdown, setShowDropdown] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showLastPeriodPicker, setShowLastPeriodPicker] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [showMenstrualSettings, setShowMenstrualSettings] = useState(false);

  const isWeb = Platform.OS === 'web';
  const topPad = isWeb ? 67 : insets.top;
  const bottomPad = isWeb ? 34 : insets.bottom;
  const filtered = filter === 'all' ? healthLogs : healthLogs.filter(l => l.type === filter);

  // Build calendar data for selected month (monthOffset from today)
  const calendar = useMemo(() => {
    const base = new Date();
    base.setMonth(base.getMonth() + monthOffset);
    const year = base.getFullYear();
    const month = base.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const days: { date: string; day: number; readings: Partial<Record<MetricType, HealthLog[]>>; isPeriod?: boolean }[] = [];
    // Map logs by date
    const logsByDate: Record<string, HealthLog[]> = {};
    healthLogs.forEach(l => { (logsByDate[l.date] ||= []).push(l); });

    // Compute predicted menstrual periods if profile settings exist
    const predictedPeriods = new Set<string>();
    if (profile?.lastPeriodStart && profile?.menstrualCycleLength && profile?.menstrualPeriodLength) {
      const cycle = profile.menstrualCycleLength;
      const periodLen = profile.menstrualPeriodLength;
      const startDate = new Date(profile.lastPeriodStart + 'T00:00:00');
      // move backward to cover earlier cycles
      let cur = new Date(startDate);
      while (cur.getMonth() > month || (cur.getMonth() === month && cur.getFullYear() === year && cur.getDate() > last.getDate())) {
        cur.setDate(cur.getDate() - cycle);
      }
      // step forward and mark periods
      const endMonth = new Date(year, month + 1, 0);
      while (cur <= endMonth) {
        for (let i = 0; i < periodLen; i++) {
          const d = new Date(cur);
          d.setDate(cur.getDate() + i);
              const ds = (() => { const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; })();
          predictedPeriods.add(ds);
        }
        cur.setDate(cur.getDate() + cycle);
      }
    }

    for (let d = 1; d <= last.getDate(); d++) {
      const cur = new Date(year, month, d);
      const dateStr = (() => { const y = cur.getFullYear(); const m = String(cur.getMonth()+1).padStart(2,'0'); const dd = String(cur.getDate()).padStart(2,'0'); return `${y}-${m}-${dd}`; })();
      const dayLogs = logsByDate[dateStr] ?? [];
      const readings: Partial<Record<MetricType, HealthLog[]>> = {};
      dayLogs.forEach(l => { (readings[l.type] ||= []).push(l); });
      days.push({ date: dateStr, day: d, readings, isPeriod: predictedPeriods.has(dateStr) || (readings['menstrual'] && readings['menstrual'].length > 0) });
    }
    return days;
  }, [healthLogs, profile, monthOffset]);

  const monthLabel = (() => {
    const b = new Date();
    b.setMonth(b.getMonth() + monthOffset);
    return b.toLocaleString('default', { month: 'long', year: 'numeric' });
  })();

  const handleDelete = (id: string) => {
    Alert.alert('Delete Reading', 'Remove this health reading?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); deleteHealthLog(id); } },
    ]);
  };

  const handleShare = (log: HealthLog) => {
    const allContactIds = contacts.map(c => c.id);
    if (allContactIds.length === 0) {
      Alert.alert('No Contacts', 'Add notification contacts in your Profile to share via WhatsApp.');
      return;
    }
    shareHealthLogToContacts(log, allContactIds);
  };

  const openModalForType = (type: MetricType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDefaultType(type);
    setShowModal(true);
    setShowDropdown(false);
  };

  const s = makeStyles(colors);

  const _cycleVal = Number(profile?.menstrualCycleLength);
  const menstrualCycleDisplay = !isNaN(_cycleVal) ? Math.min(60, Math.max(14, _cycleVal)) : 28;
  const _periodVal = Number(profile?.menstrualPeriodLength);
  const menstrualPeriodDisplay = !isNaN(_periodVal) ? Math.min(60, Math.max(1, _periodVal)) : 5;

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      {/* TracMeds brand bar */}
      <View style={s.brandBar}>
        <Image source={require('../../assets/images/icon.png')} style={s.brandIcon} resizeMode="contain" />
        <Text style={s.brandText}>TracMeds</Text>
      </View>

      <View style={s.header}>
        <View>
          <Text style={s.headerTitle}>Health Logs</Text>
          <Text style={s.headerSub}>{viewMode === 'list' ? 'All readings' : 'Month view — tap a day'}</Text>
        </View>
        <TouchableOpacity style={s.addBtn}
          onPress={() => { setDefaultType(filter !== 'all' ? filter : 'bp'); setShowModal(true); }}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* View mode segments placed above the Log a Reading control to avoid overlap */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 20, marginTop: 8 }}>
        <TouchableOpacity style={[s.segment, viewMode === 'list' && { backgroundColor: colors.bpColor }]} onPress={() => setViewMode('list')}>
          <Text style={[s.segmentText, viewMode === 'list' && { color: '#fff' }]}>List</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.segment, viewMode === 'calendar' && { backgroundColor: colors.bpColor }]} onPress={() => setViewMode('calendar')}>
          <Text style={[s.segmentText, viewMode === 'calendar' && { color: '#fff' }]}>Calendar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.segment} onPress={() => setShowMenstrualSettings(true)}>
          <Text style={s.segmentText}>Cycle Settings</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Dropdown quick-select for 4 main metrics */}
      <TouchableOpacity style={s.dropdownHeader} onPress={() => setShowDropdown(v => !v)} activeOpacity={0.8}>
        <MaterialCommunityIcons name="heart-pulse" size={18} color={colors.bpColor} />
        <Text style={s.dropdownTitle}>Log a Reading</Text>
        <Ionicons name={showDropdown ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
      </TouchableOpacity>

      

      {showDropdown && (
        <View style={s.dropdownContent}>
          {MAIN_METRICS.map(type => {
            const meta = METRIC_META[type];
            const mColor = colors[meta.colorKey];
            return (
              <TouchableOpacity key={type} style={[s.dropdownItem, { borderColor: mColor + '30' }]} onPress={() => openModalForType(type)}>
                <View style={[s.dropdownIcon, { backgroundColor: mColor + '18' }]}>
                  <MaterialCommunityIcons name={meta.icon as any} size={18} color={mColor} />
                </View>
                <Text style={[s.dropdownLabel, { color: mColor }]}>{meta.label}</Text>
                <Ionicons name="add-circle-outline" size={18} color={mColor} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Filter row */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={s.filterRow}>
        {FILTERS.map(f => {
          const active = filter === f.key;
          const meta = f.key !== 'all' ? METRIC_META[f.key as MetricType] : null;
          const mColor = meta ? colors[meta.colorKey] : colors.primary;
          return (
            <TouchableOpacity key={f.key} style={[s.filterChip, active && { backgroundColor: mColor }]} onPress={() => setFilter(f.key)}>
              {meta && <MaterialCommunityIcons name={meta.icon as any} size={13} color={active ? '#fff' : colors.mutedForeground} />}
              <Text style={[s.filterText, active && { color: '#fff' }]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {viewMode === 'list' ? (
        <FlatList
        data={filtered}
        keyExtractor={l => l.id}
        renderItem={({ item }) => (
          <LogCard log={item} colors={colors}
            onDelete={() => handleDelete(item.id)}
            onShare={() => handleShare(item)}
          />
        )}
        contentContainerStyle={[s.list, { paddingBottom: bottomPad + 90 }, filtered.length === 0 && s.listEmpty]}
        ListHeaderComponent={
          <DailyReportToggle category="healthLogs" label="Include readings in daily family report" />
        }
        scrollEnabled={filtered.length > 0}
        ListEmptyComponent={
          <View style={s.empty}>
            <MaterialCommunityIcons name="heart-pulse" size={52} color={colors.border} />
            <Text style={s.emptyTitle}>No readings yet</Text>
            <Text style={s.emptyBody}>Tap a category above to log your first reading.</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad + 90 }}>
              <View style={{ marginTop: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: 8 }}>
                  <TouchableOpacity onPress={() => setMonthOffset(m => m - 1)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + 'cc', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="chevron-back" size={20} color="#fff" />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground }}>{monthLabel}</Text>
                  <TouchableOpacity onPress={() => setMonthOffset(m => m + 1)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary + 'cc', alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="chevron-forward" size={20} color="#fff" />
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
                  {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(w => (
                    <Text key={w} style={{ flexBasis: '14.2857%', maxWidth: '14.2857%', textAlign: 'center', color: colors.mutedForeground, fontSize: 12 }}>{w}</Text>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {calendar.map(day => {
                    const isPeriod = !!day.isPeriod;
                    return (
                      <TouchableOpacity key={day.date} style={{ flexBasis: '14.2857%', maxWidth: '14.2857%', padding: 6 }} onPress={() => setSelectedDate(day.date)}>
                        <View style={{ alignItems: 'center', borderRadius: 8, padding: 8, backgroundColor: isPeriod ? (colors.menstrualColor + '30') : 'transparent', minHeight: 68 }}>
                          <Text style={{ fontSize: 13, color: isPeriod ? colors.menstrualColor : colors.foreground }}>{day.day}</Text>
                              <View style={{ marginTop: 8, flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
                                      {(['bp','blood_sugar','temperature','weight','exercise'] as MetricType[]).map(mt => {
                                        const cnt = (day.readings[mt] ?? []).length;
                                        if (!cnt) return null;
                                        const bg = mt === 'bp' ? colors.bpColor : mt === 'blood_sugar' ? colors.sugarColor : mt === 'temperature' ? colors.tempColor : mt === 'exercise' ? colors.weightColor : colors.weightColor;
                                        return (
                                          <View key={mt} style={{ backgroundColor: bg + '90', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 }}>
                                            <Text style={{ color: '#fff', fontSize: 11 }}>{cnt}</Text>
                                          </View>
                                        );
                                      })}
                                    </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </ScrollView>
      )}

      <HealthLogModal visible={showModal} defaultType={defaultType} onClose={() => setShowModal(false)} onSave={addHealthLog} />

      {/* Day details modal */}
      <Modal visible={!!selectedDate} animationType="slide" transparent onRequestClose={() => setSelectedDate(null)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', padding: 16 }}>
            <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 8 }}>{selectedDate ? formatDate(selectedDate) : ''}</Text>
            <ScrollView>
              {selectedDate && (() => {
                const logs = healthLogs.filter(l => l.date === selectedDate);
                if (logs.length === 0) return <Text style={{ color: colors.mutedForeground }}>No readings logged.</Text>;
                return logs.map(l => (
                  <View key={l.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{METRIC_META[l.type].label}</Text>
                    <Text style={{ color: colors.mutedForeground }}>{formatTime(l.time ?? '')} — {getDisplayValue(l)} {getUnit(l)}</Text>
                    {l.notes ? <Text style={{ marginTop: 6, color: colors.mutedForeground }}>{l.notes}</Text> : null}
                  </View>
                ));
              })()}
            </ScrollView>
            <View style={{ marginTop: 12 }}>
              <TouchableOpacity onPress={() => setSelectedDate(null)} style={{ alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.primary }}>
                <Text style={{ color: '#fff' }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Menstrual settings modal */}
      <Modal visible={showMenstrualSettings} animationType="slide" transparent onRequestClose={() => setShowMenstrualSettings(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '60%', padding: 16 }}>
            <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 8 }}>Menstrual Cycle Settings</Text>
            <Text style={{ color: colors.mutedForeground, marginBottom: 8 }}>These values are used to predict period days on the calendar.</Text>
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.mutedForeground }}>Average cycle length (days)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <TouchableOpacity onPress={() => { const cur = Number(profile?.menstrualCycleLength) || menstrualCycleDisplay; updateProfile({ menstrualCycleLength: Math.max(14, cur - 1) }); }} style={{ padding: 8, borderRadius: 8, backgroundColor: colors.muted }}><Text>-</Text></TouchableOpacity>
                <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.input }}><Text style={{ color: colors.foreground }}>{menstrualCycleDisplay}</Text></View>
                <TouchableOpacity onPress={() => { const cur = Number(profile?.menstrualCycleLength) || menstrualCycleDisplay; updateProfile({ menstrualCycleLength: Math.min(60, cur + 1) }); }} style={{ padding: 8, borderRadius: 8, backgroundColor: colors.muted }}><Text>+</Text></TouchableOpacity>
              </View>
            </View>
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.mutedForeground }}>Average period length (days)</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <TouchableOpacity onPress={() => { const cur = Number(profile?.menstrualPeriodLength) || menstrualPeriodDisplay; updateProfile({ menstrualPeriodLength: Math.max(1, cur - 1) }); }} style={{ padding: 8, borderRadius: 8, backgroundColor: colors.muted }}><Text>-</Text></TouchableOpacity>
                <View style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.input }}><Text style={{ color: colors.foreground }}>{menstrualPeriodDisplay}</Text></View>
                <TouchableOpacity onPress={() => { const cur = Number(profile?.menstrualPeriodLength) || menstrualPeriodDisplay; updateProfile({ menstrualPeriodLength: Math.min(60, cur + 1) }); }} style={{ padding: 8, borderRadius: 8, backgroundColor: colors.muted }}><Text>+</Text></TouchableOpacity>
              </View>
            </View>
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.mutedForeground }}>Last period start</Text>
              <TouchableOpacity onPress={() => setShowLastPeriodPicker(true)} style={{ paddingVertical: 12, borderRadius: 12, backgroundColor: colors.input, paddingHorizontal: 12 }}>
                <Text style={{ color: profile?.lastPeriodStart ? colors.foreground : colors.mutedForeground }}>{profile?.lastPeriodStart ? (() => { const p = profile.lastPeriodStart!.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; })() : 'Not set'}</Text>
              </TouchableOpacity>
              <SimpleDatePicker visible={showLastPeriodPicker} value={profile?.lastPeriodStart ? (() => { const p = profile.lastPeriodStart!.split('-'); return `${p[2]}/${p[1]}/${p[0]}`; })() : ''} onConfirm={(ddmmyyyy) => {
                const parts = ddmmyyyy.split('/');
                if (parts.length === 3) {
                  const [d,m,y] = parts;
                  updateProfile({ lastPeriodStart: `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}` });
                } else {
                  updateProfile({ lastPeriodStart: undefined });
                }
                setShowLastPeriodPicker(false);
              }} onCancel={() => setShowLastPeriodPicker(false)} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center', marginTop: 8 }}>
              <TouchableOpacity onPress={() => setShowMenstrualSettings(false)} style={{ paddingVertical: 10, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.muted }}>
                <Text style={{ color: colors.foreground }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    brandBar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 0 },
    brandIcon: { width: 16, height: 16, borderRadius: 4, flexShrink: 0 },
    brandText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.8, textTransform: 'uppercase' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4 },
    headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: colors.foreground },
    headerSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 },
    addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bpColor, alignItems: 'center', justifyContent: 'center' },
    segment: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.muted },
    segmentText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
    dropdownHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginBottom: 8, backgroundColor: colors.card, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
    dropdownTitle: { flex: 1, fontSize: 15, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
    dropdownContent: { marginHorizontal: 20, marginBottom: 8, gap: 8 },
    dropdownItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1 },
    dropdownIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    dropdownLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
    filterScroll: { flexGrow: 0, marginBottom: 8 },
    filterRow: { paddingHorizontal: 20, gap: 8, paddingVertical: 4 },
    filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.muted },
    filterText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
    list: { paddingHorizontal: 20 },
    listEmpty: { flex: 1 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
    emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
    emptyBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', maxWidth: 260 },
  });
}
