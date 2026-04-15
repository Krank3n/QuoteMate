/**
 * Square Integration Screen
 * Connect/disconnect Square, view merchant + env, explain how online
 * payments flow onto invoice emails.
 *
 * Mirrors XeroIntegrationScreen.tsx for visual parity.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {
  Text,
  Surface,
  Title,
  Button,
  ActivityIndicator,
  Divider,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as WebBrowser from 'expo-web-browser';
import { format } from 'date-fns';

import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import * as squareService from '../../services/squareService';
import type { SquareConnectionStatus } from '../../services/squareService';
import { primeTapToPayOnDevice } from '../../services/squarePayments';

export function SquareIntegrationScreen() {
  const { subscriptionStatus } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [connection, setConnection] = useState<SquareConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [disconnectModalVisible, setDisconnectModalVisible] = useState(false);
  const [primingTapToPay, setPrimingTapToPay] = useState(false);
  const [alertModal, setAlertModal] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
  }>({ visible: false, type: 'info', title: '', message: '' });

  const showAlert = (
    type: 'success' | 'error' | 'info',
    title: string,
    message: string,
  ) => setAlertModal({ visible: true, type, title, message });

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setCheckingConnection(true);
    try {
      const timeout = new Promise<SquareConnectionStatus>((resolve) =>
        setTimeout(() => resolve({ connected: false }), 5000),
      );
      const status = await Promise.race([
        squareService.checkSquareConnection(),
        timeout,
      ]);
      setConnection(status.connected ? status : null);
    } catch {
      setConnection(null);
    } finally {
      setCheckingConnection(false);
    }
  };

  const handleConnect = async () => {
    if (!isPro) {
      showAlert(
        'info',
        'Pro Feature',
        'Square integration is available on the Pro plan. Upgrade to accept online payments on your invoices.',
      );
      return;
    }

    setLoading(true);
    try {
      const { authUrl } = await squareService.getSquareAuthUrl();
      await WebBrowser.openBrowserAsync(authUrl, {
        dismissButtonStyle: 'done',
      });
      // openBrowserAsync resolves when the user closes the tab, but the OAuth
      // code→token exchange is still in flight on squareCallback → Firestore
      // write. A single check races and usually misses it. Poll for up to ~10s
      // (1s intervals) and stop as soon as we see a connected state.
      setCheckingConnection(true);
      const deadline = Date.now() + 10000;
      let connected = false;
      while (Date.now() < deadline) {
        try {
          const status = await squareService.checkSquareConnection();
          if (status.connected) {
            setConnection(status);
            connected = true;
            break;
          }
        } catch {
          // Ignore transient errors and keep polling.
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setCheckingConnection(false);
      if (!connected) {
        // Final fallback — reflect whatever the backend reports now.
        await checkConnection();
      }
    } catch (error: any) {
      showAlert(
        'error',
        'Connection Failed',
        error.message || 'Could not start Square connection. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePrimeTapToPay = async () => {
    setPrimingTapToPay(true);
    try {
      await primeTapToPayOnDevice();
    } catch (error: any) {
      showAlert(
        'error',
        'Setup Failed',
        error.message ||
          'Could not open Tap to Pay setup. You can try again from this screen any time.',
      );
    } finally {
      setPrimingTapToPay(false);
    }
  };

  const handleDisconnect = () => setDisconnectModalVisible(true);

  const confirmDisconnect = async () => {
    setDisconnectModalVisible(false);
    setLoading(true);
    try {
      await squareService.disconnectSquare();
      setConnection(null);
    } catch (error: any) {
      showAlert(
        'error',
        'Error',
        error.message || 'Failed to disconnect. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (checkingConnection) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Checking Square connection...</Text>
      </View>
    );
  }

  const isSandbox = connection?.env === 'sandbox';

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <WebContainer>
          {/* Header */}
          <Surface style={styles.card}>
            <View style={styles.headerRow}>
              <View style={styles.squareIcon}>
                <MaterialCommunityIcons
                  name="credit-card-outline"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <View style={styles.headerText}>
                <View style={styles.titleRow}>
                  <Title style={styles.title}>Square Payments</Title>
                  <View style={[styles.pill, styles.pillNew]}>
                    <Text style={[styles.pillText, styles.pillTextNew]}>NEW</Text>
                  </View>
                  <View style={[styles.pill, styles.pillBeta]}>
                    <Text style={[styles.pillText, styles.pillTextBeta]}>BETA</Text>
                  </View>
                </View>
                <Text style={styles.subtitle}>
                  Add a Pay Now button to your invoice emails — customers pay by card, funds go straight to your Square account.
                </Text>
              </View>
            </View>
          </Surface>

          {/* Connection Status */}
          <Surface style={styles.card}>
            <Text style={styles.sectionTitle}>Connection</Text>

            {connection?.connected ? (
              <View>
                <View style={styles.statusRow}>
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={20}
                    color={colors.success}
                  />
                  <Text style={styles.connectedText}>Connected</Text>
                  {isSandbox && (
                    <View style={styles.envBadge}>
                      <Text style={styles.envBadgeText}>Sandbox</Text>
                    </View>
                  )}
                </View>

                {connection.merchantName && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Merchant</Text>
                    <Text style={styles.detailValue}>{connection.merchantName}</Text>
                  </View>
                )}

                {connection.locationName && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Location</Text>
                    <Text style={styles.detailValue}>{connection.locationName}</Text>
                  </View>
                )}

                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Connected</Text>
                  <Text style={styles.detailValue}>
                    {connection.connectedAt
                      ? format(new Date(connection.connectedAt), 'd MMM yyyy')
                      : '—'}
                  </Text>
                </View>

                <Divider style={styles.divider} />

                <Button
                  mode="contained"
                  onPress={handlePrimeTapToPay}
                  loading={primingTapToPay}
                  disabled={primingTapToPay}
                  icon="cellphone-nfc"
                  buttonColor={colors.primary}
                  style={styles.tapToPayButton}
                >
                  Set up Tap to Pay on this device
                </Button>

                <Button
                  mode="outlined"
                  onPress={handleDisconnect}
                  loading={loading}
                  textColor={colors.error}
                  style={styles.disconnectButton}
                >
                  Disconnect Square
                </Button>
              </View>
            ) : (
              <View>
                <Text style={styles.disconnectedText}>
                  Connect your Square account to add a Pay Now button to invoice emails. Customers pay by card, money lands straight in your Square account.
                </Text>

                {!isPro && (
                  <View style={styles.proNotice}>
                    <MaterialCommunityIcons
                      name="crown"
                      size={18}
                      color={colors.warning}
                    />
                    <Text style={styles.proNoticeText}>
                      Pro feature — upgrade to connect
                    </Text>
                  </View>
                )}

                <Button
                  mode="contained"
                  onPress={handleConnect}
                  loading={loading}
                  disabled={loading}
                  style={styles.connectButton}
                  buttonColor={colors.primary}
                >
                  Connect to Square
                </Button>
              </View>
            )}
          </Surface>

          {/* How it works */}
          <Surface style={styles.card}>
            <Text style={styles.sectionTitle}>How it works</Text>

            <View style={styles.howItWorksItem}>
              <MaterialCommunityIcons
                name="numeric-1-circle"
                size={24}
                color={colors.primary}
              />
              <Text style={styles.howItWorksText}>
                Connect your Square account above.
              </Text>
            </View>
            <View style={styles.howItWorksItem}>
              <MaterialCommunityIcons
                name="numeric-2-circle"
                size={24}
                color={colors.primary}
              />
              <Text style={styles.howItWorksText}>
                Send an invoice — a Pay Now button appears automatically in the email.
              </Text>
            </View>
            <View style={styles.howItWorksItem}>
              <MaterialCommunityIcons
                name="numeric-3-circle"
                size={24}
                color={colors.primary}
              />
              <Text style={styles.howItWorksText}>
                Customer pays by card; the invoice flips to Paid and (if connected) syncs to Xero.
              </Text>
            </View>
          </Surface>

          <View style={styles.bottomPadding} />
        </WebContainer>
      </ScrollView>

      <AlertModal
        visible={alertModal.visible}
        onDismiss={() => setAlertModal({ ...alertModal, visible: false })}
        type={alertModal.type}
        icon={
          alertModal.type === 'success'
            ? 'check-circle'
            : alertModal.type === 'error'
              ? 'alert-circle'
              : 'information'
        }
        title={alertModal.title}
        message={alertModal.message}
        primaryButtonText="OK"
        primaryButtonAction={() => setAlertModal({ ...alertModal, visible: false })}
        showConfetti={false}
      />

