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
  console.log('Running in Expo Go — push notifications are not supported. Use a development build for push notification support.');
} else {
  try {
    Notifications = require('expo-notifications');
    Device = require('expo-device');

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });

    isNativeModuleAvailable = true;
  } catch (error) {
    console.log('expo-notifications native module not available. Use a development build for push notification support.');
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
   * Register for push notifications
   * Returns the Expo push token or null if registration fails
   */
  async registerForPushNotifications(): Promise<string | null> {
    // Check if native module is available
    if (!isNativeModuleAvailable || !Notifications || !Device) {
      console.log('Push notifications not available (native module not loaded)');
      return null;
    }

    // Push notifications only work on physical devices
    if (!Device.isDevice) {
      console.log('Push notifications only work on physical devices');
      return null;
    }

    // Check existing permission status
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permission if not granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission not granted');
      return null;
    }

    try {
      // Get Expo push token
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });

      this.expoPushToken = tokenData.data;
      console.log('Expo push token:', this.expoPushToken);

      // Save token to Firestore for this device
      const deviceId = this.getDeviceId();
      await firestoreService.saveFcmToken(this.expoPushToken, deviceId);

      // Set up Android notification channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('quote-responses', {
          name: 'Quote Responses',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#f97316', // Orange to match app theme
        });
      }

      return this.expoPushToken;
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return null;
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
      console.log('Cannot set up notification listeners (native module not available)');
      return;
    }

    // Listen for notifications received while app is foregrounded
    this.notificationListener = Notifications.addNotificationReceivedListener((notification) => {
      console.log('Notification received in foreground:', notification);
      onNotificationReceived?.(notification);
    });

    // Listen for user interaction with notifications
    this.responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log('User interacted with notification:', response);
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
      console.log('Unregistered from push notifications');
    } catch (error) {
      console.error('Error unregistering from push notifications:', error);
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
      console.log('Cannot schedule notification (native module not available)');
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
  }
}

export const notificationService = new NotificationService();
