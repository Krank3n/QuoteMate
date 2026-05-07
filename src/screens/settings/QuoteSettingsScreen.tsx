/**
 * Quote Settings Screen
 * Default rates for new quotes
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {
  Text,
  TextInput,
  Surface,
  Switch,
  Title,
} from 'react-native-paper';

import { useStore } from '../../store/useStore';
import { colors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { FixedBottomButton } from '../../components/FixedBottomButton';
import { AlertModal } from '../../components/AlertModal';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';

export function QuoteSettingsScreen() {
  const { businessSettings, setBusinessSettings } = useStore();

  const [laborRate, setLaborRate] = useState('85');
  const [markup, setMarkup] = useState('20');
  const [laborMarkup, setLaborMarkup] = useState('20');
  const [autoFollowUp, setAutoFollowUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const initialSnapshotRef = useRef<string | null>(null);

  useEffect(() => {
    if (businessSettings) {
      const lr = businessSettings.defaultLaborRate.toString();
      const mk = businessSettings.defaultMarkup.toString();
      const lm = (businessSettings.defaultLaborMarkup ?? businessSettings.defaultMarkup).toString();
      const fu = businessSettings.autoCustomerFollowUpEnabled === true;
      setLaborRate(lr);
      setMarkup(mk);
      setLaborMarkup(lm);
      setAutoFollowUp(fu);
      initialSnapshotRef.current = JSON.stringify({ lr, mk, lm, fu });
    }
  }, [businessSettings]);

  const isDirty = useMemo(() => {
    if (!initialSnapshotRef.current) return false;
    return JSON.stringify({ lr: laborRate, mk: markup, lm: laborMarkup, fu: autoFollowUp }) !== initialSnapshotRef.current;
  }, [laborRate, markup, laborMarkup, autoFollowUp]);

  const handleSave = async (opts?: { silent?: boolean }): Promise<boolean> => {
    try {
      setIsLoading(true);
      await setBusinessSettings({
        ...businessSettings!,
        defaultLaborRate: parseFloat(laborRate) || 85,
        defaultMarkup: parseFloat(markup) || 20,
        defaultLaborMarkup: parseFloat(laborMarkup) || 0,
        autoCustomerFollowUpEnabled: autoFollowUp,
      });
      initialSnapshotRef.current = JSON.stringify({ lr: laborRate, mk: markup, lm: laborMarkup, fu: autoFollowUp });
      if (!opts?.silent) setShowSuccessModal(true);
      return true;
    } catch (error) {
      setShowErrorModal(true);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const { unsavedModalProps } = useUnsavedChangesGuard({
    isDirty,
    onSave: () => handleSave({ silent: true }),
  });

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <WebContainer>
          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Default Rates</Title>
            <Text style={styles.helperText}>
              These will be used as defaults for new quotes
            </Text>

            <TextInput
              label="Hourly Labor Rate"
              value={laborRate}
              onChangeText={setLaborRate}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              left={<TextInput.Affix text="$" />}
              right={<TextInput.Affix text="/hr" />}
            />

            <TextInput
              label="Material Markup"
              value={markup}
              onChangeText={setMarkup}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              right={<TextInput.Affix text="%" />}
            />

            <TextInput
              label="Labour Markup"
              value={laborMarkup}
              onChangeText={setLaborMarkup}
              mode="outlined"
              style={styles.input}
              keyboardType="decimal-pad"
              right={<TextInput.Affix text="%" />}
            />
          </Surface>

          <Surface style={styles.card}>
            <Title style={styles.sectionTitle}>Customer Follow-Ups</Title>
            <Text style={styles.helperText}>
              Automatically chase customers who haven&rsquo;t accepted yet.
            </Text>

            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={styles.toggleTitle}>Auto follow-up customers</Text>
                <Text style={styles.toggleDescription}>
                  Sends a reminder ~3 days after a quote is sent and again at ~7 days. Stops as soon as the customer accepts or declines. Capped at 2 reminders.
                </Text>
              </View>
              <Switch
                value={autoFollowUp}
                onValueChange={setAutoFollowUp}
                color={colors.primary}
              />
            </View>
          </Surface>
        </WebContainer>
      </ScrollView>

      <FixedBottomButton
        mode="contained"
        label="Save"
        onPress={() => handleSave()}
        disabled={isLoading}
        loading={isLoading}
      />

      <AlertModal
        visible={showSuccessModal}
        onDismiss={() => setShowSuccessModal(false)}
        type="success"
        title="Saved!"
        message="Your quote settings have been updated."
      />

      <AlertModal
        visible={showErrorModal}
        onDismiss={() => setShowErrorModal(false)}
        type="error"
        title="Save Failed"
        message="Failed to save settings. Please try again."
      />

      <AlertModal {...unsavedModalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    padding: 20,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 2,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  input: {
    marginBottom: 16,
  },
  helperText: {
    fontSize: 14,
    color: colors.onSurface,
    marginBottom: 16,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  toggleLabel: { flex: 1, marginRight: 12 },
  toggleTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  toggleDescription: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
});
