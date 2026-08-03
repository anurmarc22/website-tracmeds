import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Platform, Image } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import AppointmentModal from '@/components/AppointmentModal';
import DailyReportToggle from '@/components/DailyReportToggle';
import { Appointment, AppointmentType } from '@/types';

type Filter = 'all' | AppointmentType;

// DD/MM/YYYY display
function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}
function formatTime(t: string): string {
  const [h, mi] = t.split(':').map(Number);
  return `${h % 12 || 12}:${mi.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function isUpcoming(appt: Appointment): boolean {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [y, m, d] = appt.date.split('-').map(Number);
  return new Date(y, m - 1, d) >= today;
}

function ApptCard({ appt, colors, onEdit, onDelete, onShare }: {
  appt: Appointment; colors: ReturnType<typeof useColors>;
  onEdit: () => void; onDelete: () => void; onShare: () => void;
}) {
  const upcoming = isUpcoming(appt);
  const typeColor = appt.type === 'doctor' ? colors.doctorColor : colors.diagnosticColor;
  const s = cardStyles(colors);
  return (
    <View style={[s.card, !upcoming && s.pastCard]}>
      <View style={[s.bar, { backgroundColor: typeColor }]} />
      <View style={s.body}>
        <View style={s.row}>
          <View style={[s.icon, { backgroundColor: typeColor + '18' }]}>
            <Ionicons name={appt.type === 'doctor' ? 'medkit-outline' : 'flask-outline'} size={20} color={typeColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.title} numberOfLines={1}>{appt.title}</Text>
            {appt.specialty ? <Text style={s.sub}>{appt.specialty}</Text> : null}
            {appt.facility ? <Text style={s.sub}>{appt.facility}</Text> : null}
          </View>
          <View style={s.actions}>
            <TouchableOpacity onPress={onShare} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="create-outline" size={20} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="trash-outline" size={20} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={s.footer}>
          <View style={s.pill}><Ionicons name="calendar-outline" size={12} color={colors.mutedForeground} /><Text style={s.pillText}>{formatDate(appt.date)}</Text></View>
          <View style={s.pill}><Ionicons name="time-outline" size={12} color={colors.mutedForeground} /><Text style={s.pillText}>{formatTime(appt.time)}</Text></View>
          {!upcoming && <View style={s.pill}><Text style={s.pillText}>Past</Text></View>}
        </View>
        {appt.notes ? <Text style={s.notes} numberOfLines={2}>{appt.notes}</Text> : null}
        {appt.report ? <Text style={s.report} numberOfLines={2}>{appt.report}</Text> : null}
      </View>
    </View>
  );
}

function cardStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16, marginBottom: 12, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
    pastCard: { opacity: 0.6 },
    bar: { width: 5 },
    body: { flex: 1, padding: 14 },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
    icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 15, fontFamily: 'Inter_700Bold', color: colors.foreground },
    sub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 2 },
    actions: { flexDirection: 'row', gap: 12, alignItems: 'center' },
    footer: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.muted, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
    pillText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.mutedForeground },
    notes: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 8, fontStyle: 'italic' },
    report: { fontSize: 12, fontFamily: 'Inter_500Medium', color: colors.foreground, marginTop: 4 },
  });
}

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'doctor', label: 'Doctor' },
  { key: 'diagnostic', label: 'Diagnostic' },
];

export default function AppointmentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { appointments, contacts, addAppointment, updateAppointment, deleteAppointment, shareAppointmentToContacts } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);

  const isWeb = Platform.OS === 'web';
  const topPad = isWeb ? 67 : insets.top;
  const bottomPad = isWeb ? 34 : insets.bottom;

  const filtered = appointments.filter(a => filter === 'all' || a.type === filter);
  const sorted = [...filtered.filter(isUpcoming), ...filtered.filter(a => !isUpcoming(a))];

  const handleDelete = (id: string) => {
    Alert.alert('Delete Appointment', 'Remove this appointment?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); deleteAppointment(id); } },
    ]);
  };

  const handleShare = (appt: Appointment) => {
    const allContactIds = contacts.map(c => c.id);
    if (allContactIds.length === 0) {
      Alert.alert('No Contacts', 'Add notification contacts in your Profile to share via WhatsApp.');
      return;
    }
    shareAppointmentToContacts(appt, allContactIds);
  };

  const handleSave = async (data: Omit<Appointment, 'id' | 'createdAt'>) => {
    if (editing) { await updateAppointment(editing.id, data); setEditing(null); }
    else await addAppointment(data);
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
          <Text style={s.headerTitle}>Appointments</Text>
          <Text style={s.headerSub}>{appointments.filter(isUpcoming).length} upcoming</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => { setEditing(null); setShowModal(true); }}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={s.filterRow}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f.key} style={[s.filterChip, filter === f.key && { backgroundColor: colors.primary }]} onPress={() => setFilter(f.key)}>
            <Text style={[s.filterText, filter === f.key && { color: '#fff' }]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={sorted}
        keyExtractor={a => a.id}
        renderItem={({ item }) => (
          <ApptCard appt={item} colors={colors}
            onEdit={() => { setEditing(item); setShowModal(true); }}
            onDelete={() => handleDelete(item.id)}
            onShare={() => handleShare(item)}
          />
        )}
        contentContainerStyle={[s.list, { paddingBottom: bottomPad + 90 }, sorted.length === 0 && s.listEmpty]}
        ListHeaderComponent={
          <DailyReportToggle category="appointments" label="Include appointments in daily family report" />
        }
        scrollEnabled={sorted.length > 0}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="calendar-outline" size={52} color={colors.border} />
            <Text style={s.emptyTitle}>No appointments</Text>
            <Text style={s.emptyBody}>{filter !== 'all' ? `No ${filter} appointments found.` : 'Tap + to schedule your first appointment.'}</Text>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />

      <AppointmentModal visible={showModal} editing={editing}
        onClose={() => { setShowModal(false); setEditing(null); }} onSave={handleSave} />
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
    addBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
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
