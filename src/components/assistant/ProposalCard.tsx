import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme';
import { Proposal, ProposalStatus } from '../../types/assistant';

interface Props {
  proposal: Proposal;
  status: ProposalStatus;
  onApply: () => void;
  onDismiss: () => void;
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ProposalCard({ proposal, status, onApply, onDismiss }: Props) {
  const isDestructive = proposal.type === 'propose_send_quote' || proposal.type === 'propose_delete_line_item';
  const applyColor = isDestructive ? colors.error : colors.success;
  const applyLabel = labelFor(proposal);
  const applied = status === 'applied';
  const dismissed = status === 'dismissed';
  const failed = status === 'failed';

  return (
    <View style={[styles.card, applied && styles.cardApplied, dismissed && styles.cardDismissed]}>
      <View style={styles.headerRow}>
        <MaterialCommunityIcons name={iconFor(proposal)} size={18} color={colors.textMuted} />
        <Text style={styles.title}>{titleFor(proposal)}</Text>
      </View>

      <Body proposal={proposal} />

      {status === 'pending' ? (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} accessibilityRole="button">
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: applyColor }]}
            onPress={onApply}
            accessibilityRole="button"
          >
            <Text style={styles.applyText}>{applyLabel}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.statusRow}>
          <MaterialCommunityIcons
            name={applied ? 'check-circle' : failed ? 'alert-circle' : 'close-circle'}
            size={16}
            color={applied ? colors.success : failed ? colors.error : colors.textMuted}
          />
          <Text style={[styles.statusText, failed && { color: colors.error }]}>
            {applied ? 'Applied' : failed ? 'Failed' : 'Dismissed'}
          </Text>
        </View>
      )}
    </View>
  );
}

function titleFor(p: Proposal): string {
  switch (p.type) {
    case 'propose_draft_quote': return 'Draft quote';
    case 'propose_add_line_item': return 'Add line item';
    case 'propose_delete_line_item': return 'Delete line item';
    case 'propose_create_contact': return 'New contact';
    case 'propose_update_customer': return 'Change customer';
    case 'propose_send_quote': return 'Send quote';
    case 'propose_convert_to_invoice': return 'Convert to invoice';
    case 'propose_reprice': return 'Re-price quote';
  }
}

function iconFor(p: Proposal): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  switch (p.type) {
    case 'propose_draft_quote': return 'file-document-edit-outline';
    case 'propose_add_line_item': return 'plus-circle-outline';
    case 'propose_delete_line_item': return 'trash-can-outline';
    case 'propose_create_contact': return 'account-plus-outline';
    case 'propose_update_customer': return 'account-switch-outline';
    case 'propose_send_quote': return 'send-outline';
    case 'propose_convert_to_invoice': return 'cash-multiple';
    case 'propose_reprice': return 'refresh';
  }
}

function labelFor(p: Proposal): string {
  switch (p.type) {
    case 'propose_send_quote': return 'Send';
    case 'propose_delete_line_item': return 'Delete';
    case 'propose_convert_to_invoice': return 'Convert';
    case 'propose_reprice': return 'Re-price';
    default: return 'Apply';
  }
}

