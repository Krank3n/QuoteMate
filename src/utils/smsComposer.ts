import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export type SmsComposerResult = 'sent' | 'unknown' | 'cancelled' | 'copied';

/**
 * Keep a leading international `+`, but remove display punctuation/spaces so
 * the recipient is handed to the messaging app as a phone number, not as part
 * of the message URI.
 */
export function cleanSmsRecipient(recipient: string): string {
  const trimmed = recipient.trim();
  const prefix = trimmed.startsWith('+') ? '+' : '';
  return `${prefix}${trimmed.replace(/\D/g, '')}`;
}

/**
 * Open the native SMS composer with an unencoded message.
 *
 * Linking.openURL(`sms:...?body=${encodeURIComponent(message)}`) is not
 * consistently decoded by Android/Samsung messaging apps; some customers see
 * the literal `%20`, `%2C`, etc. expo-sms passes the recipient and body through
 * native Intent/composer fields instead, so the text arrives exactly as
 * written. Browsers cannot reliably open an SMS composer, so web copies the
 * message for the user instead.
 */
export async function openSmsComposer(
  recipient: string,
  message: string,
): Promise<SmsComposerResult> {
  const cleanRecipient = cleanSmsRecipient(recipient);
  if (!cleanRecipient) throw new Error('A phone number is required');

  if (Platform.OS === 'web') {
    await Clipboard.setStringAsync(message);
    return 'copied';
  }

  // Loaded only on native. expo-sms uses Android Intent extras and
  // MFMessageComposeViewController instead of a percent-encoded sms: URL.
  const SMS = await import('expo-sms');
  if (!(await SMS.isAvailableAsync())) {
    throw new Error('SMS is not available on this device');
  }
  const { result } = await SMS.sendSMSAsync(cleanRecipient, message);
  return result;
}
