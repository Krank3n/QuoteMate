/**
 * GoogleCalendarIntegrationScreen
 *
 * Settings → Integrations → Google Calendar. Owns the on/off UI for the
 * Phase-14 sync. Heavy lifting (OAuth, token storage, server-side
 * push) lives elsewhere; this screen only renders state + the connect
 * / disconnect buttons.
 */

import React from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, Button, Surface, ActivityIndicator } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { format, formatDistanceToNow } from 'date-fns';

import { colors } from '../../theme';
import { useGoogleCalendarAuth } from '../../services/googleCalendarAuth';

export function GoogleCalendarIntegrationScreen() {
  const { ready, pending, lastError, connection, connect, disconnect } =
    useGoogleCalendarAuth();
  const isConnected = !!connection;

  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Google Calendar?',
      'Future Job changes won’t push to your calendar. Existing events stay where they are — you can clean them up in Google Calendar if you want.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => disconnect() },
      ],
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Surface style={styles.heroCard}>
        <View
          style={[
            styles.heroIcon,
            isConnected ? styles.heroIconConnected : styles.heroIconIdle,
          ]}
        >
          <MaterialCommunityIcons
            name={(isConnected ? 'calendar-check' : 'calendar-sync') as any}
            size={28}
            color={isConnected ? colors.success : colors.primary}
          />
        </View>
        <Text style={styles.heroTitle}>
          {isConnected ? 'Connected' : 'Connect Google Calendar'}
        </Text>
        <Text style={styles.heroSubtitle}>
          {isConnected
            ? `Linked${connection.email ? ` to ${connection.email}` : ''}${
                connection.connectedAt
                  ? ' · ' +
                    formatDistanceToNow(new Date(connection.connectedAt), {
                      addSuffix: true,
                    })
                  : ''
              }`
            : 'Job schedules will appear in your calendar automatically. Reschedule or delete from the Job — we mirror the change across.'}
        </Text>

        {connection?.lastSyncError ? (
          <View style={styles.errorBanner}>
            <MaterialCommunityIcons
              name={'alert-circle' as any}
              size={16}
              color={colors.error}
            />
            <Text style={styles.errorText} numberOfLines={3}>
              Last sync failed: {connection.lastSyncError.message}
              {connection.lastSyncError.at
                ? ' · ' +
                  format(new Date(connection.lastSyncError.at), 'd MMM h:mm a').toLowerCase()
                : ''}
            </Text>
          </View>
        ) : null}

        {lastError ? (
          <View style={styles.errorBanner}>
            <MaterialCommunityIcons
              name={'alert-circle' as any}
              size={16}
              color={colors.error}
            />
            <Text style={styles.errorText}>{lastError}</Text>
          </View>
        ) : null}

        {!isConnected ? (
          <Button
            mode="contained"
            icon={'google' as any}
            onPress={connect}
            disabled={!ready || pending}
            loading={pending}
            style={styles.primaryButton}
            contentStyle={styles.primaryButtonContent}
          >
            Connect Google Calendar
          </Button>
        ) : (
          <Button
            mode="outlined"
            icon={'link-variant-off' as any}
            onPress={handleDisconnect}
            disabled={pending}
            loading={pending}
            textColor={colors.error}
            style={[styles.secondaryButton, { borderColor: colors.error + '66' }]}
          >
            Disconnect
          </Button>
        )}

        {!ready && !connection ? (
          <View style={styles.initRow}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={styles.initLabel}>Loading…</Text>
          </View>
        ) : null}
      </Surface>

      <Surface style={styles.infoCard}>
        <Text style={styles.infoTitle}>How it works</Text>
        <InfoRow
          icon="calendar-plus"
          title="Schedule a job"
          body="Tap the schedule card on a job, pick a day + time. We push it to your calendar within seconds."
        />
        <InfoRow
          icon="calendar-edit"
          title="Edit anywhere"
          body="Reschedule from the app and the calendar event updates. Reschedules from inside Google Calendar don’t flow back today — open the job in QuoteMate to edit."
        />
        <InfoRow
          icon="calendar-remove"
          title="Disconnect cleanly"
          body="Disconnecting revokes our access at Google. Past events stay in your calendar — clean them up there if you don’t want them."
        />
      </Surface>

      <Text style={styles.footnote}>
        We only ask for permission to manage events on your calendar
        (calendar.events). We can’t read events you didn’t create with us.
      </Text>
    </ScrollView>
  );
}

function InfoRow({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <MaterialCommunityIcons name={icon as any} size={18} color={colors.primary} />
      </View>
      <View style={styles.infoBody}>
        <Text style={styles.infoRowTitle}>{title}</Text>
        <Text style={styles.infoRowBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 14,
  },
  heroCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: 8,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  heroIconIdle: {
    backgroundColor: colors.primaryBg,
  },
  heroIconConnected: {
    backgroundColor: colors.successBg,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  heroSubtitle: {
    fontSize: 13,
    color: colors.onSurface,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 8,
  },
  primaryButton: {
    alignSelf: 'stretch',
    borderRadius: 12,
    marginTop: 8,
  },
  primaryButtonContent: {
    paddingVertical: 6,
  },
  secondaryButton: {
    alignSelf: 'stretch',
    borderRadius: 12,
    marginTop: 8,
  },
  initRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  initLabel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.errorBg,
    alignSelf: 'stretch',
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: colors.error,
    lineHeight: 16,
  },
  infoCard: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    gap: 12,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  infoRow: {
    flexDirection: 'row',
    gap: 10,
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBody: {
    flex: 1,
    gap: 2,
  },
  infoRowTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  infoRowBody: {
    fontSize: 12,
    color: colors.onSurface,
    lineHeight: 17,
  },
  footnote: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 12,
    lineHeight: 15,
  },
});