<AlertModal
        visible={disconnectModalVisible}
        onDismiss={() => setDisconnectModalVisible(false)}
        type="error"
        icon="link-off"
        title="Disconnect Square"
        message={`This will unlink ${
          connection?.merchantName || 'your Square account'
        }. Existing payments aren't affected, but new invoice emails won't include a Pay Now button.`}
        primaryButtonText="Disconnect"
        primaryButtonAction={confirmDisconnect}
        secondaryButtonText="Cancel"
        secondaryButtonAction={() => setDisconnectModalVisible(false)}
        showConfetti={false}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16 },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    backgroundColor: colors.background,
  },
  loadingText: { marginTop: 12, color: colors.textMuted, fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 20,
    marginBottom: 12,
    elevation: 2,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  squareIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  headerText: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  pillNew: { backgroundColor: colors.primaryBg },
  pillTextNew: { color: colors.primary },
  pillBeta: { backgroundColor: colors.warningBg },
  pillTextBeta: { color: colors.warning },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  connectedText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.success,
    marginLeft: 8,
  },
  envBadge: {
    marginLeft: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.warningBg,
    borderRadius: 999,
  },
  envBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.warning,
    letterSpacing: 0.4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  detailLabel: { fontSize: 14, color: colors.textMuted },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  divider: { marginVertical: 16, backgroundColor: colors.border },
  disconnectButton: { borderColor: colors.error },
  disconnectedText: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 16,
  },
  proNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  proNoticeText: {
    fontSize: 13,
    color: colors.warning,
    marginLeft: 8,
    fontWeight: '500',
  },
  connectButton: { marginTop: 4 },
  tapToPayButton: { marginTop: 4, marginBottom: 12 },
  howItWorksItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  howItWorksText: {
    fontSize: 14,
    color: colors.onSurface,
    marginLeft: 12,
    flex: 1,
    lineHeight: 20,
  },
  bottomPadding: { height: 40 },
});
