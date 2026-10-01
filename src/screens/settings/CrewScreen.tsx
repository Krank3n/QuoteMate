/**
 * Crew — the people who work for the business.
 *
 * No logins. The owner logs time for anyone on the list (Log time → who
 * worked it), and each person can have a private link to send their own
 * hours in from their phone's browser. Hours sent in that way wait on the
 * job until the owner approves them.
 */

import React, { useState } from 'react';
import { ScrollView, Share, TouchableOpacity, View, Platform } from 'react-native';
import { Button, Surface, Text, TextInput } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';

import type { CrewMember } from '../../../shared/time/types';
import { useStore } from '../../store/useStore';
import { makeStyles, useThemeColors } from '../../theme';
import { WebContainer } from '../../components/WebContainer';
import { GridBackground } from '../../components/GridBackground';
import { BottomSheet } from '../../components/BottomSheet';
import { useAlertModal } from '../../hooks/useAlertModal';
import {
  activeCrew,
  addCrewMember,
  archiveCrewMember,
  cleanCrewName,
  crewLinkMessage,
  crewLinkUrl,
  parseCostRate,
  parseCrewEmail,
  updateCrewMember,
} from '../../utils/crew';
import { createCrewLink, revokeCrewLink } from '../../services/crewLinkService';
import { formatCurrency } from '../../utils/documentCalculator';

type Editing = { mode: 'add' } | { mode: 'edit'; member: CrewMember };

