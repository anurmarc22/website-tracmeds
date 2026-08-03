import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, Platform, ScrollView,
  Image,
} from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import HealthLogModal from '@/components/HealthLogModal';
import DailyReportToggle from '@/components/DailyReportToggle';
import { HealthLog, MetricType } from '@/types';

type Filter = 'all' | MetricType;
type MetricColorKey = 'bpColor' | 'heartRateColor' | 'sugarColor' | 'menstrualColor' | 'weightColor' | 'tempColor';
interface MetricMeta { label: string; icon: string; colorKey: MetricColorKey; unit: string; }

const METRIC_META: Record<MetricType, MetricMeta> = {
  bp: { label: 'Blood Pressure', icon: 'heart-pulse', colorKey: 'bpColor', unit: 'mmHg' },
  heart_rate: { label: 'Heart Rate', icon: 'heart-flash', colorKey: 'heartRateColor', unit: 'BPM' },
  blood_sugar: { label: 'Blood Sugar', icon: 'water', colorKey: 'sugarColor', unit: 'mg/dL' },
  menstrual: { label: 'Menstrual Cycle', icon: 'gender-female', colorKey: 'menstrualColor', unit: '' },
  weight: { label: 'Weight', icon: 'scale-bathroom', colorKey: 'weightColor', unit: '' },
  temperature: { label: 'Temperature', icon: 'thermometer', colorKey: 'tempColor', unit: '' },
};

const MAIN_METRICS: MetricType[] = ['bp', 'heart_rate', 'blood_sugar', 'menstrual'];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
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
    case 'weight': return log.value1 ? `${log.value1}` : '—';
    case 'temperature': return log.value1 ? `${log.value1}` : '—';
  }
}

function getUnit(log: HealthLog): string {
  switch (log.type) {
    case 'bp': return 'mmHg';
    case 'heart_rate': return 'BPM';
    case 'blood_sugar': return 'mg/dL';
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
        {log.type === 'blood_sugar' && log.label ? (
          <View style={s.tagRow}><View style={[s.tag, { backgroundColor: mColor + '18' }]}><Text style={[s.tagText, { color: mColor }]}>{log.label}</Text></View></View>
        ) : null}
        {log.type === 'heart_rate' && log.label ? (
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
  });
}

export default function HealthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { healthLogs, contacts, addHealthLog, deleteHealthLog, shareHealthLogToContacts } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [showModal, setShowModal] = useState(false);
  const [defaultType, setDefaultType] = useState<MetricType>('bp');
  const [showDropdown, setShowDropdown] = useState(false);

  const isWeb = Platform.OS === 'web';
  const topPad = isWeb ? 67 : insets.top;
  const bottomPad = isWeb ? 34 : insets.bottom;
  const filtered = filter === 'all' ? healthLogs : healthLogs.filter(l => l.type === filter);

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

  return (
    <View style={[s.container, { paddingTop: topPad }]}>
      {/* TracMeds brand bar */}
      <View style={s.brandBar}>
        <Image source={require('../../assets/images/icon.png')} style={s.brandIcon} resizeMode="contain" />
        <Text style={s.brandText}>TracMeds</Text>
      </View>

      <View style={s.header}>
        <Text style={s.headerTitle}>Health Logs</Text>
        <TouchableOpacity style={s.addBtn}
          onPress={() => { setDefaultType(filter !== 'all' ? filter : 'bp'); setShowModal(true); }}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

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

      <HealthLogModal visible={showModal} defaultType={defaultType} onClose={() => setShowModal(false)} onSave={addHealthLog} />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    brandBar: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 0 },
    brandIcon: { width: 13, height: 13, borderRadius: 3 },
    brandText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.8, textTransform: 'uppercase' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12, paddingTop: 4 },
    headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: colors.foreground },
    addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.bpColor, alignItems: 'center', justifyContent: 'center' },
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
