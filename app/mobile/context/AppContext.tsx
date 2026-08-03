import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appointment, HealthLog, Medicine, NotificationContact, UserProfile, DailyReportSettings, DoseRecord } from '@/types';
import { formatTime12 } from '@/utils/time';
import {
  scheduleDailyReportReminder,
  cancelDailyReportReminder,
  scheduleMedicineReminders,
  cancelMedicineReminders,
} from '@/utils/notifications';
import { useSubscription } from '@/context/SubscriptionContext';

const KEYS = {
  TERMS: 'tracmeds_terms_v2',
  APPOINTMENTS: 'tracmeds_appointments_v2',
  HEALTH_LOGS: 'tracmeds_health_logs_v2',
  MEDICINES: 'tracmeds_medicines_v2',
  CONTACTS: 'tracmeds_contacts_v2',
  PROFILE: 'tracmeds_profile_v2',
  REPORT_SETTINGS: 'tracmeds_report_settings_v1',
  DOSE_LOG: 'tracmeds_dose_log_v1',
};

const DEFAULT_REPORT_SETTINGS: DailyReportSettings = {
  medicines: false,
  appointments: false,
  healthLogs: false,
  time: '20:00', // 8:00 PM
  contactIds: [],
};

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

interface AppContextValue {
  isLoading: boolean;
  hasAcceptedTerms: boolean;
  acceptTerms: () => Promise<void>;

  // Appointments
  appointments: Appointment[];
  addAppointment: (a: Omit<Appointment, 'id' | 'createdAt'>) => Promise<void>;
  updateAppointment: (id: string, a: Partial<Appointment>) => Promise<void>;
  deleteAppointment: (id: string) => Promise<void>;

  // Health logs
  healthLogs: HealthLog[];
  addHealthLog: (l: Omit<HealthLog, 'id' | 'createdAt'>) => Promise<void>;
  deleteHealthLog: (id: string) => Promise<void>;

  // Medicines
  medicines: Medicine[];
  addMedicine: (m: Omit<Medicine, 'id' | 'createdAt'>) => Promise<void>;
  updateMedicine: (id: string, m: Partial<Medicine>) => Promise<void>;
  deleteMedicine: (id: string) => Promise<void>;
  toggleMedicineActive: (id: string) => Promise<void>;

  // Notification contacts
  contacts: NotificationContact[];
  addContact: (c: Omit<NotificationContact, 'id'>) => Promise<void>;
  updateContact: (id: string, c: Partial<NotificationContact>) => Promise<void>;
  deleteContact: (id: string) => Promise<void>;

  // Profile
  profile: UserProfile;
  updateProfile: (p: Partial<UserProfile>) => Promise<void>;

  // WhatsApp
  shareViaWhatsApp: (phone: string, message: string) => void;
  shareAppointmentToContacts: (appt: Appointment, contactIds: string[]) => void;
  shareMedicineToContacts: (med: Medicine, contactIds: string[]) => void;
  shareHealthLogToContacts: (log: HealthLog, contactIds: string[]) => void;

