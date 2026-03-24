/**
 * Xero Integration Screen
 * Connect/disconnect Xero, view sync status, manage settings
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  Linking,
} from 'react-native';
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
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import * as xeroService from '../../services/xeroService';

export function XeroIntegrationScreen() {
  const {
    xeroConnection,
    setXeroConnection,
    subscriptionStatus,
    invoices,
    xeroBulkSync,
    xeroLoading,
  } = useStore();
  const isTrialActive = !!(subscriptionStatus?.trialStartedAt && !subscriptionStatus?.trialExpired);
  const isPro = subscriptionStatus?.isPro || isTrialActive;

  const [loading, setLoading] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);

  // Count unsynced invoices
  const unsyncedInvoices = invoices.filter(
    (inv) => inv.status !== 'draft' && inv.xeroSyncStatus !== 'synced'
  );

  // Check connection on mount
  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    setCheckingConnection(true);
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
      } else {
        setXeroConnection(null);
      }
    } catch {
      // Silently fail — just show disconnected state
    } finally {
      setCheckingConnection(false);
    }
  };

  const handleConnect = async () => {
    if (!isPro) {
      Alert.alert(
        'Pro Feature',
        'Xero integration is available on the Pro plan. Upgrade to sync your invoices and payments.',
      );
      return;
    }

    setLoading(true);
    try {
      const { authUrl } = await xeroService.getXeroAuthUrl();
      await WebBrowser.openBrowserAsync(authUrl);
      // After the browser closes, check if we're now connected
      await checkConnection();
    } catch (error: any) {
      Alert.alert('Connection Failed', error.message || 'Could not start Xero connection. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Xero',
      `This will unlink your Xero organisation "${xeroConnection?.tenantName}". Your existing invoices in Xero won't be affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await xeroService.disconnectXero();
              setXeroConnection(null);
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to disconnect. Please try again.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleBulkSync = async () => {
    const ids = unsyncedInvoices.map((inv) => inv.id);
    if (ids.length === 0) {
      Alert.alert('All Synced', 'All your invoices are already synced to Xero.');
      return;
    }

    Alert.alert(
      'Sync Invoices',
      `Push ${ids.length} unsynced invoice${ids.length === 1 ? '' : 's'} to Xero?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sync',
          onPress: async () => {
            try {
              const result = await xeroBulkSync(ids);
              Alert.alert(
                'Sync Complete',
                `${result.successCount} of ${result.totalCount} invoices synced successfully.`
              );
              await checkConnection();
            } catch (error: any) {
              Alert.alert('Sync Failed', error.message || 'Some invoices failed to sync.');
            }
          },
        },
      ]
    );
  };

  if (checkingConnection) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Checking Xero connection...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <WebContainer>
        {/* Xero Logo / Header */}
        <Surface style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.xeroIcon}>
              <MaterialCommunityIcons name="cloud-sync" size={32} color={colors.primary} />
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
                <MaterialCommunityIcons name="check-circle" size={20} color={colors.success} />
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
                textColor={colors.error}
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
                  <MaterialCommunityIcons name="crown" size={18} color={colors.warning} />
                  <Text style={styles.proNoticeText}>Pro feature — upgrade to connect</Text>
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
                <Text style={styles.syncStatNumber}>{invoices.filter(i => i.xeroSyncStatus === 'synced').length}</Text>
                <Text style={styles.syncStatLabel}>Synced</Text>
              </View>
              <View style={styles.syncStat}>
                <Text style={[styles.syncStatNumber, unsyncedInvoices.length > 0 && { color: '#F59E0B' }]}>
                  {unsyncedInvoices.length}
                </Text>
                <Text style={styles.syncStatLabel}>Unsynced</Text>
              </View>
              <View style={styles.syncStat}>
                <Text style={[styles.syncStatNumber, { color: '#d32f2f' }]}>
                  {invoices.filter(i => i.xeroSyncStatus === 'error').length}
                </Text>
                <Text style={styles.syncStatLabel}>Errors</Text>
              </View>
            </View>

            {unsyncedInvoices.length > 0 && (
              <Button
                mode="contained"
                onPress={handleBulkSync}
                loading={xeroLoading}
                disabled={xeroLoading}
                style={styles.syncButton}
                buttonColor={colors.primary}
                icon="sync"
              >
                Sync {unsyncedInvoices.length} invoice{unsyncedInvoices.length === 1 ? '' : 's'}
              </Button>
            )}
          </Surface>
        )}

        {/* How it works */}
        <Surface style={styles.card}>
          <Text style={styles.sectionTitle}>How it works</Text>

          <View style={styles.howItWorksItem}>
            <MaterialCommunityIcons name="numeric-1-circle" size={24} color={colors.primary} />
            <Text style={styles.howItWorksText}>
              Connect your Xero account above
            </Text>
          </View>
          <View style={styles.howItWorksItem}>
            <MaterialCommunityIcons name="numeric-2-circle" size={24} color={colors.primary} />
            <Text style={styles.howItWorksText}>
              Tap "Push to Xero" on any invoice, or sync all at once
            </Text>
          </View>
          <View style={styles.howItWorksItem}>
            <MaterialCommunityIcons name="numeric-3-circle" size={24} color={colors.primary} />
            <Text style={styles.howItWorksText}>
              Invoices, contacts, and payments sync automatically
            </Text>
          </View>
        </Surface>

        <View style={styles.bottomPadding} />
      </WebContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, backgroundColor: colors.background },
  loadingText: { marginTop: 12, color: colors.textMuted, fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
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
  detailValue: { fontSize: 14, fontWeight: '500', color: colors.text },
  divider: { marginVertical: 16, backgroundColor: colors.border },
  disconnectButton: { borderColor: colors.error },
  disconnectedText: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: 16 },
  proNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warningBg,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  proNoticeText: { fontSize: 13, color: colors.warning, marginLeft: 8, fontWeight: '500' },
  connectButton: { marginTop: 4 },
  syncSummary: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  syncStat: { alignItems: 'center' },
  syncStatNumber: { fontSize: 24, fontWeight: '700', color: colors.text },
  syncStatLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  syncButton: { marginTop: 4 },
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