export function CrewScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const businessSettings = useStore((s) => s.businessSettings);
  const setBusinessSettings = useStore((s) => s.setBusinessSettings);
  const { showAlert, dismissAlert, alertNode } = useAlertModal();

  const [editing, setEditing] = useState<Editing | null>(null);
  const [nameText, setNameText] = useState('');
  const [rateText, setRateText] = useState('');
  const [emailText, setEmailText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const crew = activeCrew(businessSettings?.crew);

  const saveCrew = async (next: CrewMember[]) => {
    if (!businessSettings) throw new Error('Your business details are still loading.');
    // Read the latest settings at write time — a link minted a moment ago
    // must not be overwritten by a stale copy.
    const latest = useStore.getState().businessSettings ?? businessSettings;
    await setBusinessSettings({ ...latest, crew: next });
  };
  const latestCrew = () => useStore.getState().businessSettings?.crew;

  const openAdd = () => {
    setEditing({ mode: 'add' });
    setNameText('');
    setRateText('');
    setEmailText('');
    setFormError(null);
  };
  const openEdit = (member: CrewMember) => {
    setEditing({ mode: 'edit', member });
    setNameText(member.name);
    setRateText(member.costRate ? String(member.costRate) : '');
    setEmailText(member.email ?? '');
    setFormError(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    const exceptId = editing.mode === 'edit' ? editing.member.id : undefined;
    const { name, error } = cleanCrewName(nameText, latestCrew(), exceptId);
    if (error || !name) return setFormError(error ?? 'Give them a name.');
    const rate = parseCostRate(rateText);
    if (rate.error) return setFormError(rate.error);
    const mail = parseCrewEmail(emailText);
    if (mail.error) return setFormError(mail.error);
    setBusy('save');
    try {
      await saveCrew(
        editing.mode === 'add'
          ? addCrewMember(latestCrew(), name, rate.rate, mail.email)
          : updateCrewMember(latestCrew(), editing.member.id, { name, costRate: rate.rate, email: mail.email }),
      );
      setEditing(null);
    } catch (err: any) {
      setFormError(err?.message || "Couldn't save that. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  };

  const shareLink = async (member: CrewMember, token: string) => {
    const message = crewLinkMessage(member.name, businessSettings?.businessName, token);
    try {
      if (Platform.OS === 'web' && !(navigator as any)?.share) {
        await Clipboard.setStringAsync(crewLinkUrl(token));
        showAlert({ type: 'success', title: 'Link copied', message: `Paste it into a text to ${member.name}.` });
        return;
      }
      await Share.share(Platform.OS === 'ios' ? { message, url: crewLinkUrl(token) } : { message });
    } catch {
      // Share sheet dismissed — nothing to do.
    }
  };

  // Always a fresh link. The copy of the token on this phone can be stale (a
  // link made or turned off on another device), and re-sharing a dead token
  // would look fine here and fail on the crew member's phone. Minting a new
  // one retires the old, so there's only ever one live link per person.
  // With an email on file the server sends the link itself, in the business's
  // name; without one it's the share sheet (a text, WhatsApp, the Mail app).
  const handleSendLink = async (member: CrewMember) => {
    setBusy(`link:${member.id}`);
    try {
      const { token, emailed } = await createCrewLink(member.id, { email: !!member.email });
      await saveCrew(updateCrewMember(latestCrew(), member.id, { linkToken: token, linkIssuedAt: Date.now() }));
      if (member.email && emailed) {
        showAlert({
          type: 'success',
          title: 'Link sent',
          message: `Emailed to ${member.email}. ${member.name.split(' ')[0]} opens it on their phone and puts their hours in — you approve them on the job.`,
        });
      } else if (member.email) {
        showAlert({
          type: 'error',
          title: "The email didn't go",
          message: `The link's ready, but the email to ${member.email} didn't send. Share it by text instead?`,
          primaryButtonText: 'Share it',
          primaryButtonAction: () => shareLink(member, token),
          secondaryButtonText: 'Not now',
          secondaryButtonAction: () => {},
        });
      } else {
        await shareLink(member, token);
      }
    } catch (err: any) {
      showAlert({ type: 'error', title: "Couldn't make the link", message: err?.message || 'Try again in a moment.' });
    } finally {
      setBusy(null);
    }
  };

  const handleTurnOffLink = (member: CrewMember) => {
    showAlert({
      type: 'warning',
      title: `Turn off ${member.name}'s link?`,
      message: "It stops working straight away. Hours they've already sent in stay on the job.",
      primaryButtonText: 'Turn it off',
      primaryKeepsOpen: true,
      primaryButtonAction: async () => {
        try {
          await revokeCrewLink(member.id);
          await saveCrew(updateCrewMember(latestCrew(), member.id, { linkToken: undefined, linkIssuedAt: undefined }));
          dismissAlert();
          setEditing(null);
        } catch (err: any) {
          showAlert({ type: 'error', title: "Couldn't turn it off", message: err?.message || 'Try again in a moment.' });
        }
      },
      secondaryButtonText: 'Keep it',
      secondaryButtonAction: () => {},
    });
  };

  const handleRemove = (member: CrewMember) => {
    showAlert({
      type: 'warning',
      title: `Take ${member.name} off your crew?`,
      message: 'Their link stops working. Time they already worked stays on your jobs and timesheets.',
      primaryButtonText: 'Take them off',
      primaryKeepsOpen: true,
      primaryButtonAction: async () => {
        try {
          // Revoke whether or not this phone knows of a link — one made on
          // another device is still live, and archiving alone could be undone
          // by a stale copy of the settings being written back.
          await revokeCrewLink(member.id);
          await saveCrew(archiveCrewMember(latestCrew(), member.id));
          dismissAlert();
          setEditing(null);
        } catch (err: any) {
          showAlert({ type: 'error', title: "Couldn't do that", message: err?.message || 'Try again in a moment.' });
        }
      },
      secondaryButtonText: 'Cancel',
      secondaryButtonAction: () => {},
    });
  };

  const editingMember = editing?.mode === 'edit' ? crew.find((c) => c.id === editing.member.id) ?? editing.member : null;

  return (
    <View style={styles.host}>
      <GridBackground />
      <ScrollView style={styles.scroller}>
        <WebContainer>
          <View style={styles.content}>
            <Text style={styles.intro}>
              Add the people who work for you. When you log time you can pick who worked it — and each person can
              have their own link to send their hours in from their phone. You approve what comes in before it counts.
            </Text>

            {crew.length === 0 ? (
              <Surface style={styles.empty}>
                <MaterialCommunityIcons name="account-hard-hat" size={28} color={themeColors.textMuted} />
                <Text style={styles.emptyText}>No one on your crew yet.</Text>
              </Surface>
            ) : (
              crew.map((member) => (
                <TouchableOpacity
                  key={member.id}
                  style={styles.row}
                  onPress={() => openEdit(member)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${member.name}`}
                >
                  <MaterialCommunityIcons name="account-hard-hat" size={22} color={themeColors.accentText} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{member.name}</Text>
                    <Text style={styles.rowSub}>
                      {[
                        member.email ? member.email : null,
                        member.costRate ? `${formatCurrency(member.costRate)}/h cost` : null,
                        member.linkToken ? 'Link on' : 'No link',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Button
                    mode="text"
                    compact
                    icon="send-outline"
                    loading={busy === `link:${member.id}`}
                    disabled={!!busy}
                    onPress={() => handleSendLink(member)}
                  >
                    {member.email ? 'Email link' : 'Send link'}
                  </Button>
                </TouchableOpacity>
              ))
            )}

            <Button mode="contained" icon="account-plus-outline" onPress={openAdd} style={styles.addButton}
              buttonColor={themeColors.accent} textColor={themeColors.onAccent}>
              Add someone
            </Button>
          </View>
        </WebContainer>
      </ScrollView>

      <BottomSheet
        visible={!!editing}
        onDismiss={() => setEditing(null)}
        title={editing?.mode === 'edit' ? 'Edit crew member' : 'Add to your crew'}
        scrollable
      >
        <View style={styles.form}>
          <TextInput
            label="Name"
            value={nameText}
            onChangeText={(t) => {
              setNameText(t);
              setFormError(null);
            }}
            mode="outlined"
            autoCapitalize="words"
            accessibilityLabel="Name"
          />
          <TextInput
            label="Email (optional) — we send their link here"
            value={emailText}
            onChangeText={(t) => {
              setEmailText(t);
              setFormError(null);
            }}
            mode="outlined"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Email"
          />
          <TextInput
            label="What they cost you an hour (optional)"
            value={rateText}
            onChangeText={(t) => {
              setRateText(t);
              setFormError(null);
            }}
            mode="outlined"
            keyboardType="decimal-pad"
            left={<TextInput.Affix text="$" />}
            accessibilityLabel="Cost per hour"
          />
          <Text style={styles.hint}>Only you see this — it goes on your timesheet, never on a quote or invoice.</Text>
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          <Button
            mode="contained"
            onPress={handleSave}
            loading={busy === 'save'}
            disabled={!!busy}
            buttonColor={themeColors.accent}
            textColor={themeColors.onAccent}
            style={styles.saveButton}
          >
            {editing?.mode === 'edit' ? 'Save' : 'Add to crew'}
          </Button>

          {editingMember ? (
            <View style={styles.linkBox}>
              <Text style={styles.linkTitle}>Their link</Text>
              <Text style={styles.hint}>
                {editingMember.linkToken
                  ? 'They open it on their phone, pick a job and put their hours in. No app, no account. Sending a new link turns the old one off.'
                  : 'A private link they open on their phone to send you their hours. No app, no account.'}
              </Text>
              <View style={styles.linkActions}>
                <Button mode="outlined" icon="send-outline" disabled={!!busy} onPress={() => handleSendLink(editingMember)}>
                  {editingMember.email
                    ? (editingMember.linkToken ? 'Email a new link' : 'Email link')
                    : (editingMember.linkToken ? 'Send a new link' : 'Send link')}
                </Button>
                {editingMember.linkToken ? (
                  <>
                    <Button mode="text" textColor={themeColors.error} onPress={() => handleTurnOffLink(editingMember)}>
                      Turn off
                    </Button>
                  </>
                ) : null}
              </View>
            </View>
          ) : null}

          {editingMember ? (
            <Button mode="text" textColor={themeColors.error} icon="account-remove-outline" onPress={() => handleRemove(editingMember)}>
              Take off crew
            </Button>
          ) : null}
        </View>
        {alertNode}
      </BottomSheet>
      {!editing ? alertNode : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  host: { flex: 1, backgroundColor: t.colors.bg },
  scroller: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  intro: { fontSize: 14, color: t.colors.textSecondary, lineHeight: 20, marginBottom: 6 },
  empty: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.colors.surfaceRaised,
  },
  emptyText: { fontSize: 14, color: t.colors.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: t.colors.surfaceRaised,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  rowTitle: { fontSize: 15, fontWeight: '600', color: t.colors.text },
  rowSub: { fontSize: 12, color: t.colors.textMuted, marginTop: 2 },
  addButton: { borderRadius: 12, marginTop: 6 },
  form: { gap: 10, paddingVertical: 4 },
  hint: { fontSize: 12, color: t.colors.textMuted, lineHeight: 17 },
  error: { fontSize: 13, color: t.colors.error },
  saveButton: { borderRadius: 12 },
  linkBox: {
    marginTop: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: t.colors.surface,
    gap: 6,
  },
  linkTitle: { fontSize: 14, fontWeight: '700', color: t.colors.text },
  linkActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
}));
