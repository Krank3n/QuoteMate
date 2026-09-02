import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { makeStyles, useThemeColors } from '../../theme';
import { Proposal, ProposalStatus } from '../../types/assistant';
import { applyLabelFor, iconFor, titleFor } from './proposalCardCopy';
import { rateLineUnitPrice, rateLinesCoverMaterials, rateSummary, rateUnitLabel } from '../../services/quotingProfile';
import { registeredBusinessSettings } from '../../services/assistant/quotingProfileContext';
import { resolveGstMode } from '../../../shared/document/gstMode';

interface Props {
  proposal: Proposal;
  status: ProposalStatus;
  onApply: () => void;
  onDismiss: () => void;
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ProposalCardImpl({ proposal, status, onApply, onDismiss }: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  // Sending isn't destructive — it's the whole point. A red Apply put it in
  // the same visual bracket as Delete Quote, on the card Mate now offers most.
  const isDestructive =
    proposal.type === 'propose_delete_line_item' ||
    proposal.type === 'propose_delete_quote';
  const applyColor = isDestructive ? themeColors.error : themeColors.money;
  const applyLabel = applyLabelFor(proposal);
  const applied = status === 'applied';
  const dismissed = status === 'dismissed';
  const failed = status === 'failed';

  return (
    <View style={[styles.card, applied && styles.cardApplied, dismissed && styles.cardDismissed]}>
      <View style={styles.headerRow}>
        <MaterialCommunityIcons
          name={iconFor(proposal) as React.ComponentProps<typeof MaterialCommunityIcons>['name']}
          size={18}
          color={themeColors.textMuted}
        />
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
            color={applied ? themeColors.money : failed ? themeColors.error : themeColors.textMuted}
          />
          <Text style={[styles.statusText, failed && { color: themeColors.error }]}>
            {applied ? 'Applied' : failed ? 'Failed' : 'Dismissed'}
          </Text>
        </View>
      )}
    </View>
  );
}

