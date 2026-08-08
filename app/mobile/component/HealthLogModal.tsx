import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, KeyboardAvoidingView, Platform, Alert,
  Dimensions,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import TimeInput12h from '@/components/TimeInput12h';
import SimpleDatePicker from '@/components/SimpleDatePicker';
import { formatTime12, nowHHMM } from '@/utils/time';
import { HealthLog, MetricType } from '@/types';

interface Props {
  visible: boolean;
  defaultType?: MetricType;
  onClose: () => void;
  onSave: (data: Omit<HealthLog, 'id' | 'createdAt'>) => void;
}

const METRICS: { type: MetricType; label: string; icon: string }[] = [
  { type: 'exercise', label: 'Exercise', icon: 'run-fast' },
  { type: 'bp', label: 'Blood Pressure', icon: 'heart-pulse' },
  { type: 'heart_rate', label: 'Heart Rate', icon: 'heart-flash' },
  { type: 'blood_sugar', label: 'Blood Sugar', icon: 'water' },
  { type: 'menstrual', label: 'Menstrual', icon: 'gender-female' },
  { type: 'weight', label: 'Weight', icon: 'scale-bathroom' },
  { type: 'temperature', label: 'Temperature', icon: 'thermometer' },
];

// Returns today as DD/MM/YYYY
function todayDDMMYYYY(): string {
  const now = new Date();
  const d = String(now.getDate()).padStart(2, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const y = now.getFullYear();
  return `${d}/${m}/${y}`;
}

// Convert DD/MM/YYYY → YYYY-MM-DD for storage
function toStorageDate(ddmmyyyy: string): string {
  const parts = ddmmyyyy.split('/');
  if (parts.length !== 3) return '';
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export default function HealthLogModal({ visible, defaultType, onClose, onSave }: Props) {
  const colors = useColors();
  const chipRefs = useRef<Array<React.ElementRef<typeof TouchableOpacity> | null>>([]);
  const categoryScrollRef = useRef<ScrollView | null>(null);
  const [type, setType] = useState<MetricType>(defaultType ?? 'bp');
  const [dateInput, setDateInput] = useState(todayDDMMYYYY()); // DD/MM/YYYY display
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [time, setTime] = useState(nowHHMM());                 // HH:MM (24h, internal)
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [exerciseHours, setExerciseHours] = useState('');
  const [exerciseMinutes, setExerciseMinutes] = useState('');
  const [exerciseCompleted, setExerciseCompleted] = useState(true);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');

  const scrollToActiveCategory = () => {
    const activeIndex = METRICS.findIndex(metric => metric.type === type);
    if (activeIndex === -1) return;

    const chip = chipRefs.current[activeIndex];
    if (!chip) return;

    chip.measureInWindow((x: number, _y: number, width: number) => {
      const screenWidth = Dimensions.get('window').width;
      const centeredX = Math.max(0, x - (screenWidth - width) / 2);
      categoryScrollRef.current?.scrollTo({ x: centeredX, animated: true });
    });
  };

  useEffect(() => {
    if (visible) {
      setType(defaultType ?? 'bp');
      setDateInput(todayDDMMYYYY());
      setTime(nowHHMM());
      setV1(''); setV2(''); setExerciseHours(''); setExerciseMinutes(''); setExerciseCompleted(true); setLabel(''); setNotes('');
    }
  }, [visible, defaultType]);

  useEffect(() => {
    if (!visible) return;
    const timeout = setTimeout(() => scrollToActiveCategory(), 50);
    return () => clearTimeout(timeout);
  }, [visible, type]);

  useEffect(() => {
    setV1(''); setV2(''); setExerciseHours(''); setExerciseMinutes(''); setExerciseCompleted(true); setLabel('');
  }, [type]);

  const getColor = (t: MetricType): string => {
    switch (t) {
      case 'bp': return colors.bpColor;
      case 'heart_rate': return colors.heartRateColor;
      case 'blood_sugar': return colors.sugarColor;
      case 'menstrual': return colors.menstrualColor;
      case 'exercise': return colors.weightColor;
      case 'weight': return colors.weightColor;
      case 'temperature': return colors.tempColor;
    }
  };

  const handleSave = () => {
    // Validate date DD/MM/YYYY
    if (!dateInput.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
      Alert.alert('Invalid Date', 'Enter date as DD/MM/YYYY (e.g. 26/07/2026).');
      return;
    }
    const storageDate = toStorageDate(dateInput);
    if (!storageDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
      Alert.alert('Invalid Date', 'Enter a valid date as DD/MM/YYYY.');
      return;
    }
    const storageTime = time;

    let value1: number | undefined;
    let value2: number | undefined;
    if (type === 'bp') {
      if (!v1 || !v2) { Alert.alert('Required', 'Enter both systolic and diastolic values.'); return; }
      value1 = parseFloat(v1); value2 = parseFloat(v2);
      if (isNaN(value1) || isNaN(value2)) { Alert.alert('Invalid', 'Enter valid numbers.'); return; }
    } else if (type === 'heart_rate') {
      if (!v1) { Alert.alert('Required', 'Enter your heart rate in BPM.'); return; }
      value1 = parseFloat(v1);
      if (isNaN(value1)) { Alert.alert('Invalid', 'Enter a valid number.'); return; }
    } else if (type === 'blood_sugar' || type === 'weight' || type === 'temperature') {
      if (!v1) { Alert.alert('Required', 'Enter a value.'); return; }
      value1 = parseFloat(v1);
      if (isNaN(value1)) { Alert.alert('Invalid', 'Enter a valid number.'); return; }
    } else if (type === 'exercise') {
      const hours = Number(exerciseHours || 0);
      const minutes = Number(exerciseMinutes || 0);
      const totalMinutes = hours * 60 + minutes;
      if (totalMinutes <= 0) { Alert.alert('Required', 'Enter exercise duration in hours and/or minutes.'); return; }
      value1 = totalMinutes;
      if (!label) { Alert.alert('Required', 'Choose an exercise type.'); return; }
    } else if (type === 'menstrual') {
      if (v1) value1 = parseFloat(v1);
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSave({
      type,
      date: storageDate,
      time: storageTime,
      value1,
      value2,
      label: label || undefined,
      notes: notes.trim() || undefined,
      completed: type === 'exercise' ? exerciseCompleted : undefined,
    });
    onClose();
  };

  const s = makeStyles(colors);
  const activeColor = getColor(type);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.headerTitle}>Log Health Reading</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={24} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Category */}
            <Text style={s.label}>Category</Text>
            <ScrollView
              ref={categoryScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 4 }}
              contentContainerStyle={s.chipRow}
            >
              <View style={s.chipRow}>
                {METRICS.map((m, index) => {
                  const mColor = getColor(m.type);
                  const active = type === m.type;
                  return (
                    <TouchableOpacity
                      key={m.type}
                      ref={ref => { chipRefs.current[index] = ref; }}
                      style={[s.chip, active && { backgroundColor: mColor, borderColor: mColor }]}
                      onPress={() => setType(m.type)}
                    >
                      <MaterialCommunityIcons name={m.icon as any} size={15} color={active ? '#fff' : colors.mutedForeground} />
                      <Text style={[s.chipText, active && { color: '#fff' }]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {/* Date DD/MM/YYYY */}
            <Text style={s.label}>Date (DD/MM/YYYY)</Text>
            <TouchableOpacity onPress={() => setShowDatePicker(true)} style={s.input}>
              <Text style={{ color: dateInput ? colors.foreground : colors.mutedForeground }}>{dateInput}</Text>
            </TouchableOpacity>
            <SimpleDatePicker visible={showDatePicker} value={dateInput} onConfirm={(v) => { setDateInput(v); setShowDatePicker(false); }} onCancel={() => setShowDatePicker(false)} />

            {/* Time (12-hour AM/PM) */}
            <Text style={s.label}>Time</Text>
            <TimeInput12h value={time} onChange={setTime} activeColor={activeColor} />
            <Text style={s.timePreview}>{formatTime12(time)}</Text>

            {/* Type-specific fields */}
            {type === 'bp' && (
              <View style={s.row}>
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Systolic (mmHg)</Text>
                  <TextInput style={s.input} value={v1} onChangeText={setV1} placeholder="120" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" />
                </View>
                <View style={{ width: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={s.label}>Diastolic (mmHg)</Text>
                  <TextInput style={s.input} value={v2} onChangeText={setV2} placeholder="80" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" />
                </View>
              </View>
            )}

            {type === 'heart_rate' && (
              <>
                <Text style={s.label}>Heart Rate (BPM)</Text>
                <TextInput style={s.input} value={v1} onChangeText={setV1} placeholder="72" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" />
                <Text style={s.label}>Activity Level</Text>
                <View style={s.segmentRow}>
                  {['Resting', 'After Activity', 'Sleep'].map(opt => (
                    <TouchableOpacity key={opt} style={[s.segment, label === opt && { backgroundColor: activeColor }]} onPress={() => setLabel(label === opt ? '' : opt)}>
                      <Text style={[s.segmentText, label === opt && { color: '#fff' }]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {type === 'blood_sugar' && (
              <>
                <Text style={s.label}>Glucose (mg/dL)</Text>
                <TextInput style={s.input} value={v1} onChangeText={setV1} placeholder="95" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" />
                <Text style={s.label}>Reading Type</Text>
                <View style={s.segmentRow}>
                  {['Fasting', 'Post-meal', 'Random'].map(opt => (
                    <TouchableOpacity key={opt} style={[s.segment, label === opt && { backgroundColor: activeColor }]} onPress={() => setLabel(label === opt ? '' : opt)}>
                      <Text style={[s.segmentText, label === opt && { color: '#fff' }]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {type === 'exercise' && (
              <>
                <Text style={s.label}>Duration</Text>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>Hours</Text>
                    <TextInput style={s.input} value={exerciseHours} onChangeText={setExerciseHours} placeholder="2" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" />
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>Minutes</Text>
                    <TextInput style={s.input} value={exerciseMinutes} onChangeText={setExerciseMinutes} placeholder="30" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" />
                  </View>
                </View>
                <Text style={s.label}>Exercise Type</Text>
                <View style={s.segmentRow}>
                  {['Walk', 'Cardio', 'Weight Training', 'Anywhere'].map(opt => (
                    <TouchableOpacity key={opt} style={[s.segment, label === opt && { backgroundColor: activeColor }]} onPress={() => setLabel(label === opt ? '' : opt)}>
                      <Text style={[s.segmentText, label === opt && { color: '#fff' }]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.label}>Exercise Status</Text>
                <View style={s.segmentRow}>
                  {['Done', 'Not Done'].map(opt => (
                    <TouchableOpacity key={opt} style={[s.segment, (exerciseCompleted ? 'Done' : 'Not Done') === opt && { backgroundColor: activeColor }]} onPress={() => setExerciseCompleted(opt === 'Done')}>
                      <Text style={[s.segmentText, ((exerciseCompleted ? 'Done' : 'Not Done') === opt) && { color: '#fff' }]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {type === 'menstrual' && (
              <>
                <Text style={s.label}>Cycle Day (optional)</Text>
                <TextInput style={s.input} value={v1} onChangeText={setV1} placeholder="Day 1" placeholderTextColor={colors.mutedForeground} keyboardType="numeric" />
                <Text style={s.label}>Flow Level</Text>
                <View style={s.segmentRow}>
                  {['Spotting', 'Light', 'Medium', 'Heavy'].map(opt => (
                    <TouchableOpacity key={opt} style={[s.segment, label === opt && { backgroundColor: activeColor }]} onPress={() => setLabel(label === opt ? '' : opt)}>
                      <Text style={[s.segmentText, label === opt && { color: '#fff' }]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {type === 'weight' && (
              <>
                <Text style={s.label}>Weight</Text>
                <TextInput style={s.input} value={v1} onChangeText={setV1} placeholder="65.5" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" />
                <Text style={s.label}>Unit</Text>
                <View style={s.segmentRow}>
                  {['kg', 'lbs'].map(opt => (
                    <TouchableOpacity key={opt} style={[s.segment, label === opt && { backgroundColor: activeColor }]} onPress={() => setLabel(label === opt ? '' : opt)}>
                      <Text style={[s.segmentText, label === opt && { color: '#fff' }]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {type === 'temperature' && (
              <>
                <Text style={s.label}>Temperature</Text>
                <TextInput style={s.input} value={v1} onChangeText={setV1} placeholder="37.0" placeholderTextColor={colors.mutedForeground} keyboardType="decimal-pad" />
                <Text style={s.label}>Unit</Text>
                <View style={s.segmentRow}>
                  {['°C', '°F'].map(opt => (
                    <TouchableOpacity key={opt} style={[s.segment, label === opt && { backgroundColor: activeColor }]} onPress={() => setLabel(label === opt ? '' : opt)}>
                      <Text style={[s.segmentText, label === opt && { color: '#fff' }]}>{opt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={s.label}>Notes (optional)</Text>
            <TextInput style={[s.input, s.multiline]} value={notes} onChangeText={setNotes}
              placeholder="Any symptoms, medication taken..." placeholderTextColor={colors.mutedForeground} multiline numberOfLines={3} />

            <TouchableOpacity style={[s.saveBtn, { backgroundColor: activeColor }]} onPress={handleSave} activeOpacity={0.85}>
              <Text style={s.saveBtnText}>Save Reading</Text>
            </TouchableOpacity>
            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingBottom: 8, maxHeight: '92%' },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginTop: 12, marginBottom: 4 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
    headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground },
    label: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground, marginBottom: 6, marginTop: 14, letterSpacing: 0.8, textTransform: 'uppercase' },
    chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.muted },
    chipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
    row: { flexDirection: 'row', alignItems: 'flex-end' },
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    ampmRow: { flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 10, padding: 3, gap: 3 },
    ampmBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
    ampmText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: colors.mutedForeground },
    timePreview: { fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: 4, marginLeft: 2 },
    segmentRow: { flexDirection: 'row', backgroundColor: colors.muted, borderRadius: 12, padding: 4, gap: 4 },
    segment: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
    segmentText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: colors.mutedForeground },
    input: { backgroundColor: colors.input, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular', color: colors.foreground },
    multiline: { height: 80, textAlignVertical: 'top' },
    saveBtn: { borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
    saveBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
  });
}
