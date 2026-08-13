/**
 * Customer Screen
 *
 * Everything about one customer in one place: how to reach them, what they owe
 * right now, every job, and every quote and invoice. Reached from the jobs-list
 * search (a matching customer row above the cards), from the "· 4 jobs" marker
 * on a repeat customer's card, and from the Contacts list.
 *
 * The customer is addressed by a DERIVED key, not a foreign key — jobs carry no
 * reliable link to a contact (see customerGroups). The group is recomputed from
 * the live stores on each render, so it stays correct as jobs and documents
 * change underneath.
 *
 * Note on wording: the totals say "This customer", never "Lifetime". The
 * document listener is capped, so on a very long-tenured account the older tail
 * may be absent and a "lifetime" claim would be a number we can't stand behind.
 * `owed` is the number that drives behaviour and unpaid invoices are almost
 * always recent, so it leads.
 */

import React, { useMemo, useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useRoute } from '@react-navigation/native';

import type { Job } from '../../shared/job/types';
import { useJobStore } from '../store/useJobStore';
import { useStore } from '../store/useStore';
import { makeStyles, useThemeColors } from '../theme';
import { WebContainer } from '../components/WebContainer';
import { GridBackground } from '../components/GridBackground';
import { JobCard } from '../components/JobCard';
import { ContactActionsBar } from '../components/document/ContactActionsBar';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { ContactEditModal, type ContactFormValues } from '../components/ContactEditModal';
import { useJobActionsSheet } from '../hooks/useJobActionsSheet';
import { groupDocsByJob } from '../utils/jobBuckets';
import {
  computeCustomerRollup,
  findCustomerGroup,
  groupJobsByCustomer,
} from '../utils/customerGroups';
import { findContactForGroup, planCustomerEdit } from '../utils/customerEdit';
import { formatCurrency } from '../utils/quoteCalculator';
import { lightTap, selectionTap } from '../utils/haptics';