function Body({ proposal }: { proposal: Proposal }) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  // A Mate draft is minted from business settings, so the document's GST
  // mode is the business's — read once, here, for the draft card's rate lines.
  const settings = registeredBusinessSettings();
  const docMode = resolveGstMode(settings ?? {});
  const businessInclusive = settings?.pricesIncludeGst === true;
  switch (proposal.type) {
    case 'propose_draft_quote':
      return (
        <View>
          <Text style={styles.summary}>{proposal.jobName}</Text>
          {!!proposal.customerDraft?.name && (
            <Text style={styles.dim}>New contact: {proposal.customerDraft.name}</Text>
          )}
          <Text style={styles.scope} numberOfLines={6}>{proposal.jobDescription}</Text>
          {(proposal.rateLines ?? []).map((line, i) => {
            // The same conversion the apply path runs, so the card shows the
            // money that will land on the quote — not the number as said.
            const unitPrice = rateLineUnitPrice(line, docMode, businessInclusive);
            return (
              <Text key={`${line.label}-${i}`} style={styles.dim}>
                {line.label}: {line.quantity} {line.unit === 'each' ? '×' : `${line.unit} ×`} {formatCurrency(unitPrice)}
                {line.unit === 'each' ? '' : ` ${rateUnitLabel(line.unit)}`} = {formatCurrency(Math.round(unitPrice * line.quantity * 100) / 100)}
                {docMode === 'inclusive' ? ' inc GST' : docMode === 'exclusive' ? ' ex GST' : ''}
              </Text>
            );
          })}
          <Text style={styles.dim}>
            {rateLinesCoverMaterials(proposal.rateLines)
              ? 'Priced off your rate card — no materials list, no extra labour.'
              : proposal.materialsMode === 'labour_only'
                ? 'Labour only — hours and sections, no materials list.'
                : `I'll work out the materials and price them up${
                    proposal.rateLines?.length ? ' on top of your rate' : ''
                  }${proposal.documentType === 'invoice' ? ' and convert the result to an invoice' : ''}.${
                    typeof proposal.estimatedDurationHours === 'number' && !proposal.rateLines?.length
                      ? ` Labour seeded at ${proposal.estimatedDurationHours} h.`
                      : ''
                  }`}
          </Text>
        </View>
      );
    case 'propose_remember_preference':
      return (
        <View>
          <Text style={styles.summary}>“{proposal.text}”</Text>
          <Text style={styles.dim}>I'll follow this on every quote from now on. Remove it any time under Trade pricing.</Text>
        </View>
      );
    case 'propose_save_rate':
      return (
        <View>
          <Text style={styles.summary}>{proposal.label}</Text>
          <Text style={styles.dim}>{rateSummary(proposal)}</Text>
          <Text style={styles.dim}>Goes on your rate card — I'll use it whenever it fits a job.</Text>
        </View>
      );
    case 'propose_add_line_item':
      return (
        <View>
          <Text style={styles.summary}>{proposal.qty} {proposal.unit} · {proposal.searchTerm}</Text>
          <Text style={styles.dim}>I'll price this one up.</Text>
        </View>
      );
    case 'propose_update_line_item': {
      // Show the change, not just the new value — "$100" alone doesn't tell
      // the tradie whether Mate heard them right.
      const changes: string[] = [];
      if (proposal.price !== undefined) {
        changes.push(
          proposal.displayCurrentPrice != null
            ? `${formatCurrency(proposal.displayCurrentPrice)} → ${formatCurrency(proposal.price)}${proposal.displayUnit ? ` per ${proposal.displayUnit}` : ''}`
            : `${formatCurrency(proposal.price)}${proposal.displayUnit ? ` per ${proposal.displayUnit}` : ''}`,
        );
      }
      if (proposal.quantity !== undefined) {
        changes.push(
          proposal.displayCurrentQty != null
            ? `${proposal.displayCurrentQty} → ${proposal.quantity}${proposal.displayUnit ? ` ${proposal.displayUnit}` : ''}`
            : `${proposal.quantity}${proposal.displayUnit ? ` ${proposal.displayUnit}` : ''}`,
        );
      }
      if (proposal.name !== undefined) changes.push(`renamed to “${proposal.name}”`);
      return (
        <View>
          <Text style={styles.summary} numberOfLines={2}>
            {proposal.displayName || `Line ${proposal.materialId.slice(0, 8)}…`}
          </Text>
          <Text style={styles.dim}>{changes.join(' · ')}</Text>
          {proposal.price !== undefined && (
            <Text style={styles.dim}>
              Priced by you, so it won't be flagged as an estimate.
              {proposal.price > 0 ? ' Saved to your supplier book for next time.' : ''}
            </Text>
          )}
        </View>
      );
    }
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
    case 'propose_delete_quote': {
      const noun = proposal.displayDocType === 'invoice' ? 'invoice' : 'quote';
      const title = [proposal.displayCustomerName, proposal.displayName]
        .filter(Boolean)
        .join(' — ');
      return (
        <View>
          <Text style={styles.warningBanner}>
            This will permanently delete the whole {noun} — every line on it.
          </Text>
          {title ? (
            <Text style={styles.summary} numberOfLines={2}>{title}</Text>
          ) : (
            <Text style={styles.dim}>Doc id {proposal.quoteId.slice(0, 8)}…</Text>
          )}
          {typeof proposal.displayTotal === 'number' && (
            <Text style={styles.dim}>Total {formatCurrency(proposal.displayTotal)}.</Text>
          )}
        </View>
      );
    }
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
          {/* dim, not warningBanner — that style is for destructive warnings,
              and this is the card we most want tapped. */}
          <Text style={styles.dim}>Opens the send preview — you confirm the recipient and tap send.</Text>
          {!!proposal.recipientEmail && (
            <Text style={styles.summary}>To: {proposal.recipientEmail}</Text>
          )}
          {typeof proposal.displayTotal === 'number' && (
            <Text style={styles.dim}>Total {formatCurrency(proposal.displayTotal)}.</Text>
          )}
          {(!!proposal.draftEmailSubject || !!proposal.draftEmailBody) && (
            <View style={styles.emailPreview}>
              {!!proposal.draftEmailSubject && (
                <>
                  <Text style={styles.emailLabel}>Subject</Text>
                  <Text style={styles.emailSubject}>{proposal.draftEmailSubject}</Text>
                </>
              )}
              {!!proposal.draftEmailBody && (
                <>
                  <Text style={[styles.emailLabel, { marginTop: 8 }]}>Message</Text>
                  <Text style={styles.emailBody}>{proposal.draftEmailBody}</Text>
                </>
              )}
              <Text style={styles.dim}>You can tweak it in the send preview before it goes.</Text>
            </View>
          )}
        </View>
      );
    case 'propose_convert_to_invoice':
      return <Text style={styles.summary}>Convert the accepted quote into an invoice.</Text>;
    case 'propose_update_quote_rates':
      return (
        <View>
          {proposal.displayName ? (
            <Text style={styles.summary} numberOfLines={2}>{proposal.displayName}</Text>
          ) : null}
          {typeof proposal.markup === 'number' && (
            <Text style={styles.dim}>Material markup → {proposal.markup}%</Text>
          )}
          {typeof proposal.laborMarkup === 'number' && (
            <Text style={styles.dim}>Labour markup → {proposal.laborMarkup}%</Text>
          )}
          {typeof proposal.laborRate === 'number' && (
            <Text style={styles.dim}>Labour rate → {formatCurrency(proposal.laborRate)}/h</Text>
          )}
          {typeof proposal.laborHours === 'number' && (
            <Text style={styles.dim}>Labour hours → {proposal.laborHours} h</Text>
          )}
          <Text style={styles.dim}>Updates the quote and re-does the totals.</Text>
        </View>
      );
    case 'propose_reprice':
      return (
        <View>
          {proposal.displayName ? (
            <Text style={styles.summary} numberOfLines={2}>{proposal.displayName}</Text>
          ) : null}
          {typeof proposal.displayTotal === 'number' && (
            <Text style={styles.dim}>Current total {formatCurrency(proposal.displayTotal)}.</Text>
          )}
          <Text style={styles.dim}>I'll re-check the prices on the rows that looked off.</Text>
        </View>
      );
    case 'propose_mark_paid': {
      const title = [proposal.displayCustomerName, proposal.displayName]
        .filter(Boolean)
        .join(' — ');
      const methodLabel =
        proposal.method === 'cash' ? 'cash'
        : proposal.method === 'bank_transfer' ? 'bank transfer'
        : proposal.method === 'card' ? 'card'
        : proposal.method === 'cheque' ? 'cheque'
        : 'other';
      return (
        <View>
          {title ? (
            <Text style={styles.summary} numberOfLines={2}>{title}</Text>
          ) : null}
          {typeof proposal.displayBalance === 'number' ? (
            <Text style={styles.dim}>
              Settling balance {formatCurrency(proposal.displayBalance)}
              {typeof proposal.displayTotal === 'number' && proposal.displayTotal !== proposal.displayBalance
                ? ` of ${formatCurrency(proposal.displayTotal)} total`
                : ''}
              {' · '}{methodLabel}.
            </Text>
          ) : typeof proposal.displayTotal === 'number' ? (
            <Text style={styles.dim}>Total {formatCurrency(proposal.displayTotal)} · {methodLabel}.</Text>
          ) : (
            <Text style={styles.dim}>Payment method: {methodLabel}.</Text>
          )}
          {!!proposal.notes && (
            <Text style={styles.dim}>Note: {proposal.notes}</Text>
          )}
          <Text style={styles.dim}>Records the payment and marks it paid.</Text>
        </View>
      );
    }
    case 'propose_import_supplier_list': {
      const sourceLine =
        proposal.source === 'attachment' ? 'Reads the price list you just sent.'
        : proposal.source === 'camera' ? 'Opens the camera to snap the price list.'
        : proposal.source === 'gallery' ? 'Pick the price list out of your photos.'
        : proposal.source === 'pdf' ? 'Pick a PDF price list.'
        : proposal.source === 'spreadsheet' ? 'Pick a CSV or Excel price list.'
        : 'Photo, PDF or spreadsheet — whatever you have.';
      return (
        <View>
          <Text style={styles.summary}>
            {proposal.supplierName ? proposal.supplierName : 'Your supplier prices'}
          </Text>
          {!!proposal.missedItems?.length && (
            <Text style={styles.dim} numberOfLines={2}>
              Would cover: {proposal.missedItems.slice(0, 3).join(', ')}
            </Text>
          )}
          <Text style={styles.dim}>{sourceLine} You check every row before it saves.</Text>
        </View>
      );
    }
  }
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
    padding: 12,
    marginVertical: 6,
    marginHorizontal: 12,
  },
  cardApplied: {
    borderColor: t.colors.money,
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
    color: t.colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summary: {
    color: t.colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  dim: {
    color: t.colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  scope: {
    color: t.colors.text,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  section: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  sectionName: {
    color: t.colors.text,
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
    color: t.colors.text,
    fontSize: 13,
    marginRight: 8,
  },
  linePrice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  priceText: { color: t.colors.text, fontSize: 13 },
  estimateBadge: {
    color: t.colors.warning,
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: t.colors.warningSubtle,
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
    borderTopColor: t.colors.border,
  },
  totalLabel: { color: t.colors.textMuted, fontSize: 13 },
  totalValue: { color: t.colors.text, fontSize: 14, fontWeight: '700' },
  warningBanner: {
    color: t.colors.warning,
    fontSize: 12,
    marginBottom: 6,
  },
  emailPreview: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.colors.border,
    backgroundColor: t.colors.bg,
  },
  emailLabel: {
    color: t.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  emailSubject: {
    color: t.colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  emailBody: {
    color: t.colors.text,
    fontSize: 13,
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
    gap: 8,
  },
  // These two are the primary confirm in the product and sat at ~33pt. Dismiss
  // also gets a border — bare text beside a filled red Delete invites the
  // wrong tap.
  dismissBtn: {
    paddingHorizontal: 14,
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  dismissText: { color: t.colors.textMuted, fontSize: 14, fontWeight: '500' },
  applyBtn: {
    paddingHorizontal: 16,
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 8,
    minWidth: 96,
    alignItems: 'center',
  },
  // Dark ink on the green/red fill — white on the money green is ~2.8:1 and
  // unreadable in sunlight; onAccent is the theme's on-fill pairing (onError
  // maps to it too, so the destructive red button matches).
  applyText: { color: t.colors.onAccent, fontSize: 14, fontWeight: '700' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  statusText: { color: t.colors.textMuted, fontSize: 12 },
}));

// Memoised: ProposalCard sits inside the chat FlatList renderItem, so without
// this it would re-render for every keystroke / store update in
// AssistantScreen. Props are flat primitives + stable callbacks (wrapped in
// useCallback in AssistantScreen), so the default shallow compare is safe.
export const ProposalCard = React.memo(ProposalCardImpl);
