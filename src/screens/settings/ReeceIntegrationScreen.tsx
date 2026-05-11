/**
 * Reece Integration Screen
 *
 * Connect / disconnect a plumber's Reece maX account so QuoteMate can pull
 * their actual trade pricing into every quote. Mirrors SquareIntegrationScreen
 * for visual parity but is simpler — the Reece flow has no refresh tokens, no
 * sandbox/prod toggle, and no Tap-to-Pay equivalent.
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
import { format } from 'date-fns';

import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import {
  getReeceConnectionStatus,
  disconnectReece,
  getReecePriceFileStatus,
  refreshReecePriceFile,
  disableReecePriceFile,
  type ReeceConnectionStatus,
  type ReecePriceFileStatus,
} from '../../services/reeceApi';
import { runReeceConnectFlow, runReecePriceFileEnableFlow } from '../../services/reeceConnect';

function formatRelativeAge(generatedAt: number | null): string {
  if (!generatedAt) return 'never';
  const ms = Date.now() - generatedAt;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ReeceIntegrationScreen() {
  const [connection, setConnection] = useState<ReeceConnectionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [disconnectModalVisible, setDisconnectModalVisible] = useState(false);
  const [priceFileStatus, setPriceFileStatus] = useState<ReecePriceFileStatus | null>(null);
  const [priceFileBusy, setPriceFileBusy] = useState<'enable' | 'refresh' | 'disable' | null>(null);
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
    refresh();
  }, []);

  const refresh = async () => {
    setCheckingConnection(true);
    try {
      const status = await getReeceConnectionStatus();
      setConnection(status.connected ? status : null);
      if (status.connected) {
        const pfs = await getReecePriceFileStatus();
        setPriceFileStatus(pfs);
      } else {
        setPriceFileStatus(null);
      }
    } catch {
      setConnection(null);
      setPriceFileStatus(null);
    } finally {
      setCheckingConnection(false);
    }
  };

  const handleEnablePriceFile = async () => {
    setPriceFileBusy('enable');
    try {
      const outcome = await runReecePriceFileEnableFlow();
      if (outcome.kind === 'enabled') {
        showAlert(
          'success',
          'Catalogue sync enabled',
          'Reece is generating your price file now. It usually takes 1–5 minutes — you’ll see the product count once it’s ready.',
        );
      } else {
        showAlert('error', 'Could not enable sync', outcome.message);
      }
      const pfs = await getReecePriceFileStatus();
      setPriceFileStatus(pfs);
    } finally {
      setPriceFileBusy(null);
    }
  };

  const handleRefreshPriceFile = async () => {
    setPriceFileBusy('refresh');
    try {
      const result = await refreshReecePriceFile();
      if (result.status === 'ready') {
        showAlert(
          'success',
          'Catalogue updated',
          `Pulled ${result.productCount ?? 0} Reece products at your trade pricing.`,
        );
      } else if (result.status === 'reauth_required') {
        showAlert(
          'error',
          'Reece sign-in expired',
          'Your Reece consent expired — reconnect Reece below to refresh.',
        );
      } else if (result.status === 'not_enabled') {
        showAlert('info', 'Sync not enabled', 'Enable catalogue sync first.');
      } else {
        showAlert('error', 'Refresh failed', result.error || 'Try again in a few minutes.');
      }
      const pfs = await getReecePriceFileStatus();
      setPriceFileStatus(pfs);
    } finally {
      setPriceFileBusy(null);
    }
  };

  const handleDisablePriceFile = async () => {
    setPriceFileBusy('disable');
    try {
      await disableReecePriceFile();
      const pfs = await getReecePriceFileStatus();
      setPriceFileStatus(pfs);
    } catch (error: any) {
      showAlert('error', 'Could not disable sync', error?.message || 'Try again in a moment.');
    } finally {
      setPriceFileBusy(null);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const outcome = await runReeceConnectFlow();
      if (outcome.kind === 'connected') {
        setConnection(outcome.status);
        showAlert(
          'success',
          'Reece connected',
          `You’re signed in as ${outcome.status.displayName || 'your Reece account'}. Your trade prices will now flow into every quote.`,
        );
      } else if (outcome.kind === 'failed') {
        // Race: the backend can write the customer token to Firestore but the
        // client never receives the response (Android in-app browser drops the
        // socket on its way out). Before showing a failure, ask the server
        // whether we're actually connected — if yes, treat the round trip as
        // a success.
        const status = await getReeceConnectionStatus();
        if (status.connected) {
          setConnection(status);
          showAlert(
            'success',
            'Reece connected',
            `You’re signed in as ${status.displayName || 'your Reece account'}. Your trade prices will now flow into every quote.`,
          );
        } else {
          showAlert('error', 'Connection failed', outcome.message);
        }
      }
      await refresh();
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => setDisconnectModalVisible(true);

  const confirmDisconnect = async () => {
    setDisconnectModalVisible(false);
    setLoading(true);
    try {
      await disconnectReece();
      setConnection(null);
    } catch (error: any) {
      showAlert(
        'error',
        'Error',
        error?.message || 'Failed to disconnect. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (checkingConnection) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Checking Reece connection...</Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <WebContainer>
          {/* Header */}
          <Surface style={styles.card}>
            <View style={styles.headerRow}>
              <View style={styles.reeceIcon}>
                <MaterialCommunityIcons
                  name="pipe"
                  size={32}
                  color={colors.primary}
                />
              </View>
              <View style={styles.headerText}>
                <Title style={styles.title}>Reece Plumbing</Title>
                <Text style={styles.subtitle}>
                  Pull your real Reece trade prices into every quote — straight from your maX account.
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
                </View>

                {connection.displayName ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Account</Text>
                    <Text style={styles.detailValue}>{connection.displayName}</Text>
                  </View>
                ) : null}

                {connection.customerNumber ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Customer #</Text>
                    <Text style={styles.detailValue}>{connection.customerNumber}</Text>
                  </View>
                ) : null}

                {connection.homeBranch ? (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Home branch</Text>
                    <Text style={styles.detailValue}>{connection.homeBranch}</Text>
                  </View>
                ) : null}

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
                  mode="outlined"
                  onPress={handleDisconnect}
                  loading={loading}
                  textColor={colors.error}
                  style={styles.disconnectButton}
                >
                  Disconnect Reece
                </Button>
              </View>
            ) : (
              <View>
                <Text style={styles.disconnectedText}>
                  Connect your Reece maX account to fetch your real trade-discounted prices automatically. Takes about a minute.
                </Text>
                <Button
                  mode="contained"
                  onPress={handleConnect}
                  loading={loading}
                  disabled={loading}
                  style={styles.connectButton}
                  buttonColor={colors.primary}
                >
                  Connect to Reece
                </Button>
              </View>
            )}
          </Surface>

          {/* Catalogue sync — only show once the user has a connection */}
          {connection?.connected ? (
            <Surface style={styles.card}>
              <Text style={styles.sectionTitle}>Catalogue sync</Text>
              <Text style={styles.disconnectedText}>
                Reece can dump your full purchasable catalogue — every product you can buy at your trade rate. We refresh it nightly so quotes price faster and match the right items.
              </Text>

              {priceFileStatus?.enabled ? (
                <>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Last synced</Text>
                    <Text style={styles.detailValue}>
                      {formatRelativeAge(priceFileStatus.generatedAt)}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Products</Text>
                    <Text style={styles.detailValue}>
                      {priceFileStatus.productCount ?? '—'}
                    </Text>
                  </View>
                  {priceFileStatus.lastError ? (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Last error</Text>
                      <Text style={[styles.detailValue, { color: colors.error }]}>
                        {priceFileStatus.lastError}
                      </Text>
                    </View>
                  ) : null}
                  <Divider style={styles.divider} />
                  <Button
                    mode="contained"
                    onPress={handleRefreshPriceFile}
                    loading={priceFileBusy === 'refresh'}
                    disabled={priceFileBusy !== null}
                    style={styles.connectButton}
                    buttonColor={colors.primary}
                  >
                    Refresh now
                  </Button>
                  <Button
                    mode="outlined"
                    onPress={handleDisablePriceFile}
                    loading={priceFileBusy === 'disable'}
                    disabled={priceFileBusy !== null}
                    textColor={colors.error}
                    style={[styles.disconnectButton, { marginTop: 8 }]}
                  >
                    Disable catalogue sync
                  </Button>
                </>
              ) : (
                <Button
                  mode="contained"
                  onPress={handleEnablePriceFile}
                  loading={priceFileBusy === 'enable'}
                  disabled={priceFileBusy !== null}
                  style={styles.connectButton}
                  buttonColor={colors.primary}
                >
                  Enable catalogue sync
                </Button>
              )}
            </Surface>
          ) : null}

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
                Tap connect — you’ll be sent to reece.com.au to sign in to maX.
              </Text>
            </View>
            <View style={styles.howItWorksItem}>
              <MaterialCommunityIcons
                name="numeric-2-circle"
                size={24}
                color={colors.primary}
              />
              <Text style={styles.howItWorksText}>
                Approve QuoteMate on the maX consent page, then close the tab.
              </Text>
            </View>
            <View style={styles.howItWorksItem}>
              <MaterialCommunityIcons
                name="numeric-3-circle"
                size={24}
                color={colors.primary}
              />
              <Text style={styles.howItWorksText}>
                Add materials to a quote — Reece prices flow in at your trade rate.
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
        title="Disconnect Reece"
        message={`This will unlink ${
          connection?.displayName || 'your Reece account'
        }. Existing quotes aren’t affected, but new material searches won’t use Reece trade prices until you reconnect.`}
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
  reeceIcon: {
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
