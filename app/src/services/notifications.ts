import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  return true;
}

export async function getPushToken(): Promise<string | null> {
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch {
    return null;
  }
}

export function scheduleLocalNotification(title: string, body: string): void {
  Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

export function scheduleLocalNotificationDelayed(title: string, body: string, seconds: number): void {
  if (seconds <= 0) {
    scheduleLocalNotification(title, body);
    return;
  }
  Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.round(seconds),
    },
  }).catch(() => {});
}

export function formatMinutesUntil(untilIso: string | undefined): string {
  if (!untilIso) return '';
  const ms = new Date(untilIso).getTime() - Date.now();
  if (ms <= 0) return '0 min';
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins} min`;
}
