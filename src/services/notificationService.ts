/**
 * Notification Service
 * Handles push notification registration and management using Expo Notifications
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { firestoreService } from './firestoreService';

// Dynamically import expo-notifications to handle cases where native module isn't available
let Notifications: typeof import('expo-notifications') | null = null;
let Device: typeof import('expo-device') | null = null;

// Track if native modules are available
let isNativeModuleAvailable = false;

// Detect Expo Go — skip requiring expo-notifications entirely since SDK 53 removed support
const isExpoGo = Constants.appOwnership === 'expo';

if (isExpoGo) {
  // Push notifications not supported in Expo Go
} else {
  try {
    Notifications = require('expo-notifications');
    Device = require('expo-device');

    Notifications!.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });

    isNativeModuleAvailable = true;
  } catch (error) {
    Notifications = null;
    Device = null;
    isNativeModuleAvailable = false;
  }
}

class NotificationService {
  private expoPushToken: string | null = null;
  private notificationListener: any = null;
  private responseListener: any = null;

  /**
   * Check if push notifications are available
   */
  isAvailable(): boolean {
    return isNativeModuleAvailable;
  }

  /**
   * Get a unique device identifier
   */
  private getDeviceId(): string {
    if (!Device) {
      return `${Platform.OS}-unknown-device`;
    }
    // Use a combination of device properties to create a unique ID
    const deviceName = Device.deviceName || 'unknown';
    const osName = Device.osName || Platform.OS;
    const osVersion = Device.osVersion || 'unknown';
    // Create a simple hash-like ID
    return `${osName}-${deviceName}-${osVersion}`.replace(/\s+/g, '-').toLowerCase();
  }

  /**
   * The device's IANA timezone, sent up with the token.
   *
   * Server-side schedulers all run on Australia/Sydney, which lands a
   * Sydney-morning reminder on a Perth phone two to three hours early. Storing
   * the real zone lets the send path hold nudges until the tradie's own
   * daytime.
   */
  private getTimezone(): string | null {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }

  /**
   * Create the Android channels. Separating these means a tradie can silence
   * reminders in the OS without also silencing "you've been paid" — with a
   * single shared channel, muting one meant muting everything.
   */
  private async ensureAndroidChannels(): Promise<void> {
    if (Platform.OS !== 'android' || !Notifications) return;

    await Notifications.setNotificationChannelAsync('money', {
      name: 'Payments & accepted quotes',
      description: 'A customer accepted a quote, or money landed.',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#f97316',
    });

    await Notifications.setNotificationChannelAsync('quote-responses', {
      name: 'Quote activity',
      description: 'A customer opened or declined your quote.',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#f97316',
    });

    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Reminders',
      description: 'Overdue invoices, expiring quotes and unsent drafts.',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#f97316',
    });

    // The one push a tradie explicitly waits for: Mate finished pricing the
    // quote they locked the phone on. Its own channel so muting reminders
    // never mutes it.
    await Notifications.setNotificationChannelAsync('quote-ready', {
      name: 'Quotes ready to send',
      description: 'Mate finished pricing a quote you were waiting on.',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#f97316',
    });
  }

  /** Whether the OS has already granted notification permission. */
  async hasPermission(): Promise<boolean> {
    if (!isNativeModuleAvailable || !Notifications) return false;
    try {
      const { status } = await Notifications.getPermissionsAsync();
      return status === 'granted';
    } catch {
      return false;
    }
  }

  /**
   * Whether the OS will still show a permission prompt. Once a user declines
   * on iOS the prompt never appears again, so there is no point asking.
   */
  async canAskPermission(): Promise<boolean> {
    if (!isNativeModuleAvailable || !Notifications || !Device?.isDevice) return false;
    try {
      const { status, canAskAgain } = await Notifications.getPermissionsAsync();
      return status !== 'granted' && canAskAgain !== false;
    } catch {
      return false;
    }
  }

  /**
   * Refresh the stored token when permission is already granted, without ever
   * showing a prompt. Keeps delivery alive across reinstalls and token
   * rotation for users who opted in previously.
   */
  async refreshTokenIfPermitted(): Promise<string | null> {
    if (!(await this.hasPermission())) return null;
    return this.registerForPushNotifications({ promptIfNeeded: false });
  }

  /**
   * Register for push notifications.
   * Returns the Expo push token or null if registration fails.
   *
   * `promptIfNeeded` gates the one-shot OS permission dialog — pass false to
   * refresh silently for users who already granted it.
   */
  async registerForPushNotifications(
    { promptIfNeeded = true }: { promptIfNeeded?: boolean } = {}
  ): Promise<string | null> {
    // Check if native module is available
    if (!isNativeModuleAvailable || !Notifications || !Device) {
      return null;
    }

    // Push notifications only work on physical devices
    if (!Device.isDevice) {
      return null;
    }

    // Check existing permission status
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permission if not granted
    if (existingStatus !== 'granted') {
      if (!promptIfNeeded) {
        return null;
      }
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      return null;
    }

    try {
      // Get Expo push token
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });

      this.expoPushToken = tokenData.data;
      // Save token to Firestore for this device
      const deviceId = this.getDeviceId();
      await firestoreService.saveFcmToken(this.expoPushToken, deviceId, this.getTimezone());

      await this.ensureAndroidChannels();

      return this.expoPushToken;
    } catch (error) {
      return null;
    }
  }

  /**
   * Reset the app icon badge. Nothing cleared it previously, so the count grew
   * forever and stopped meaning anything.
   */
  async clearBadge(): Promise<void> {
    if (!isNativeModuleAvailable || !Notifications) return;
    try {
      await Notifications.setBadgeCountAsync(0);
    } catch {
      // Badge support is platform/launcher dependent; never surface a failure.
    }
  }

  /**
   * Set up notification listeners for foreground and background
   */
  setupNotificationListeners(
    onNotificationReceived?: (notification: any) => void,
    onNotificationResponse?: (response: any) => void
  ): void {
    if (!isNativeModuleAvailable || !Notifications) {
      return;
    }

    // Listen for notifications received while app is foregrounded
    this.notificationListener = Notifications.addNotificationReceivedListener((notification) => {
      onNotificationReceived?.(notification);
    });

    // Listen for user interaction with notifications
    this.responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      onNotificationResponse?.(response);
    });
  }

  /**
   * Remove notification listeners
   */
  removeNotificationListeners(): void {
    if (!isNativeModuleAvailable || !Notifications) {
      return;
    }

    if (this.notificationListener) {
      Notifications.removeNotificationSubscription(this.notificationListener);
      this.notificationListener = null;
    }
    if (this.responseListener) {
      Notifications.removeNotificationSubscription(this.responseListener);
      this.responseListener = null;
    }
  }

  /**
   * Unregister from push notifications
   * Call this when user logs out
   */
  async unregisterFromPushNotifications(): Promise<void> {
    try {
      const deviceId = this.getDeviceId();
      await firestoreService.removeFcmToken(deviceId);
      this.expoPushToken = null;
    } catch (error) {
      // silently ignore
    }
  }

  /**
   * Get the current push token
   */
  getPushToken(): string | null {
    return this.expoPushToken;
  }

  /**
   * Schedule a local notification (for testing)
   */
  async scheduleLocalNotification(
    title: string,
    body: string,
    data?: Record<string, any>
  ): Promise<void> {
    if (!isNativeModuleAvailable || !Notifications) {
      return;
    }

    try {
      // Skip if the OS hasn't granted notification permission — scheduling
      // without permission makes iOS reject with UNErrorDomain Code=1.
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: true,
        },
        trigger: null, // Immediate
      });
    } catch (error) {
      // Never let a native rejection (e.g. permission revoked between the
      // check and the call) surface as an unhandled promise rejection.
      console.warn('Failed to schedule local notification:', error);
    }
  }
}

export const notificationService = new NotificationService();
