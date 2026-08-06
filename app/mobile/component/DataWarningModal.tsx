import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function DataWarningModal({
  visible,
  onClose,
  onOpenExport,
}: {
  visible: boolean;
  onClose: () => void;
  onOpenExport: () => void;
}) {
  const colors = useColors();
  const s = styles(colors);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.headerRow}>
            <View style={s.iconWrap}>
              <Ionicons name="warning-outline" size={24} color="#F59E0B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Before you reinstall or switch phones</Text>
              <Text style={s.subtitle}>Your data stays on this device unless you export a backup first.</Text>
            </View>
          </View>

          <View style={s.body}>
            <Text style={s.bulletText}>• Medicines, appointments, and health logs are stored only on this device and are not backed up automatically.</Text>
            <Text style={s.bulletText}>• Before reinstalling the app or switching phones, export a backup using Export CSV. Reinstalling or changing phones will permanently erase this data from the device.</Text>
            <Text style={s.bulletText}>• Your subscription (family sharing access) can usually be restored on a new device or after reinstalling, but only up to 3 total devices. After that, restoring will no longer work and you will need to purchase a new subscription.</Text>
          </View>

          <View style={s.actions}>
            <TouchableOpacity style={[s.button, s.secondaryButton]} onPress={onClose}>
              <Text style={s.secondaryText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.button, s.primaryButton]} onPress={() => { onOpenExport(); }}>
              <Text style={s.primaryText}>Export CSV</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function styles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 20,
      gap: 12,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    iconWrap: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: '#F59E0B15',
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: 18,
      fontFamily: 'Inter_700Bold',
      color: colors.foreground,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 13,
      fontFamily: 'Inter_400Regular',
      color: colors.mutedForeground,
      lineHeight: 20,
    },
    body: {
      gap: 8,
      paddingVertical: 4,
    },
    bulletText: {
      fontSize: 14,
      fontFamily: 'Inter_400Regular',
      color: colors.foreground,
      lineHeight: 20,
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 4,
    },
    button: {
      flex: 1,
      borderRadius: 12,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButton: {
      backgroundColor: colors.muted,
    },
    primaryButton: {
      backgroundColor: colors.primary,
    },
    secondaryText: {
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
      color: colors.foreground,
    },
    primaryText: {
      fontSize: 14,
      fontFamily: 'Inter_600SemiBold',
      color: '#fff',
    },
  });
}
