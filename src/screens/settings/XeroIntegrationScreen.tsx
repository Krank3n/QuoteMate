/**
 * Xero Integration Screen
 * Connect/disconnect Xero, view sync status, manage settings
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  AppState,
  type AppStateStatus,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Text,
  Surface,
  Title,
  Button,
  Switch,
  ActivityIndicator,
  Divider,
} from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as WebBrowser from 'expo-web-browser';
import { format } from 'date-fns';

import { useStore } from '../../store/useStore';
import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { AlertModal } from '../../components/AlertModal';
import * as xeroService from '../../services/xeroService';
import { GridBackground } from '../../components/GridBackground';

export function XeroIntegrationScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const {
    xeroConnection,
    setXeroConnection,
    subscriptionStatus,
    invoices,
    quotes,
    xeroBulkSync,
    pushQuoteToXero,
    xeroLoading,
  } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [loading, setLoading] = useState(false);
  const [bulkSyncing, setBulkSyncing] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [alertModal, setAlertModal] = useState<{ visible: boolean; type: 'success' | 'error' | 'info'; title: string; message: string }>({ visible: false, type: 'info', title: '', message: '' });

  const showAlert = (type: 'success' | 'error' | 'info', title: string, message: string) => {
    setAlertModal({ visible: true, type, title, message });
  };

  // Unsynced invoices: any non-draft invoice that hasn't successfully synced.
  const unsyncedInvoices = invoices.filter(
    (inv) => inv.status !== 'draft' && inv.xeroSyncStatus !== 'synced'
  );
  // Unsynced quotes: only accepted ones — sent-but-not-accepted quotes are
  // intentionally not bulk-pushed so we don't dump the tradie's open
  // pipeline into Xero. The auto-trigger handles new acceptances; this
  // covers the existing accepted-quote backfill (Tracy's QU-177828 case).
  const unsyncedQuotes = quotes.filter(
    (q) => q.status === 'accepted' && q.xeroSyncStatus !== 'synced'
  );
  const totalUnsynced = unsyncedInvoices.length + unsyncedQuotes.length;

  const checkConnection = useCallback(async (opts: { showSpinner?: boolean } = {}) => {
    if (opts.showSpinner !== false) setCheckingConnection(true);
    try {
      // Timeout after 5 seconds to avoid blank screen
      const timeout = new Promise<{ connected: false }>((resolve) =>
        setTimeout(() => resolve({ connected: false }), 5000)
      );
      const status = await Promise.race([
        xeroService.checkXeroConnection(),
        timeout,
      ]);
      if (status.connected) {
        setXeroConnection({
          tenantId: status.tenantId!,
          tenantName: status.tenantName!,
          connectedAt: status.connectedAt!,
          lastSyncAt: status.lastSyncAt,
          syncEnabled: status.syncEnabled ?? true,
        });
        return true;
      } else {
        setXeroConnection(null);
        return false;
      }
    } catch {
      return false;
    } finally {
      if (opts.showSpinner !== false) setCheckingConnection(false);
    }
  }, [setXeroConnection]);

  // Re-check whenever the screen regains focus (e.g. user navigated away
  // and back) and whenever the app comes back to the foreground (e.g. user
  // returned from the Xero OAuth browser tab on Android, where the in-app
  // browser doesn't always trigger our resume callback). Cheap — single
  // HTTPS round-trip, server-cached by tokenExpiresAt.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      checkConnection({ showSpinner: false }).finally(() => {
        if (!cancelled) setCheckingConnection(false);
      });
      const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
        if (next === 'active') checkConnection({ showSpinner: false });
      });
      return () => {
        cancelled = true;
        sub.remove();
      };
    }, [checkConnection]),
  );

  const handleConnect = async () => {
    if (!isPro) {
      showAlert('info', 'Pro Feature', 'Xero integration is available on the Pro plan. Upgrade to sync your invoices and payments.');
      return;
    }

    setLoading(true);
    try {
      const { authUrl } = await xeroService.getXeroAuthUrl();
      await WebBrowser.openBrowserAsync(authUrl, {
        dismissButtonStyle: 'done',
      });
      // Browser closed — poll briefly for the connection to land. The OAuth
      // callback fires server-side AFTER the browser dismisses, so a single
      // immediate check often races and reports "not connected" when in
      // fact the user just authorised. Poll every 2s for up to ~20s,
      // stopping as soon as the connection appears.
      setCheckingConnection(true);
      const start = Date.now();
      while (Date.now() - start < 20_000) {
        const connected = await checkConnection({ showSpinner: false });
        if (connected) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      setCheckingConnection(false);
    } catch (error: any) {
      showAlert('error', 'Connection Failed', error.message || 'Could not start Xero connection. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const [disconnectModalVisible, setDisconnectModalVisible] = useState(false);

  const handleDisconnect = () => {
    setDisconnectModalVisible(true);
  };

  const confirmDisconnect = async () => {
    setDisconnectModalVisible(false);
    setLoading(true);
    try {
      await xeroService.disconnectXero();
      setXeroConnection(null);
    } catch (error: any) {
      showAlert('error', 'Error', error.message || 'Failed to disconnect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkSync = async () => {
    if (totalUnsynced === 0) {
      showAlert('success', 'All Synced', 'Everything is already synced to Xero.');
      return;
    }

    setBulkSyncing(true);
    let invoiceSuccess = 0;
    let invoiceTotal = 0;
    let quoteSuccess = 0;
    const quoteFailures: { ref: string; reason: string }[] = [];

    try {
      // Invoices first — server-side bulk endpoint handles them in one shot.
      if (unsyncedInvoices.length > 0) {
        const ids = unsyncedInvoices.map((inv) => inv.id);
        const result = await xeroBulkSync(ids);
        invoiceSuccess = result.successCount;
        invoiceTotal = result.totalCount;
      }

      // Quotes go one-by-one through the per-doc push because each quote
      // hits the Xero Quotes API (different endpoint from the invoice bulk
      // endpoint). Volume in practice is small — backfill only.
      for (const q of unsyncedQuotes) {
        try {
          await pushQuoteToXero(q);
          quoteSuccess += 1;
        } catch (err: any) {
          quoteFailures.push({
            ref: q.quoteNumber || q.id,
            reason: err?.message || 'Unknown error',
          });
        }
      }

      const lines: string[] = [];
      if (invoiceTotal > 0) lines.push(`${invoiceSuccess} of ${invoiceTotal} invoices synced.`);
      if (unsyncedQuotes.length > 0) {
        lines.push(`${quoteSuccess} of ${unsyncedQuotes.length} quotes synced.`);
      }
      if (quoteFailures.length > 0) {
        console.warn('[XeroIntegrationScreen] bulk sync failures:', quoteFailures);
        lines.push('');
        // Server now maps Xero errors to actionable text (e.g. duplicate
        // contact warnings, token expiry). Surface the first one — that's
        // usually enough for the tradie to act. Subsequent failures often
        // share the same root cause.
        lines.push(`${quoteFailures[0].ref}: ${quoteFailures[0].reason}`);
        if (quoteFailures.length > 1) {
          const others = quoteFailures.slice(1).map((f) => f.ref).join(', ');
          lines.push(`Also failed: ${others}`);
        }
      }

      const allOk = invoiceSuccess === invoiceTotal && quoteFailures.length === 0;
      showAlert(allOk ? 'success' : 'error', 'Sync Complete', lines.join('\n') || 'Nothing to sync.');
      await checkConnection();
    } catch (error: any) {
      showAlert('error', 'Sync Failed', error.message || 'Some items failed to sync.');
    } finally {
      setBulkSyncing(false);
    }
  };

  if (checkingConnection) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={themeColors.accentText} />
        <Text style={styles.loadingText}>Checking Xero connection...</Text>
      </View>
    );
  }

  return (
    <>
    <View style={styles.gridHost}>
    <GridBackground />
    <ScrollView style={styles.scroller} contentContainerStyle={styles.content}>
      <WebContainer>
        {/* Xero Logo / Header */}
        <Surface style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.xeroIcon}>
              <MaterialCommunityIcons name="cloud-sync" size={32} color={themeColors.accentText} />
            </View>
            <View style={styles.headerText}>
              <Title style={styles.title}>Xero Integration</Title>
              <Text style={styles.subtitle}>
                Sync invoices and payments to your Xero account
              </Text>
            </View>
          </View>
        </Surface>

        {/* Connection Status */}
        <Surface style={styles.card}>
          <Text style={styles.sectionTitle}>Connection</Text>

          {xeroConnection ? (
            <View>
              <View style={styles.statusRow}>
                <MaterialCommunityIcons name="check-circle" size={20} color={themeColors.money} />
                <Text style={styles.connectedText}>Connected</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Organisation</Text>
                <Text style={styles.detailValue}>{xeroConnection.tenantName}</Text>
              </View>

              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Connected</Text>
                <Text style={styles.detailValue}>
                  {xeroConnection.connectedAt
                    ? format(new Date(xeroConnection.connectedAt), 'd MMM yyyy')
                    : '—'}
                </Text>
              </View>

              {xeroConnection.lastSyncAt && (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Last sync</Text>
                  <Text style={styles.detailValue}>
                    {format(new Date(xeroConnection.lastSyncAt), 'd MMM yyyy, h:mm a')}
                  </Text>
                </View>
              )}

              <Divider style={styles.divider} />

              <Button
                mode="outlined"
                onPress={handleDisconnect}
                loading={loading}
                textColor={themeColors.error}
                style={styles.disconnectButton}
              >
                Disconnect Xero
              </Button>
            </View>
          ) : (
            <View>
              <Text style={styles.disconnectedText}>
                Connect your Xero account to automatically sync invoices and payments.
              </Text>

              {!isPro && (
                <View style={styles.proNotice}>
                  <MaterialCommunityIcons name="crown" size={18} color={themeColors.warning} />
                  <Text style={styles.proNoticeText}>Pro feature — upgrade to connect</Text>
                </View>
              )}

              <Button
                mode="contained"
                onPress={handleConnect}
                loading={loading}
                disabled={loading}
                style={styles.connectButton}
                buttonColor={themeColors.accent}
              >
                Connect to Xero
              </Button>
            </View>
          )}
        </Surface>

        {/* Sync Actions (only when connected) */}
        {xeroConnection && (
          <Surface style={styles.card}>
            <Text style={styles.sectionTitle}>Sync</Text>

            <View style={styles.syncSummary}>
              <View style={styles.syncStat}>
                <Text style={styles.syncStatNumber}>
                  {invoices.filter(i => i.xeroSyncStatus === 'synced').length
                    + quotes.filter(q => q.xeroSyncStatus === 'synced').length}
                </Text>
                <Text style={styles.syncStatLabel}>Synced</Text>
              </View>
              <View style={styles.syncStat}>
                <Text style={[styles.syncStatNumber, totalUnsynced > 0 && { color: themeColors.warning }]}>
                  {totalUnsynced}
                </Text>
                <Text style={styles.syncStatLabel}>Unsynced</Text>
              </View>
              <View style={styles.syncStat}>
                <Text style={[styles.syncStatNumber, { color: themeColors.error }]}>
                  {invoices.filter(i => i.xeroSyncStatus === 'error').length
                    + quotes.filter(q => q.xeroSyncStatus === 'error').length}
                </Text>
                <Text style={styles.syncStatLabel}>Errors</Text>
              </View>
            </View>

            {totalUnsynced > 0 && (
              <>
                <Button
                  mode="contained"
                  onPress={handleBulkSync}
                  loading={xeroLoading || bulkSyncing}
                  disabled={xeroLoading || bulkSyncing}
                  style={styles.syncButton}
                  buttonColor={themeColors.accent}
                  icon="sync"
                >
                  {`Sync ${totalUnsynced} item${totalUnsynced === 1 ? '' : 's'}`}
                </Button>
                <Text style={styles.syncBreakdown}>
                  {[
                    unsyncedQuotes.length > 0
                      ? `${unsyncedQuotes.length} accepted quote${unsyncedQuotes.length === 1 ? '' : 's'}`
                      : null,
                    unsyncedInvoices.length > 0
                      ? `${unsyncedInvoices.length} invoice${unsyncedInvoices.length === 1 ? '' : 's'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' + ')}
                </Text>
              </>
            )}
          </Surface>
        )}

        {/* How it works */}
        <Surface style={styles.card}>
          <Text style={styles.sectionTitle}>How it works</Text>

          <View style={styles.howItWorksItem}>
            <MaterialCommunityIcons name="numeric-1-circle" size={24} color={themeColors.accentText} />
            <Text style={styles.howItWorksText}>
              Connect your Xero account above
            </Text>
          </View>
          <View style={styles.howItWorksItem}>
            <MaterialCommunityIcons name="numeric-2-circle" size={24} color={themeColors.accentText} />
            <Text style={styles.howItWorksText}>
              Accepted quotes auto-push to Xero. Invoices push when sent.
            </Text>
          </View>
          <View style={styles.howItWorksItem}>
            <MaterialCommunityIcons name="numeric-3-circle" size={24} color={themeColors.accentText} />
            <Text style={styles.howItWorksText}>
              Tap "Push to Xero" on any job to re-sync, or use the bulk button above.
            </Text>
          </View>
        </Surface>

        <View style={styles.bottomPadding} />
      </WebContainer>
    </ScrollView>
    </View>

    <AlertModal
      visible={alertModal.visible}
      onDismiss={() => setAlertModal({ ...alertModal, visible: false })}
      type={alertModal.type}
      icon={alertModal.type === 'success' ? 'cloud-check' : alertModal.type === 'error' ? 'cloud-alert' : 'information'}
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
      title="Disconnect Xero"
      message={`This will unlink "${xeroConnection?.tenantName || 'your organisation'}". Your existing invoices in Xero won't be affected.`}
      primaryButtonText="Disconnect"
      primaryButtonAction={confirmDisconnect}
      secondaryButtonText="Cancel"
      secondaryButtonAction={() => setDisconnectModalVisible(false)}
      showConfetti={false}
    />
    </>
  );
}

const useStyles = makeStyles((t) => ({
  gridHost: { flex: 1, backgroundColor: t.colors.bg },
  scroller: { flex: 1, backgroundColor: 'transparent' },
  container: { flex: 1, backgroundColor: t.colors.bg },
  content: { padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, backgroundColor: t.colors.bg },
  loadingText: { marginTop: 12, color: t.colors.textMuted, fontSize: 14 },
  card: {
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 14,
    padding: 20,
    marginBottom: 12,
    elevation: 2,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  xeroIcon: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  headerText: { flex: 1 },
  title: { fontSize: 20, fontWeight: '700', color: t.colors.text },
  subtitle: { fontSize: 14, color: t.colors.textMuted, marginTop: 2 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: t.colors.text,
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
    color: t.colors.money,
    marginLeft: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  detailLabel: { fontSize: 14, color: t.colors.textMuted },
  detailValue: { fontSize: 14, fontWeight: '500', color: t.colors.text },
  divider: { marginVertical: 16, backgroundColor: t.colors.border },
  disconnectButton: { borderColor: t.colors.error },
  disconnectedText: { fontSize: 14, color: t.colors.textMuted, lineHeight: 20, marginBottom: 16 },
  proNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.colors.warningSubtle,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  proNoticeText: { fontSize: 13, color: t.colors.warning, marginLeft: 8, fontWeight: '500' },
  connectButton: { marginTop: 4 },
  syncSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  syncStat: { alignItems: 'center' },
  syncStatNumber: { fontSize: 24, fontWeight: '700', color: t.colors.text },
  syncStatLabel: { fontSize: 12, color: t.colors.textMuted, marginTop: 2 },
  syncButton: { marginTop: 4 },
  syncBreakdown: {
    fontSize: 12,
    color: t.colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
  },
  howItWorksItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  howItWorksText: {
    fontSize: 14,
    color: t.colors.textSecondary,
    marginLeft: 12,
    flex: 1,
    lineHeight: 20,
  },
  bottomPadding: { height: 40 },
}));