export function CustomerScreen() {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const customerKey: string = route.params?.customerKey ?? '';
  const fallbackName: string | undefined = route.params?.name;
  // Contacts pass their own details as well as a key, because a saved contact's
  // jobs may have grouped under phone or name rather than the contact link.
  const hintPhone: string | undefined = route.params?.phone;
  const hintEmail: string | undefined = route.params?.email;

  const jobs = useJobStore((s) => s.jobs);
  const documents = useStore((s) => s.documents);
  const contacts = useStore((s) => s.contacts);
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const applyCustomerEdit = useStore((s) => s.applyCustomerEdit);
  const canCreateQuote = useStore((s) => s.canCreateQuote);
  const createNewQuote = useStore((s) => s.createNewQuote);

  const [editing, setEditing] = useState(false);

  const actionsSheet = useJobActionsSheet(navigation);

  const docsByJob = useMemo(() => groupDocsByJob(documents), [documents]);

  const group = useMemo(
    () =>
      findCustomerGroup(groupJobsByCustomer(jobs, docsByJob), {
        key: customerKey,
        phone: hintPhone,
        email: hintEmail,
        name: fallbackName,
      }),
    [jobs, docsByJob, customerKey, hintPhone, hintEmail, fallbackName],
  );

  const jobsById = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  const rollup = useMemo(
    () => (group ? computeCustomerRollup(group, jobsById, docsByJob) : null),
    [group, jobsById, docsByJob],
  );

  const customerJobs = useMemo<Job[]>(
    () => (group ? group.jobIds.map((id) => jobsById.get(id)).filter(Boolean as any) : []),
    [group, jobsById],
  );

  /** The saved Contact behind this group, if there is one yet. */
  const contact = useMemo(
    () => (group ? findContactForGroup(group, contacts) : undefined),
    [group, contacts],
  );

  /**
   * Seed the form from the Contact when one exists, otherwise from the group.
   * `address` comes from the Contact ONLY — group.address is the most recent job
   * SITE, and pre-filling it here would invite the tradie to save a site as the
   * customer's address and then wonder why it never matches.
   */
  const formInitial = useMemo<Partial<ContactFormValues>>(
    () => ({
      name: contact?.name ?? group?.name ?? fallbackName ?? '',
      businessName: contact?.businessName,
      email: contact?.email ?? group?.email,
      phone: contact?.phone ?? group?.phone,
      address: contact?.address,
      website: contact?.website,
      notes: contact?.notes,
    }),
    [contact, group, fallbackName],
  );

  const handleSaveEdit = async (values: ContactFormValues) => {
    if (!group) return;
    setEditing(false);
    const plan = planCustomerEdit({ group, jobsById, docsByJob, contacts, fields: values });
    const nextKey = await applyCustomerEdit(plan);
    // The edit can move the customer's derived key (changing the phone changes
    // p:<digits>), so re-point this screen at the now-stable contact key.
    // Without this the screen would be looking at a key that no longer exists.
    navigation.setParams?.({
      customerKey: nextKey,
      name: plan.contact.name,
      phone: plan.contact.phone,
      email: plan.contact.email,
    });
  };

  const handleNewJob = () => {
    if (!group) return;
    if (!canCreateQuote()) {
      navigation.navigate('Paywall', { source: 'customer' });
      return;
    }
    lightTap();
    // Seed the wizard's blank quote with who this is, so a repeat job doesn't
    // mean retyping the customer. Address is left blank on purpose unless the
    // customer has one of their own recorded — the last job's site is often the
    // wrong site, and a quote sent to the wrong address is worse than typing it.
    createNewQuote();
    const draft = useStore.getState().currentQuote;
    if (draft) {
      setCurrentQuote({
        ...draft,
        contactId: contact?.id,
        customerName: group.name,
        customerEmail: contact?.email ?? group.email,
        customerPhone: contact?.phone ?? group.phone,
        jobAddress: contact?.address ?? '',
      });
    }
    navigation.navigate('NewJob');
  };

  React.useEffect(() => {
    navigation.setOptions?.({
      title: group?.name || fallbackName || 'Customer',
      headerRight: () => (
        <Pressable
          onPress={() => {
            selectionTap();
            setEditing(true);
          }}
          hitSlop={12}
          accessibilityLabel="Edit customer details"
          style={({ pressed }) => [styles.headerEdit, pressed && { opacity: 0.6 }]}
        >
          <MaterialCommunityIcons
            name={'pencil-outline' as any}
            size={20}
            color={themeColors.text}
          />
        </Pressable>
      ),
    });
  }, [navigation, group?.name, fallbackName, styles.headerEdit, themeColors.text]);

  // A contact with no jobs is a real state — the Contacts list can reach this
  // screen for someone who was imported but never quoted.
  if (!group || !rollup) {
    return (
      <View style={styles.container}>
        <GridBackground />
        <WebContainer style={styles.emptyWrap}>
          <View style={styles.emptyIconCircle}>
            <MaterialCommunityIcons
              name={'account-outline' as any}
              size={36}
              color={themeColors.accentText}
            />
          </View>
          <Text style={styles.emptyTitle}>No jobs yet</Text>
          <Text style={styles.emptyText}>
            {fallbackName
              ? `Nothing on the books for ${fallbackName} yet`
              : 'Nothing on the books for this customer yet'}
          </Text>
        </WebContainer>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <GridBackground />
      <WebContainer style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content}>
          <ContactActionsBar
            phone={group.phone}
            email={group.email}
            address={group.address}
          />

          <View style={styles.summaryCard}>
            <View style={styles.summaryHeadRow}>
              {/* The edit pencil used to sit right here next to "Owed now",
                  which read as "edit the amount owed" — the last thing you want
                  a tradie to think they can hand-type. It's a header button
                  now, next to the customer's name, where "edit" can only mean
                  the customer. */}
              <Text style={styles.summaryLabel}>Owed now</Text>
              <Text
                style={[
                  styles.summaryValue,
                  rollup.owed > 0 ? styles.summaryValueOwed : styles.summaryValueClear,
                ]}
              >
                {formatCurrency(rollup.owed)}
              </Text>
            </View>
            <View style={styles.summaryMetaRow}>
              <Text style={styles.summaryMeta}>
                {rollup.jobCount} {rollup.jobCount === 1 ? 'job' : 'jobs'}
              </Text>
              {rollup.totalPaid > 0 ? (
                <Text style={styles.summaryMeta}>
                  {formatCurrency(rollup.totalPaid)} paid
                </Text>
              ) : null}
              {rollup.totalQuoted > 0 ? (
                <Text style={styles.summaryMeta}>
                  {formatCurrency(rollup.totalQuoted)} quoted
                </Text>
              ) : null}
            </View>
            {/* Two different facts, labelled as such. The contact's own address
                is the customer's; group.address is only the most recent job's
                SITE, and a customer can have several. Conflating them is how a
                finished job silently gets relocated. */}
            {contact?.address ? (
              <View style={styles.summaryAddressRow}>
                <MaterialCommunityIcons
                  name={'account-outline' as any}
                  size={14}
                  color={themeColors.textMuted}
                />
                <Text style={styles.summaryAddress} numberOfLines={2}>
                  {contact.address}
                </Text>
              </View>
            ) : null}
            {group.address && group.address !== contact?.address ? (
              <View style={styles.summaryAddressRow}>
                <MaterialCommunityIcons
                  name={'map-marker-outline' as any}
                  size={14}
                  color={themeColors.textMuted}
                />
                <Text style={styles.summaryAddress} numberOfLines={2}>
                  Last site: {group.address}
                </Text>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={handleNewJob}
            style={({ pressed }) => [styles.newJobButton, pressed && { opacity: 0.85 }]}
            accessibilityLabel={`New job for ${group.name}`}
          >
            <MaterialCommunityIcons
              name={'plus' as any}
              size={18}
              color={themeColors.onAccent}
            />
            <Text style={styles.newJobLabel} numberOfLines={1}>
              New job for {group.name}
            </Text>
          </Pressable>

          <Text style={styles.sectionLabel}>Jobs</Text>
          {customerJobs.map((job, index) => (
            <AnimatedListItem key={job.id} index={index}>
              <JobCard
                job={job}
                onPress={(jobId) => navigation.navigate('ViewJob', { jobId })}
                onMenuPress={actionsSheet.open}
              />
            </AnimatedListItem>
          ))}

          {/* No "Quotes & invoices" section. A job usually carries exactly one
              document, so listing them again was the same rows a second time
              with less context — the cards above already show each job's money,
              payment state and stage, and tapping the price opens the document.
              The rare job with extra documents shows them under "Also on this
              job" on the job itself, and the jobs search now finds a job by its
              document number, so nothing is lost by dropping it. */}
        </ScrollView>
      </WebContainer>

      {/* No onDelete: removing the contact here would leave all these jobs in
          place, so a Delete button would promise something it doesn't do.
          Deleting a contact stays on the Contacts screen. */}
      <ContactEditModal
        visible={editing}
        onDismiss={() => setEditing(false)}
        onSave={handleSaveEdit}
        initial={formInitial}
        title={contact ? 'Edit customer' : 'Save customer details'}
      />

      {actionsSheet.element}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg },
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 48 },

  summaryCard: {
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: 16,
    marginBottom: 8,
    gap: 8,
  },
  summaryHeadRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  summaryLabel: {
    fontSize: 13,
    fontFamily: 'Archivo-SemiBold',
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerEdit: { paddingHorizontal: 16, paddingVertical: 8 },
  summaryValue: { fontSize: 26, fontFamily: 'Archivo-Bold' },
  summaryValueOwed: { color: t.colors.error },
  summaryValueClear: { color: t.colors.money },
  summaryMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  summaryMeta: { fontSize: 13, color: t.colors.textSecondary },
  summaryAddressRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryAddress: { fontSize: 13, color: t.colors.textMuted, flexShrink: 1 },

  newJobButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: t.colors.accent,
    marginTop: 8,
  },
  newJobLabel: {
    fontSize: 15,
    fontFamily: 'Archivo-Bold',
    color: t.colors.onAccent,
    flexShrink: 1,
  },

  sectionLabel: {
    fontSize: 13,
    fontFamily: 'Archivo-Bold',
    color: t.colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: t.colors.accentSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 22, fontFamily: 'Archivo-Bold', color: t.colors.text, marginBottom: 8 },
  emptyText: {
    fontSize: 16,
    color: t.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
}));
