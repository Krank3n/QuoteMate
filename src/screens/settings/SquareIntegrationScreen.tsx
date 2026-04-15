/**
 * Square Integration Screen
 * Connect/disconnect Square, view merchant + location, explain in-app payments.
 *
 * Parallel to XeroIntegrationScreen: OAuth via system browser, polled on return.
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
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

export function SquareIntegrationScreen() {
  const { squareConnection, setSquareConnection, subscriptionStatus } = useStore();
  const isTrialActive = !!(
    subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired
  );
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [loading, setLoading] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [alertModal, setAlertModal] = useState<{
    visible: boolean;
    type: 'success' | 'error' | 'info';
    title: string;
    message: string;
  }>({ visible: false, type: 'info', title: '', message: '' });
  const [disconnectModalVisible, setDisconnectModalVisible] = useState(false);

  const showAlert = (
    type: 'success' | 'error' | 'info',
    title: string,
    message: string
  ) => {
    setAlertModal({ visible: true, type, title, message });
  };

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setCheckingConnection(true);
    try {
      // Timeout so a slow network can't leave the screen spinning forever.
      const timeout = new Promise<{ connected: false }>((resolve) =>
        setTimeout(() => resolve({ connected: false }), 5000)
      );
      const status = await Promise.race([
        squareService.checkSquareConnection(),
        timeout,
      ]);
      if (status.connected) {
        setSquareConnection({
          merchantId: status.merchantId!,
          merchantName: status.merchantName,
          locationId: status.locationId,
          locationName: status.locationName,
          mode: status.mode || 'sandbox',
          connectedAt: status.connectedAt!,
          syncEnabled: status.syncEnabled ?? true,
          disconnectedReason: status.disconnectedReason,
        });
      } else {
        setSquareConnection(null);
      }
    } catch {
      // Treat failure as disconnected.
    } finally {
      setCheckingConnection(false);
    }
  };

  const handleConnect = async () => {
    if (!isPro) {
      showAlert(
        'info',
        'Pro Feature',
        'Square Payments is available on the Pro plan. Upgrade to take payments in the app.'
      );
      return;
    }
    setLoading(true);
    try {
      const { authUrl } = await squareService.getSquareAuthUrl();
      await WebBrowser.openBrowserAsync(authUrl, {
        dismissButtonStyle: 'done',
      });
      setCheckingConnection(true);
      await checkConnection();
    } catch (error: any) {
      showAlert(
        'error',
        'Connection Failed',
        error.message || 'Could not start the Square connection. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => setDisconnectModalVisible(true);

  const confirmDisconnect = async () => {
    setDisconnectModalVisible(false);
    setLoading(true);
    try {
      await squareService.disconnectSquare();
      setSquareConnection(null);
    } catch (error: any) {
      showAlert(
        'error',
        'Error',
        error.message || 'Failed to disconnect. Please try again.'
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

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <WebContainer>
          <Surface style={styles.card}>
            <View style={styles.headerRow}>
              <View style={styles.squareIcon}>
                <MaterialCommunityIcons
                  name="credit-card-scan"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <View style={styles.headerText}>
                <Title style={styles.title}>Square Payments</Title>
                <Text style={styles.subtitle}>
                  Take on-site card, Apple Pay and Google Pay payments, or share
                  a pay link by SMS.
                </Text>
              </View>
            </View>
          </Surface>

          <Surface style={styles.card}>
            <Text style={styles.sectionTitle}>Connection</Text>

            {squareConnection ? (
              <View>
                <View style={styles.statusRow}>
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={20}
                    color={colors.success}
                  />
                  <Text style={styles.connectedText}>Connected</Text>
                  {squareConnection.mode === 'sandbox' && (
                    <Text style={styles.sandboxPill}> Sandbox</Text>
                  )}
                </View>

                {squareConnection.merchantName && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Merchant</Text>
                    <Text style={styles.detailValue}>
                      {squareConnection.merchantName}
                    </Text>
                  </View>
                )}
                {squareConnection.locationName && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Location</Text>
                    <Text style={styles.detailValue}>
                      {squareConnection.locationName}
                    </Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Connected</Text>
                  <Text style={styles.detailValue}>
                    {squareConnection.connectedAt
                      ? format(new Date(squareConnection.connectedAt), 'd MMM yyyy')
                      : '—'}
                  </Text>
                </View>

                <Divider style={styles.divider} />

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
                  Connect your Square account to mint pay links and accept card,
                  Apple Pay and Google Pay in the app.
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
                On any invoice or accepted quote, tap "Take Payment".
              </Text>
            </View>
            <View style={styles.howItWorksItem}>
              <MaterialCommunityIcons
                name="numeric-3-circle"
                size={24}
                color={colors.primary}
              />
              <Text style={styles.howItWorksText}>
                Share a pay link today; card entry, Apple Pay, Google Pay and
                Tap to Pay unlock when you update to the latest build.
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
        primaryButtonAction={() =>
          setAlertModal({ ...alertModal, visible: false })
        }
        showConfetti={false}
      />

      <AlertModal
        visible={disconnectModalVisible}
        onDismiss={() => setDisconnectModalVisible(false)}
        type="error"
        icon="link-off"
        title="Disconnect Square"
        message={`This will unlink ${
          squareConnection?.merchantName || 'your Square account'
        } from QuoteMate. Existing payments in Square won't be affected.`}
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
  sandboxPill: {
    fontSize: 12,
    color: colors.warning,
    marginLeft: 8,
    backgroundColor: colors.warningBg,
    paddingHorizontal: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  detailLabel: { fontSize: 14, color: colors.textMuted },
  detailValue: { fontSize: 14, fontWeight: '500', color: colors.text },
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
