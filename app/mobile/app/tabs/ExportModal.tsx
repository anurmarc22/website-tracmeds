import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import DateInputDDMMYYYY from '@/components/DateInputDDMMYYYY';
import { useApp } from '@/context/AppContext';
import { objectArrayToCsv } from '@/utils/csv';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useColors } from '@/hooks/useColors';
import { formatTime12 } from '@/utils/time';
import { useSubscription } from '@/context/SubscriptionContext';

function isoFromDdMmYyyy(ddmmyyyy: string) {
  if (!ddmmyyyy) return '';
  const parts = ddmmyyyy.split('/').map(p => Number(p));
  if (parts.length !== 3) return '';
  const [d, m, y] = parts;
  return `${y.toString().padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

export default function ExportModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const { appointments, healthLogs, medicines, doseLog, profile } = useApp();
  const { isPro } = useSubscription();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeAppointments, setIncludeAppointments] = useState(true);
  const [includeHealthLogs, setIncludeHealthLogs] = useState(true);
  const [includeMedicines, setIncludeMedicines] = useState(false);
  const [includeDoseLog, setIncludeDoseLog] = useState(false);

  function between(dateStr: string, fromIso: string, toIso: string) {
    if (!dateStr) return false;
    if (!fromIso && !toIso) return true;
    if (fromIso && dateStr < fromIso) return false;
    if (toIso && dateStr > toIso) return false;
    return true;
  }

  const buildRows = (fromIso: string, toIso: string) => {
    const rows: Record<string, any>[] = [];

    if (includeAppointments) {
      appointments.filter(a => between(a.date, fromIso, toIso)).forEach(a => {
        rows.push({ category: 'appointment', date: a.date, title: a.title, time: a.time, notes: a.notes || '' });
      });
    }
    if (includeHealthLogs) {
      healthLogs.filter(h => between(h.date, fromIso, toIso)).forEach(h => {
        rows.push({ category: 'health_log', date: h.date, type: h.type, value1: h.value1, value2: h.value2, label: h.label || '', notes: h.notes || '' });
      });
    }
    if (includeDoseLog) {
      doseLog.filter(d => between(d.date, fromIso, toIso)).forEach(d => {
        rows.push({ category: 'dose', date: d.date, medicineId: d.medicineId, time: d.time, status: d.status });
      });
    }
    if (includeMedicines) {
      // include medicines that were active or have endDate in range
      medicines.forEach(m => {
        const created = (m.createdAt || '').split('T')[0];
        const end = m.endDate || '';
        const activeDuring = (!fromIso && !toIso) || (!end || end >= fromIso) || (created >= fromIso && created <= toIso);
        if (activeDuring) rows.push({ category: 'medicine', name: m.name, dosage: m.dosage, unit: m.unit, frequency: m.frequency, times: (m.times || []).join(','), endDate: m.endDate || '' });
      });
    }

    return rows;
  };

  const exportCsv = async () => {
    const fromIso = isoFromDdMmYyyy(from);
    const toIso = isoFromDdMmYyyy(to);
    const rows = buildRows(fromIso, toIso);
    if (rows.length === 0) { Alert.alert('No records', 'No records found for the selected date range and categories.'); return; }
    const csv = objectArrayToCsv(rows);
    try {
      const fileName = `tracmeds-export-${from || 'all'}-${to || 'all'}.csv`;
      const fileUri = FileSystem.cacheDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (Platform.OS === 'web') {
        // fallback: open CSV in new tab
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } else {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv' });
      }

      // send a report entry to the server for bookkeeping
      try {
        const resp = await fetch('https://website-tracmeds-backend-on-render.onrender.com/api/append-report', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user: profile.name, from: fromIso, to: toIso, categories: ['appointments', 'healthLogs', 'medicines', 'doseLog'].filter((_,i) => [includeAppointments, includeHealthLogs, includeMedicines, includeDoseLog][i]), rowCount: rows.length, summary: `CSV export with ${rows.length} rows` }),
        });
        // ignore response
      } catch (err) {
        // non-blocking
      }

    } catch (err: any) {
      Alert.alert('Export failed', err?.message || 'Unable to export CSV');
    }
  };

  const sendMessage = () => {
    const fromIso = isoFromDdMmYyyy(from);
    const toIso = isoFromDdMmYyyy(to);
    const rows = buildRows(fromIso, toIso);
    if (rows.length === 0) { Alert.alert('No records', 'No records found for the selected date range and categories.'); return; }

    // build a short formatted message
    let msg = `*Tracmeds Report*\n`;
    if (profile.name) msg += `for ${profile.name}\n`;
    msg += `From: ${from || 'any'} To: ${to || 'any'}\n`;
    msg += `Included: ${[includeAppointments ? 'appointments' : null, includeHealthLogs ? 'health logs' : null, includeMedicines ? 'medicines' : null, includeDoseLog ? 'dose log' : null].filter(Boolean).join(', ')}\n\n`;

    let count = 0;
    if (includeAppointments) {
      const items = appointments.filter(a => between(a.date, fromIso, toIso));
      if (items.length) {
        msg += `📅 Appointments:\n`;
        items.forEach(i => { msg += `• ${i.date} ${i.time} — ${i.title}\n`; });
        msg += `\n`;
        count += items.length;
      }
    }
    if (includeHealthLogs) {
      const items = healthLogs.filter(h => between(h.date, fromIso, toIso));
      if (items.length) {
        msg += `❤️ Health readings:\n`;
        items.forEach(i => { msg += `• ${i.date} — ${i.type}: ${i.value1 ?? ''}${i.value2 ? `/${i.value2}` : ''} ${i.label ?? ''}\n`; });
        msg += `\n`;
        count += items.length;
      }
    }
    if (includeDoseLog) {
      const items = doseLog.filter(d => between(d.date, fromIso, toIso));
      if (items.length) {
        msg += `⏱️ Dose log:\n`;
        items.forEach(i => { msg += `• ${i.date} ${i.time} — ${i.status}\n`; });
        msg += `\n`;
        count += items.length;
      }
    }
    if (includeMedicines) {
      const items = medicines.filter(m => {
        const created = (m.createdAt || '').split('T')[0];
        const end = m.endDate || '';
        const activeDuring = (!fromIso && !toIso) || (!end || end >= fromIso) || (created >= fromIso && created <= toIso);
        return activeDuring;
      });
      if (items.length) {
        msg += `💊 Medicines:\n`;
        items.forEach(m => { msg += `• ${m.name} — ${m.dosage} ${m.unit} (${(m.times||[]).map(t=>formatTime12(t)).join(',')})\n`; });
        msg += `\n`;
        count += items.length;
      }
    }

    msg += `_Report generated by Tracmeds_`;

    // share via WhatsApp or email via OS share sheet
    // If there are many rows, recommend CSV; otherwise open share sheet with the message text
    if (rows.length > 40) {
      Alert.alert('Large report', 'This report is large — export as CSV for best results.');
      return;
    }

    const encoded = encodeURIComponent(msg);
    if (Platform.OS === 'web') {
      // open WhatsApp web
      window.open(`https://wa.me/?text=${encoded}`, '_blank');
    } else {
      // Use share sheet to allow WhatsApp/email/etc
      const shareOptions = { dialogTitle: 'Share Tracmeds report', mimeType: 'text/plain' } as any;
      // attempt to use expo-sharing on mobile by writing a small text file and sharing it
      (async () => {
        try {
          const fileName = `tracmeds-report-${from || 'all'}-${to || 'all'}.txt`;
          const fileUri = FileSystem.cacheDirectory + fileName;
          await FileSystem.writeAsStringAsync(fileUri, msg, { encoding: FileSystem.EncodingType.UTF8 });
          await Sharing.shareAsync(fileUri, shareOptions);

          // send a bookkeeping entry
          try {
            await fetch('https://website-tracmeds-backend-on-render.onrender.com/api/append-report', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user: profile.name, from: fromIso, to: toIso, categories: ['appointments', 'healthLogs', 'medicines', 'doseLog'].filter((_,i) => [includeAppointments, includeHealthLogs, includeMedicines, includeDoseLog][i]), rowCount: rows.length, summary: `Message share with ${rows.length} rows` }),
            });
          } catch (err) { }

        } catch (err: any) {
          Alert.alert('Share failed', err?.message || 'Unable to share report');
        }
      })();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '80%' }}>
          <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: colors.foreground }}>Export & Share Records</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>Choose a date range and which categories to include.</Text>

          <View style={{ marginTop: 12 }}>
            <Text style={{ color: colors.mutedForeground, marginBottom: 8 }}>From</Text>
            <DateInputDDMMYYYY value={from} onChange={setFrom} />
            <Text style={{ color: colors.mutedForeground, marginVertical: 8 }}>To</Text>
            <DateInputDDMMYYYY value={to} onChange={setTo} />

            <View style={{ marginTop: 12 }}>
              <TouchableOpacity onPress={() => setIncludeAppointments(s => !s)} style={{ paddingVertical: 8 }}>
                <Text style={{ color: includeAppointments ? colors.foreground : colors.mutedForeground }}>🗓️ Appointments</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setIncludeHealthLogs(s => !s)} style={{ paddingVertical: 8 }}>
                <Text style={{ color: includeHealthLogs ? colors.foreground : colors.mutedForeground }}>❤️ Health readings</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setIncludeDoseLog(s => !s)} style={{ paddingVertical: 8 }}>
                <Text style={{ color: includeDoseLog ? colors.foreground : colors.mutedForeground }}>⏱️ Dose log</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setIncludeMedicines(s => !s)} style={{ paddingVertical: 8 }}>
                <Text style={{ color: includeMedicines ? colors.foreground : colors.mutedForeground }}>💊 Medicines (active/created in range)</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <TouchableOpacity style={{ flex: 1, backgroundColor: colors.primary, padding: 12, borderRadius: 12, alignItems: 'center' }} onPress={exportCsv}>
                <Text style={{ color: '#fff', fontFamily: 'Inter_700Bold' }}>Export CSV</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, backgroundColor: '#25D366', padding: 12, borderRadius: 12, alignItems: 'center' }} onPress={sendMessage}>
                <Text style={{ color: '#fff', fontFamily: 'Inter_700Bold' }}>Share Message</Text>
              </TouchableOpacity>
            </View>

            <View style={{ marginTop: 12 }}>
              <TouchableOpacity style={{ alignItems: 'center' }} onPress={onClose}><Text style={{ color: colors.mutedForeground }}>Close</Text></TouchableOpacity>
            </View>

          </View>
        </View>
      </View>
    </Modal>
  );
}
