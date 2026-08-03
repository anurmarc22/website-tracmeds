import React, { useEffect, useRef } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import { AppProvider, useApp } from '@/context/AppContext';
import { SubscriptionProvider } from '@/context/SubscriptionContext';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map((n) => parseInt(n, 10) || 0);
  const bParts = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i += 1) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function RootLayoutNav() {
  const { hasAcceptedTerms, isLoading } = useApp();
  const router = useRouter();
  const hasCheckedForUpdate = useRef(false);

  // Terms gate: route to /terms if not accepted, back to tabs once accepted
  useEffect(() => {
    if (isLoading) return;
    if (hasAcceptedTerms) {
      router.replace('/(tabs)');
    } else {
      router.replace('/terms');
    }
  }, [isLoading, hasAcceptedTerms]);

  useEffect(() => {
    if (isLoading || !hasAcceptedTerms || Platform.OS !== 'android' || hasCheckedForUpdate.current) return;
    hasCheckedForUpdate.current = true;

    const checkForApkUpdate = async () => {
      try {
        const expoConfig = Constants.expoConfig;
        const extra = expoConfig?.extra as { apkUpdate?: { manifestUrl?: string; fallbackDownloadUrl?: string } } | undefined;
        const manifestUrl = extra?.apkUpdate?.manifestUrl;
        const fallbackDownloadUrl = extra?.apkUpdate?.fallbackDownloadUrl || 'https://www.tracmeds.com/download.html';
        if (!manifestUrl) return;

        const response = await fetch(manifestUrl, { method: 'GET' });
        if (!response.ok) return;
        const payload = await response.json() as {
          version?: string;
          versionCode?: number;
          downloadUrl?: string;
          force?: boolean;
        };

        const localVersion = expoConfig?.version || '0.0.0';
        const localVersionCode = expoConfig?.android?.versionCode || 0;
        const remoteVersion = payload.version || localVersion;
        const remoteVersionCode = typeof payload.versionCode === 'number' ? payload.versionCode : localVersionCode;

        const hasNewerVersionCode = remoteVersionCode > localVersionCode;
        const hasNewerVersion = compareVersions(remoteVersion, localVersion) > 0;
        if (!hasNewerVersionCode && !hasNewerVersion) return;

        const targetUrl = payload.downloadUrl || fallbackDownloadUrl;
        const openUpdate = () => {
          Linking.openURL(targetUrl).catch(() => {
            Alert.alert('Update link failed', 'Please open tracmeds.com and download the latest APK manually.');
          });
        };

        if (payload.force) {
          Alert.alert(
            'Update required',
            `A newer TracMeds version (${remoteVersion}) is available. Please update to continue.`,
            [{ text: 'Update now', onPress: openUpdate }],
            { cancelable: false },
          );
          return;
        }

        Alert.alert(
          'Update available',
          `A newer TracMeds version (${remoteVersion}) is available. Download the latest APK from the website?`,
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Update now', onPress: openUpdate },
          ],
          { cancelable: true },
        );
      } catch {
        // Non-blocking; if update check fails the app should continue normally.
      }
    };

    checkForApkUpdate();
  }, [isLoading, hasAcceptedTerms]);

  if (isLoading) return null;

  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="terms" options={{ headerShown: false, gestureEnabled: false }} />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SubscriptionProvider>
      <AppProvider>
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </AppProvider>
    </SubscriptionProvider>
  );
}