  // Daily family report
  reportSettings: DailyReportSettings;
  updateReportSettings: (s: Partial<DailyReportSettings>) => Promise<void>;
  buildDailyReportMessage: () => string;
  sendDailyReport: (contactIds?: string[]) => void;
  doseLog: DoseRecord[];
  markDoseStatus: (medicineId: string, time: string, status: DoseRecord['status']) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { isPro } = useSubscription();
  const [isLoading, setIsLoading] = useState(true);
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [contacts, setContacts] = useState<NotificationContact[]>([]);
  const [profile, setProfile] = useState<UserProfile>({ name: '' });
  const [reportSettings, setReportSettings] = useState<DailyReportSettings>(DEFAULT_REPORT_SETTINGS);
  const [doseLog, setDoseLog] = useState<DoseRecord[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [terms, appts, logs, meds, ctcts, prof, reportCfg, doseLogData] = await Promise.all([
          AsyncStorage.getItem(KEYS.TERMS),
          AsyncStorage.getItem(KEYS.APPOINTMENTS),
          AsyncStorage.getItem(KEYS.HEALTH_LOGS),
          AsyncStorage.getItem(KEYS.MEDICINES),
          AsyncStorage.getItem(KEYS.CONTACTS),
          AsyncStorage.getItem(KEYS.PROFILE),
          AsyncStorage.getItem(KEYS.REPORT_SETTINGS),
          AsyncStorage.getItem(KEYS.DOSE_LOG),
        ]);
        setHasAcceptedTerms(terms === 'true');
        if (appts) setAppointments(JSON.parse(appts));
        if (logs) setHealthLogs(JSON.parse(logs));
        if (meds) setMedicines(JSON.parse(meds));
        if (ctcts) setContacts(JSON.parse(ctcts));
        if (prof) setProfile(JSON.parse(prof));
        if (reportCfg) setReportSettings({ ...DEFAULT_REPORT_SETTINGS, ...JSON.parse(reportCfg) });
        if (doseLogData) setDoseLog(JSON.parse(doseLogData));
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Keep each medicine's scheduled dose reminders in sync with its data
  // (times, active state, end date). Runs on load and whenever medicines change.
  useEffect(() => {
    if (isLoading) return;
    medicines.forEach(m => { scheduleMedicineReminders(m); });
  }, [isLoading, medicines]);

  // Keep the scheduled local reminder in sync with the user's report settings
  useEffect(() => {
    if (isLoading) return;
    const anyEnabled = isPro && (reportSettings.medicines || reportSettings.appointments || reportSettings.healthLogs);
    if (anyEnabled) {
      scheduleDailyReportReminder(reportSettings.time);
    } else {
      cancelDailyReportReminder();
    }
  }, [isLoading, isPro, reportSettings.medicines, reportSettings.appointments, reportSettings.healthLogs, reportSettings.time]);

  const acceptTerms = useCallback(async () => {
    await AsyncStorage.setItem(KEYS.TERMS, 'true');
    setHasAcceptedTerms(true);
  }, []);

  // Appointments
  const addAppointment = useCallback(async (data: Omit<Appointment, 'id' | 'createdAt'>) => {
    const item: Appointment = { ...data, id: genId(), createdAt: new Date().toISOString() };
    setAppointments(prev => {
      const updated = [...prev, item].sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
      AsyncStorage.setItem(KEYS.APPOINTMENTS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateAppointment = useCallback(async (id: string, data: Partial<Appointment>) => {
    setAppointments(prev => {
      const updated = prev.map(a => a.id === id ? { ...a, ...data } : a);
      AsyncStorage.setItem(KEYS.APPOINTMENTS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteAppointment = useCallback(async (id: string) => {
    setAppointments(prev => {
      const updated = prev.filter(a => a.id !== id);
      AsyncStorage.setItem(KEYS.APPOINTMENTS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Health logs
  const addHealthLog = useCallback(async (data: Omit<HealthLog, 'id' | 'createdAt'>) => {
    const item: HealthLog = { ...data, id: genId(), createdAt: new Date().toISOString() };
    setHealthLogs(prev => {
      const updated = [item, ...prev];
      AsyncStorage.setItem(KEYS.HEALTH_LOGS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteHealthLog = useCallback(async (id: string) => {
    setHealthLogs(prev => {
      const updated = prev.filter(l => l.id !== id);
      AsyncStorage.setItem(KEYS.HEALTH_LOGS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Medicines
  const addMedicine = useCallback(async (data: Omit<Medicine, 'id' | 'createdAt'>) => {
    const item: Medicine = { ...data, id: genId(), createdAt: new Date().toISOString() };
    setMedicines(prev => {
      const updated = [item, ...prev];
      AsyncStorage.setItem(KEYS.MEDICINES, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateMedicine = useCallback(async (id: string, data: Partial<Medicine>) => {
    setMedicines(prev => {
      const updated = prev.map(m => m.id === id ? { ...m, ...data } : m);
      AsyncStorage.setItem(KEYS.MEDICINES, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteMedicine = useCallback(async (id: string) => {
    cancelMedicineReminders(id);
    setMedicines(prev => {
      const updated = prev.filter(m => m.id !== id);
      AsyncStorage.setItem(KEYS.MEDICINES, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const toggleMedicineActive = useCallback(async (id: string) => {
    setMedicines(prev => {
      const updated = prev.map(m => m.id === id ? { ...m, active: !m.active } : m);
      AsyncStorage.setItem(KEYS.MEDICINES, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Contacts
  const addContact = useCallback(async (data: Omit<NotificationContact, 'id'>) => {
    const item: NotificationContact = { ...data, id: genId() };
    setContacts(prev => {
      const updated = [...prev, item];
      AsyncStorage.setItem(KEYS.CONTACTS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateContact = useCallback(async (id: string, data: Partial<NotificationContact>) => {
    setContacts(prev => {
      const updated = prev.map(c => c.id === id ? { ...c, ...data } : c);
      AsyncStorage.setItem(KEYS.CONTACTS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const deleteContact = useCallback(async (id: string) => {
    setContacts(prev => {
      const updated = prev.filter(c => c.id !== id);
      AsyncStorage.setItem(KEYS.CONTACTS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Profile
  const updateProfile = useCallback(async (data: Partial<UserProfile>) => {
    setProfile(prev => {
      const updated = { ...prev, ...data };
      AsyncStorage.setItem(KEYS.PROFILE, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Daily report settings
  const updateReportSettings = useCallback(async (data: Partial<DailyReportSettings>) => {
    setReportSettings(prev => {
      const updated = { ...prev, ...data };
      AsyncStorage.setItem(KEYS.REPORT_SETTINGS, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const todayISO = () => new Date().toISOString().split('T')[0];

  const markDoseStatus = useCallback((medicineId: string, time: string, status: DoseRecord['status']) => {
    setDoseLog(prev => {
      const date = todayISO();
      const withoutExisting = prev.filter(d => !(d.medicineId === medicineId && d.date === date && d.time === time));
      const updated: DoseRecord[] = [
        ...withoutExisting,
        { medicineId, date, time, status, recordedAt: new Date().toISOString() },
      ];
      AsyncStorage.setItem(KEYS.DOSE_LOG, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Listens for taps on the "Taken" / "Snooze" buttons on a dose reminder notification
  // and logs the result locally (see utils/notifications.ts for why this stays on-device).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let subscription: { remove: () => void } | undefined;
    (async () => {
      try {
        const Notifications = await import('expo-notifications');
        subscription = Notifications.addNotificationResponseReceivedListener(response => {
          const data = response.notification.request.content.data as { medicineId?: string; time?: string } | undefined;
          if (!data?.medicineId || !data?.time) return;
          if (response.actionIdentifier === 'TAKEN') {
            markDoseStatus(data.medicineId, data.time, 'taken');
          } else if (response.actionIdentifier === 'SNOOZE') {
            markDoseStatus(data.medicineId, data.time, 'snoozed');
          }
        });
      } catch {
        // expo-notifications unavailable — nothing to listen to
      }
    })();
    return () => subscription?.remove();
  }, [markDoseStatus]);

  const buildDailyReportMessage = useCallback((): string => {
    const today = todayISO();
    let msg = `🗓️ *Tracmeds Daily Report*\n${profile.name ? `for ${profile.name}\n` : ''}\n`;
    let hasContent = false;

    if (reportSettings.medicines) {
      const active = medicines.filter(m => m.active);
      msg += `💊 *Medicines* (${active.length} active)\n`;
      if (active.length > 0) {
        active.forEach(m => {
          const times = m.times.length > 0 ? m.times.map(formatTime12).join(', ') : '';
          msg += `• ${m.name} — ${m.dosage} ${m.unit}${times ? ` (${times})` : ''}\n`;
        });
      } else {
        msg += `No active medicines.\n`;
      }

      // Missed doses today: any scheduled time already passed with no "taken" log.
      const nowHM = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
      const missed: string[] = [];
      active.forEach(m => {
        m.times.forEach(t => {
          if (t > nowHM) return; // hasn't happened yet today
          const logged = doseLog.some(d => d.medicineId === m.id && d.date === today && d.time === t && d.status === 'taken');
          if (!logged) missed.push(`${m.name} (${formatTime12(t)})`);
        });
      });
      if (missed.length > 0) {
        msg += `⚠️ *Not marked as taken today:* ${missed.join(', ')}\n`;
      }
      msg += `\n`;
      hasContent = true;
    }

    if (reportSettings.appointments) {
      const upcoming = appointments
        .filter(a => new Date(a.date) >= new Date(today))
        .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`))
        .slice(0, 3);
      msg += `📅 *Upcoming Appointments*\n`;
      if (upcoming.length > 0) {
        upcoming.forEach(a => {
          const reportLine = a.report ? `\n  Report: ${a.report}` : '';
          msg += `• ${a.title} — ${a.date} at ${formatTime12(a.time)}${reportLine}\n`;
        });
      } else {
        msg += `No upcoming appointments.\n`;
      }
      msg += `\n`;
      hasContent = true;
    }

    if (reportSettings.healthLogs) {
      const todaysLogs = healthLogs.filter(l => l.date === today);
      msg += `❤️ *Today's Readings*\n`;
      if (todaysLogs.length > 0) {
        todaysLogs.forEach(l => {
          const val = l.type === 'bp' ? `${l.value1}/${l.value2} mmHg` : `${l.value1 ?? ''} ${l.label ?? ''}`.trim();
          msg += `• ${l.type.replace('_', ' ')}: ${val}\n`;
        });
      } else {
        msg += `No readings logged today.\n`;
      }
      msg += `\n`;
      hasContent = true;
    }

    if (!hasContent) msg += `No categories selected for this report.\n`;
    msg += `_Sent via Tracmeds_`;
    return msg;
  }, [reportSettings, medicines, appointments, healthLogs, profile.name, doseLog]);

  // WhatsApp helpers
  const shareViaWhatsApp = useCallback((phone: string, message: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const encoded = encodeURIComponent(message);
    const url = Platform.OS === 'web'
      ? `https://wa.me/${cleanPhone}?text=${encoded}`
      : `whatsapp://send?phone=${cleanPhone}&text=${encoded}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('WhatsApp Not Available', 'Please install WhatsApp or check the phone number.');
    });
  }, []);

  const shareAppointmentToContacts = useCallback((appt: Appointment, contactIds: string[]) => {
    const [y, mo, d] = appt.date.split('-').map(Number);
    const dateStr = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
    const [h, m] = appt.time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const timeStr = `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
    const typeLabel = appt.type === 'doctor' ? 'Doctor Visit' : 'Diagnostic Test';
    let msg = `📅 *Tracmeds Appointment Reminder*\n\n`;
    msg += `*${appt.title}*\n`;
    msg += `Type: ${typeLabel}\n`;
    if (appt.specialty) msg += `Specialty: ${appt.specialty}\n`;
    if (appt.facility) msg += `Facility: ${appt.facility}\n`;
    msg += `Date: ${dateStr}\n`;
    msg += `Time: ${timeStr}\n`;
    if (appt.notes) msg += `\nNotes: ${appt.notes}\n`;
    if (appt.report) msg += `\nReport: ${appt.report}\n`;
    msg += `\n_Sent via Tracmeds_`;

    const targetContacts = contacts.filter(c => contactIds.includes(c.id));
    if (targetContacts.length === 0) {
      Alert.alert('No Contacts', 'Please add notification contacts in your Profile first.');
      return;
    }
    targetContacts.forEach(contact => shareViaWhatsApp(contact.phone, msg));
  }, [contacts, shareViaWhatsApp]);

  const shareMedicineToContacts = useCallback((med: Medicine, contactIds: string[]) => {
    const freqLabel: Record<string, string> = {
      once: 'Once', daily: 'Once daily', twice_daily: 'Twice daily',
      three_times: '3 times daily', weekly: 'Weekly', as_needed: 'As needed',
    };
    let msg = `💊 *Tracmeds Medicine Reminder*\n\n`;
    msg += `*${med.name}*\n`;
    msg += `Dosage: ${med.dosage} ${med.unit}\n`;
    msg += `Frequency: ${freqLabel[med.frequency] ?? med.frequency}\n`;
    if (med.times.length > 0) {
      const fmtTime = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
      };
      msg += `Schedule: ${med.times.map(fmtTime).join(', ')}\n`;
    }
    if (med.endDate) msg += `Until: ${med.endDate}\n`;
    if (med.notes) msg += `\nNotes: ${med.notes}\n`;
    msg += `\n_Sent via Tracmeds_`;

    const targetContacts = contacts.filter(c => contactIds.includes(c.id));
    if (targetContacts.length === 0) {
      Alert.alert('No Contacts', 'Please add notification contacts in your Profile first.');
      return;
    }
    targetContacts.forEach(contact => shareViaWhatsApp(contact.phone, msg));
  }, [contacts, shareViaWhatsApp]);

  const shareHealthLogToContacts = useCallback((log: HealthLog, contactIds: string[]) => {
    const [y, mo, d] = log.date.split('-').map(Number);
    const dateStr = `${String(d).padStart(2, '0')}/${String(mo).padStart(2, '0')}/${y}`;
    const typeLabels: Record<string, string> = {
      bp: 'Blood Pressure', heart_rate: 'Heart Rate',
      blood_sugar: 'Blood Sugar', menstrual: 'Menstrual Cycle',
      weight: 'Weight', temperature: 'Temperature',
    };
    let valueStr = '';
    if (log.type === 'bp') valueStr = `${log.value1}/${log.value2} mmHg`;
    else if (log.type === 'heart_rate') valueStr = `${log.value1} BPM`;
    else if (log.type === 'blood_sugar') valueStr = `${log.value1} mg/dL${log.label ? ` (${log.label})` : ''}`;
    else if (log.type === 'menstrual') valueStr = log.label ?? `Day ${log.value1}`;
    else if (log.type === 'weight') valueStr = `${log.value1} ${log.label ?? 'kg'}`;
    else if (log.type === 'temperature') valueStr = `${log.value1}${log.label ?? '°C'}`;

    let msg = `❤️ *Tracmeds Health Update*\n\n`;
    msg += `*${typeLabels[log.type] ?? log.type}*\n`;
    msg += `Reading: ${valueStr}\n`;
    msg += `Date: ${dateStr}\n`;
    if (log.notes) msg += `\nNotes: ${log.notes}\n`;
    msg += `\n_Sent via Tracmeds_`;

    const targetContacts = contacts.filter(c => contactIds.includes(c.id));
    if (targetContacts.length === 0) {
      Alert.alert('No Contacts', 'Please add notification contacts in your Profile first.');
      return;
    }
    targetContacts.forEach(contact => shareViaWhatsApp(contact.phone, msg));
  }, [contacts, shareViaWhatsApp]);

  const sendDailyReport = useCallback((contactIdsOverride?: string[]) => {
    if (!isPro) {
      Alert.alert('Subscription required', 'Your plan has expired. Renew to send daily family reports.');
      return;
    }
    const ids = contactIdsOverride ?? reportSettings.contactIds;
    const targetContacts = contacts.filter(c => ids.includes(c.id));
    if (targetContacts.length === 0) {
      Alert.alert('No Recipients', 'Choose who should receive the daily report in Profile.');
      return;
    }
    const msg = buildDailyReportMessage();
    targetContacts.forEach(contact => shareViaWhatsApp(contact.phone, msg));
  }, [isPro, contacts, reportSettings.contactIds, buildDailyReportMessage, shareViaWhatsApp]);

  return (
    <AppContext.Provider value={{
      isLoading,
      hasAcceptedTerms,
      acceptTerms,
      appointments,
      addAppointment,
      updateAppointment,
      deleteAppointment,
      healthLogs,
      addHealthLog,
      deleteHealthLog,
      medicines,
      addMedicine,
      updateMedicine,
      deleteMedicine,
      toggleMedicineActive,
      contacts,
      addContact,
      updateContact,
      deleteContact,
      profile,
      updateProfile,
      shareViaWhatsApp,
      shareAppointmentToContacts,
      shareMedicineToContacts,
      shareHealthLogToContacts,
      reportSettings,
      updateReportSettings,
      buildDailyReportMessage,
      sendDailyReport,
      doseLog,
      markDoseStatus,
    }}>
      {children}
    </AppContext.Provider>
  );
}