function Body({ proposal }: { proposal: Proposal }) {
  switch (proposal.type) {
    case 'propose_draft_quote':
      return (
        <View>
          <Text style={styles.summary}>{proposal.jobName}</Text>
          {!!proposal.customerDraft?.name && (
            <Text style={styles.dim}>New contact: {proposal.customerDraft.name}</Text>
          )}
          <Text style={styles.scope} numberOfLines={6}>{proposal.jobDescription}</Text>
          <Text style={styles.dim}>
            Apply runs the materials + pricing pipeline.
            {typeof proposal.estimatedDurationHours === 'number'
              ? ` Labour seeded at ${proposal.estimatedDurationHours} h.`
              : ''}
          </Text>
        </View>
      );
    case 'propose_add_line_item':
      return (
        <View>
          <Text style={styles.summary}>{proposal.qty} {proposal.unit} · {proposal.searchTerm}</Text>
          <Text style={styles.dim}>Pipeline will price this on apply.</Text>
        </View>
      );
    case 'propose_delete_line_item':
      return (
        <View>
          <Text style={styles.warningBanner}>This will remove the line from the quote.</Text>
          {proposal.displayName ? (
            <Text style={styles.summary} numberOfLines={2}>
              {proposal.displayQty != null && proposal.displayUnit
                ? `${proposal.displayQty} ${proposal.displayUnit} · `
                : ''}
              {proposal.displayName}
            </Text>
          ) : (
            <Text style={styles.dim}>Line id {proposal.materialId.slice(0, 8)}…</Text>
          )}
          {typeof proposal.displayTotal === 'number' && (
            <Text style={styles.dim}>Removing {formatCurrency(proposal.displayTotal)} from the total.</Text>
          )}
        </View>
      );
    case 'propose_create_contact':
      return (
        <View>
          <Text style={styles.summary}>{proposal.name}</Text>
          {!!proposal.phone && <Text style={styles.dim}>{proposal.phone}</Text>}
          {!!proposal.email && <Text style={styles.dim}>{proposal.email}</Text>}
          {!!proposal.address && <Text style={styles.dim}>{proposal.address}</Text>}
        </View>
      );
    case 'propose_update_customer':
      return (
        <View>
          <Text style={styles.summary}>{proposal.customerName || proposal.customerDraft?.name || 'New customer'}</Text>
          {!!proposal.customerDraft?.name && !proposal.customerId && (
            <Text style={styles.dim}>New contact</Text>
          )}
          {!!proposal.customerDraft?.phone && <Text style={styles.dim}>{proposal.customerDraft.phone}</Text>}
          {!!proposal.customerDraft?.email && <Text style={styles.dim}>{proposal.customerDraft.email}</Text>}
          <Text style={styles.dim}>Apply re-points this quote at this customer.</Text>
        </View>
      );
    case 'propose_send_quote':
      return (
        <View>
          <Text style={styles.warningBanner}>Opens the send preview — you confirm the recipient and tap send.</Text>
          {!!proposal.recipientEmail && (
            <Text style={styles.summary}>To: {proposal.recipientEmail}</Text>
          )}
          {!!proposal.draftEmailBody && (
            <Text style={styles.dim}>Email drafted — edit it in the preview before sending.</Text>
          )}
        </View>
      );
    case 'propose_convert_to_invoice':
      return <Text style={styles.summary}>Convert the accepted quote into an invoice.</Text>;
    case 'propose_reprice':
      return (
        <View>
          {proposal.displayName ? (
            <Text style={styles.summary} numberOfLines={2}>{proposal.displayName}</Text>
          ) : null}
          {typeof proposal.displayTotal === 'number' && (
            <Text style={styles.dim}>Current total {formatCurrency(proposal.displayTotal)}.</Text>
          )}
          <Text style={styles.dim}>Apply re-fetches prices for the flagged rows and reconciles again.</Text>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceDark,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    marginVertical: 6,
    marginHorizontal: 12,
  },
  cardApplied: {
    borderColor: colors.success,
    opacity: 0.85,
  },
  cardDismissed: { opacity: 0.55 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  title: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summary: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  dim: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  scope: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  section: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sectionName: {
    color: colors.textDark,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 2,
  },
  lineName: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    marginRight: 8,
  },
  linePrice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  priceText: { color: colors.textDark, fontSize: 13 },
  estimateBadge: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: colors.warningBg,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: { color: colors.textMuted, fontSize: 13 },
  totalValue: { color: colors.text, fontSize: 14, fontWeight: '700' },
  warningBanner: {
    color: colors.warning,
    fontSize: 12,
    marginBottom: 6,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    gap: 8,
  },
  dismissBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  dismissText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  applyBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  applyText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  statusText: { color: colors.textMuted, fontSize: 12 },
});
