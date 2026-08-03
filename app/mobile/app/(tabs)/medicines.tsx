import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, Platform, Switch,
  Image,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import MedicineModal from '@/components/MedicineModal';
import DailyReportToggle from '@/components/DailyReportToggle';
import { Medicine, FrequencyType } from '@/types';

const FREQ_LABELS: Record<FrequencyType, string> = {
  once: 'Once', daily: 'Once daily', twice_daily: 'Twice daily',
  three_times: '3× daily', weekly: 'Weekly', as_needed: 'As needed',
};

type Filter = 'all' | 'active' | 'inactive';

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function MedCard({
  med, colors, onEdit, onDelete, onToggle, onShare,
}: {
  med: Medicine; colors: ReturnType<typeof useColors>;
  onEdit: () => void; onDelete: () => void; onToggle: () => void; onShare: () => void;
}) {
  const s = cardStyles(colors);
  const mColor = colors.medicineColor;
  return (
    <View style={[s.card, !med.active && s.inactiveCard]}>
      <View style={[s.bar, { backgroundColor: med.active ? mColor : colors.border }]} />
      <View style={s.body}>
        <View style={s.topRow}>
          <View style={[s.pillIcon, { backgroundColor: mColor + '18' }]}>
            <MaterialCommunityIcons name="pill" size={22} color={mColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.medName} numberOfLines={1}>{med.name}</Text>
            <Text style={s.dosage}>{med.dosage} {med.unit} · {FREQ_LABELS[med.frequency]}</Text>
          </View>
          <View style={s.actions}>
            <TouchableOpacity onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="create-outline" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="trash-outline" size={20} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        </View>

        {med.times.length > 0 && (
          <View style={s.timesRow}>
            {med.times.map((t, i) => (
              <View key={i} style={[s.timePill, { backgroundColor: mColor + '15' }]}>
                <Ionicons name="time-outline" size={11} color={mColor} />
                <Text style={[s.timeText, { color: mColor }]}>{formatTime(t)}</Text>
              </View>
            ))}
          </View>
        )}

        {med.endDate && (
          <View style={s.dateRow}>
            <Ionicons name="calendar-outline" size={12} color={colors.mutedForeground} />
            <Text style={s.dateText}>Until {med.endDate}</Text>
          </View>
        )}

        {med.notes ? <Text style={s.notes} numberOfLines={1}>{med.notes}</Text> : null}

        <View style={s.footer}>
          <View style={s.activeRow}>
            <Text style={s.activeLabel}>{med.active ? 'Active' : 'Paused'}</Text>
            <Switch
              value={med.active}
              onValueChange={onToggle}
              trackColor={{ false: colors.border, true: mColor + '60' }}
              thumbColor={med.active ? mColor : colors.mutedForeground}
              ios_backgroundColor={colors.border}
            />
          </View>
          {med.notifyContactIds.length > 0 && (
            <TouchableOpacity style={s.waBtn} onPress={onShare}>
              <Ionicons name="logo-whatsapp" size={16} color="#25D366" />
              <Text style={s.waBtnText}>Notify {med.notifyContactIds.length}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

function cardStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16, marginBottom: 12, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
    inactiveCard: { opacity: 0.65 },
    bar: { width: 5 },
    body: { flex: 1, padding: 14, gap: 8 },
    topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    pillIcon: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    medName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground },
    dosage: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 },
    actions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    timesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    timePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
    timeText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
    dateRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    dateText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground },
    notes: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, fontStyle: 'italic' },
    footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    activeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    activeLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
    waBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#25D36618', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
    waBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#25D366' },
  });
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Paused' },
];

export default function MedicinesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { medicines, addMedicine, updateMedicine, deleteMedicine, toggleMedicineActive, shareMedicineToContacts } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Medicine | null>(null);

  const isWeb = Platform.OS === 'web';
  const topPad = isWeb ? 67 : insets.top;
  const bottomPad = isWeb ? 34 : insets.bottom;

  const filtered = medicines.filter(m => {
    if (filter === 'active') return m.active;
    if (filter === 'inactive') return !m.active;
    return true;
  });

  const handleDelete = (id: string) => {
    Alert.alert('Delete Medicine', 'Remove this medicine from your list?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); deleteMedicine(id); } },
    ]);
  };

  const handleEdit = (med: Medicine) => { setEditing(med); setShowModal(true); };

  const handleSave = async (data: Omit<Medicine, 'id' | 'createdAt'>) => {
    if (editing) { await updateMedicine(editing.id, data); setEditing(null); }
    else await addMedicine(data);
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
        <View>
          <Text style={s.headerTitle}>Medicines</Text>
          <Text style={s.headerSub}>{medicines.filter(m => m.active).length} active</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => { setEditing(null); setShowModal(true); }}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={s.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f.key} style={[s.filterChip, filter === f.key && { backgroundColor: colors.medicineColor }]} onPress={() => setFilter(f.key)}>
            <Text style={[s.filterText, filter === f.key && { color: '#fff' }]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={m => m.id}
        renderItem={({ item }) => (
          <MedCard
            med={item} colors={colors}
            onEdit={() => handleEdit(item)}
            onDelete={() => handleDelete(item.id)}
            onToggle={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleMedicineActive(item.id); }}
            onShare={() => shareMedicineToContacts(item, item.notifyContactIds)}
          />
        )}
        contentContainerStyle={[s.list, { paddingBottom: bottomPad + 90 }, filtered.length === 0 && s.listEmpty]}
        scrollEnabled={filtered.length > 0}
        ListHeaderComponent={
          <DailyReportToggle category="medicines" label="Include medicines in daily family report" />
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <MaterialCommunityIcons name="pill" size={52} color={colors.border} />
            <Text style={s.emptyTitle}>No medicines</Text>
            <Text style={s.emptyBody}>{filter !== 'all' ? `No ${filter} medicines.` : 'Tap + to add your first medicine.'}</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      <MedicineModal
        visible={showModal}
        editing={editing}
        onClose={() => { setShowModal(false); setEditing(null); }}
        onSave={handleSave}
      />
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    brandBar: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 0 },
    brandIcon: { width: 13, height: 13, borderRadius: 3 },
    brandText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: colors.primary, letterSpacing: 0.8, textTransform: 'uppercase' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 14, paddingTop: 4 },
    headerTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: colors.foreground },
    headerSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 },
    addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.medicineColor, alignItems: 'center', justifyContent: 'center' },
    filterRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 16 },
    filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.muted },
    filterText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
    list: { paddingHorizontal: 20 },
    listEmpty: { flex: 1 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
    emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: colors.foreground },
    emptyBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', maxWidth: 260 },
  });
}
