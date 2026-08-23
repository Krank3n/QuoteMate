import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  TouchableOpacity,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { makeStyles, useThemeColors } from '../../theme';
import { ChatAttachment, ChatMessage, SupplierImportCard } from '../../types/assistant';
import { useStore } from '../../store/useStore';
import { useJobStore } from '../../store/useJobStore';
import { quoteToDocument } from '../../types/documentAdapter';
import { JobScopeCard, ScopeStep } from '../JobScopeCard';
import { JobDetailHeader } from '../JobDetailHeader';
import { Document } from '../../types/document';
import { formatScheduledDateLong } from '../../utils/formatSchedule';

interface Props {
  message: ChatMessage;
  onCtaPress?: () => void;
  onInlineQuoteEdit?: (quoteId: string, step: ScopeStep) => void;
  onInlineQuoteOpen?: (quoteId: string) => void;
  onInlineJobEdit?: (jobId: string) => void;
}

function InlineQuote({
  quoteId,
  onEdit,
  onOpen,
  onJobEdit,
}: {
  quoteId: string;
  onEdit?: (quoteId: string, step: ScopeStep) => void;
  onOpen?: (quoteId: string) => void;
  onJobEdit?: (jobId: string) => void;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const quote = useStore((s) => s.quotes.find((q) => q.id === quoteId));
  const doc = useStore((s) => s.documents.find((d) => d.id === quoteId));
  const renderable: Document | null = doc || (quote ? quoteToDocument(quote) : null);
  // Job header — we're drafting a job (not just a quote), so surface the
  // job-level details (customer, schedule, totals timeline) above the scope
  // card. Same pattern as ViewJobScreen.
  const jobId = renderable?.jobId;
  const job = useJobStore((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));
  const attachedDocs = useStore((s) =>
    jobId ? s.documents.filter((d) => d.jobId === jobId) : [],
  );
  if (!renderable) return null;
  const customerIsUnknown =
    !job?.customerName ||
    job.customerName.trim() === '' ||
    job.customerName === 'Unknown customer';
  const completedAt = job?.completedDate ? formatScheduledDateLong(job.completedDate) : null;
  // attachedDocs may be empty until the legacy → unified mirror runs.
  // Fall back to the in-memory document we already have so the header still
  // renders the right primary doc + headline.
  const docsForHeader = attachedDocs.length > 0 ? attachedDocs : [renderable];
  return (
    <View style={styles.inlineQuoteWrap}>
      {job ? (
        <JobDetailHeader
          job={job}
          documents={docsForHeader}
          customerIsUnknown={customerIsUnknown}
          completedAt={completedAt}
          onCustomerEdit={() => onEdit?.(renderable.id, 'job')}
          onMenu={() => onOpen?.(renderable.id)}
          onJobEdit={() => onJobEdit?.(job.id)}
        />
      ) : null}
      <JobScopeCard
        doc={renderable}
        onEdit={(d, step) => onEdit?.(d.id, step)}
        onStagePress={() => onOpen?.(renderable.id)}
      />
    </View>
  );
}

const SINGLE_THUMB = 200;
const GRID_THUMB = 96;

// One attached photo. No lightbox — the tradie already has the picture in
// their camera roll, and a full-screen viewer over an inverted FlatList is a
// lot of surface for a shot they took ten seconds ago.
function AttachmentTile({ attachment, large }: { attachment: ChatAttachment; large: boolean }) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  // A web blob: uri is dead after a reload — fall back to the durable copy.
  const [localBroken, setLocalBroken] = useState(false);
  const size = large ? SINGLE_THUMB : GRID_THUMB;

  if (attachment.status === 'failed') {
    return (
      <View
        testID="mate-attachment-failed"
        style={[styles.attachmentTile, styles.attachmentFailed, { width: size, height: size }]}
      >
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={large ? 32 : 22}
          color={themeColors.error}
        />
        <Text style={styles.attachmentFailedLabel}>Didn't send</Text>
      </View>
    );
  }

  const uri = (!localBroken && attachment.localUri) || attachment.storageUrl;
  const uploading = attachment.status === 'uploading';
  return (
    <View
      testID={large ? 'mate-attachment-single' : 'mate-attachment-thumb'}
      style={[styles.attachmentTile, { width: size, height: size }]}
    >
      {!!uri && (
        <Image
          source={{ uri }}
          style={[styles.attachmentImage, uploading && styles.attachmentImageUploading]}
          resizeMode="cover"
          onError={() => setLocalBroken(true)}
          accessibilityLabel="Attached photo"
        />
      )}
      {uploading && (
        <View testID="mate-attachment-uploading" style={styles.attachmentSpinner}>
          <ActivityIndicator size="small" color={themeColors.accentText} />
        </View>
      )}
    </View>
  );
}

// Three dots breathing in sequence. Cheaper to read at a glance than a
// spinner, and it reads as "someone is replying" rather than "the app is busy".
function TypingDots() {
  const styles = useStyles();
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];

  useEffect(() => {
    const loops = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
          Animated.delay((dots.length - 1 - i) * 160),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.dotRow} accessibilityLabel="Mate is replying">
      {dots.map((v, i) => (
        <Animated.View key={i} style={[styles.dot, { opacity: v }]} />
      ))}
    </View>
  );
}

function AttachmentStrip({ attachments }: { attachments: ChatAttachment[] }) {
  const styles = useStyles();
  const single = attachments.length === 1;
  return (
    <View style={[styles.attachmentStrip, !single && styles.attachmentStripRow]}>
      {attachments.map((a) => (
        <AttachmentTile key={a.id} attachment={a} large={single} />
      ))}
    </View>
  );
}

// Live state of a supplier-list import, rendered inside the bubble. The CTA
// that opens the reader is the message's own cta, so this is text only.
function SupplierImportRow({ card }: { card: SupplierImportCard }) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const from = card.supplierName ? ` from ${card.supplierName}` : '';
  const plural = (n: number) => (n === 1 ? 'item' : 'items');

  if (card.phase === 'extracting') {
    return (
      <View style={styles.workingRow}>
        <ActivityIndicator size="small" color={themeColors.accentText} />
        <Text style={[styles.text, styles.textAssistant, styles.workingStatus]}>
          Reading the price list…
        </Text>
      </View>
    );
  }

  const icon =
    card.phase === 'saved' ? 'check-circle'
    : card.phase === 'ready' ? 'clipboard-list-outline'
    : 'alert-circle-outline';
  const tint =
    card.phase === 'saved' ? themeColors.money
    : card.phase === 'ready' ? themeColors.accentText
    : themeColors.error;
  const headline =
    card.phase === 'ready'
      ? `Read ${card.itemCount ?? 0} ${plural(card.itemCount ?? 0)}${from} — check & save`
      : card.phase === 'saved'
        ? `Saved ${card.savedCount ?? 0} ${plural(card.savedCount ?? 0)}${from}.`
        : card.phase === 'expired'
          ? "That list is gone from this chat — send it again and I'll read it."
          : card.error || "Couldn't read that price list.";

  return (
    <View>
      <View style={styles.workingRow}>
        <MaterialCommunityIcons name={icon} size={18} color={tint} />
        <Text style={[styles.text, styles.textAssistant, styles.workingStatus]}>{headline}</Text>
      </View>
      {card.phase === 'ready' && !!card.sampleNames?.length && (
        <Text style={styles.workingDetail} numberOfLines={2}>
          {card.sampleNames.join(' · ')}
        </Text>
      )}
      {card.phase === 'saved' && !!card.coveredRows && (
        <Text style={styles.workingDetail}>
          {card.coveredRows} {card.coveredRows === 1 ? 'row' : 'rows'} on that quote now{' '}
          {card.coveredRows === 1 ? 'prices' : 'price'} off your list.
        </Text>
      )}
    </View>
  );
}

function MessageBubbleImpl({
  message,
  onCtaPress,
  onInlineQuoteEdit,
  onInlineQuoteOpen,
  onInlineJobEdit,
}: Props) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const isUser = message.role === 'user';

  // Inline quote — render the job header + scope card so the tradie can
  // review the priced draft inside chat and keep talking to Mate for tweaks
  // instead of bouncing out to the wizard.
  if (message.inlineQuoteId) {
    return (
      <InlineQuote
        quoteId={message.inlineQuoteId}
        onEdit={onInlineQuoteEdit}
        onOpen={onInlineQuoteOpen}
        onJobEdit={onInlineJobEdit}
      />
    );
  }

  // Working card — live pipeline status. Renders distinct from regular bubbles:
  // spinner + status + optional detail line, swapping to a check/cross when done.
  if (message.working) {
    const w = message.working;
    const failed = w.phase === 'failed';
    return (
      <View style={[styles.row, styles.rowLeft]}>
        <View style={[styles.bubble, styles.workingBubble, styles.bubbleAssistant, failed && styles.bubbleError]}>
          <View style={styles.workingRow}>
            {w.done ? (
              <MaterialCommunityIcons
                name={failed ? 'alert-circle' : 'check-circle'}
                size={18}
                color={failed ? themeColors.error : themeColors.money}
              />
            ) : (
              <ActivityIndicator size="small" color={themeColors.accentText} />
            )}
            <Text style={[styles.text, styles.textAssistant, styles.workingStatus]}>
              {w.status}
            </Text>
          </View>
          {!!w.detail && <Text style={styles.workingDetail}>{w.detail}</Text>}
          {!!w.items && w.items.length > 0 && <WorkingItems items={w.items} />}
          {!!w.summary && <Text style={styles.workingSummary}>{w.summary}</Text>}
        </View>
      </View>
    );
  }

  // The turn is in flight and nothing has streamed yet. Render the wait as
  // the bubble itself rather than an empty blob with a second indicator
  // underneath it.
  if (message.thinking && !message.text) {
    return (
      <View style={[styles.row, styles.rowLeft]}>
        <View style={[styles.bubble, styles.bubbleAssistant, styles.thinkingBubble]}>
          <TypingDots />
          <Text style={styles.thinkingLabel} numberOfLines={1}>
            {message.thinking}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
          // The import card carries a spinner + status row; give it the same
          // floor the working card gets so it can't collapse.
          message.supplierImport ? styles.workingBubble : null,
          message.errorMessage ? styles.bubbleError : null,
        ]}
      >
        {!!message.supplierImport && <SupplierImportRow card={message.supplierImport} />}
        {!!message.attachments?.length && <AttachmentStrip attachments={message.attachments} />}
        {!!message.text && (
          <Text style={[styles.text, isUser ? styles.textUser : styles.textAssistant]}>
            {message.text}
          </Text>
        )}
        {!!message.errorMessage && (
          <Text style={styles.errorText}>{message.errorMessage}</Text>
        )}
        {!!message.cta && (
          <TouchableOpacity style={styles.ctaButton} onPress={onCtaPress} accessibilityRole="button">
            <Text style={styles.ctaLabel}>{message.cta.label}</Text>
            <MaterialCommunityIcons name="arrow-right" size={16} color={themeColors.accentText} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginVertical: 4,
  },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '85%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: t.colors.accent,
    borderTopRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: t.colors.surfaceRaised,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: t.colors.border,
  },
  thinkingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.accentText,
  },
  thinkingLabel: {
    color: t.colors.textMuted,
    fontSize: 13,
    flexShrink: 1,
  },
  bubbleError: {
    borderColor: t.colors.error,
  },
  text: {
    fontSize: 15,
    lineHeight: 21,
  },
  attachmentStrip: {
    marginBottom: 8,
  },
  attachmentStripRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  attachmentTile: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: t.colors.surfaceOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
  },
  attachmentImageUploading: {
    opacity: 0.5,
  },
  attachmentSpinner: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentFailed: {
    borderWidth: 1,
    borderColor: t.colors.error,
    gap: 4,
  },
  attachmentFailedLabel: {
    color: t.colors.textMuted,
    fontSize: 12,
  },
  textUser: { color: t.colors.onAccent },
  textAssistant: { color: t.colors.text },
  errorText: {
    color: t.colors.error,
    fontSize: 13,
    marginTop: 4,
  },
  workingBubble: {
    // The working card needs to stay wide enough to render its row of
    // spinner + status without collapsing — give it an explicit min width and
    // bump the max so longer phase strings like "Searching batch 2 of 3…"
    // don't wrap awkwardly.
    minWidth: 220,
    maxWidth: '95%',
  },
  workingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workingStatus: {
    flexShrink: 1,
  },
  workingDetail: {
    color: t.colors.textMuted,
    fontSize: 12,
    marginTop: 4,
    fontStyle: 'italic',
  },
  workingItems: {
    marginTop: 6,
    gap: 2,
  },
  workingItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  workingItemText: {
    color: t.colors.text,
    fontSize: 12,
    flexShrink: 1,
  },
  workingItemDone: {
    color: t.colors.textMuted,
  },
  workingItemFailed: {
    color: t.colors.textMuted,
    textDecorationLine: 'line-through',
  },
  workingItemsMore: {
    color: t.colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
  workingSummary: {
    color: t.colors.text,
    fontSize: 13,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  ctaButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.border,
  },
  ctaLabel: {
    color: t.colors.accentText,
    fontSize: 14,
    fontWeight: '600',
  },
  inlineQuoteWrap: {
    // JobScopeCard carries its own padding/margins. Wrap it so the chat row
    // still gets a bit of breathing room without doubling up on horizontal
    // padding from the bubble row style.
    marginVertical: 4,
  },
}));

// Compact rolling list of materials being searched in the current batch.
// Renders at most ~6 rows: any items currently `searching`, plus the
// most-recently completed ones for context, plus the next pending item so
// the user can see what's queued. Keeps the chat card from ballooning on
// large quotes (26 materials would be a wall of text otherwise).
function WorkingItems({
  items,
}: {
  items: Array<{ name: string; status: 'pending' | 'searching' | 'done' | 'failed' }>;
}) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  // Bucket by status so we can show "searching" rows first, then a tail
  // of just-completed rows, then a hint of what's still queued.
  const searching = items.filter((i) => i.status === 'searching');
  const completed = items.filter((i) => i.status === 'done' || i.status === 'failed');
  const pending = items.filter((i) => i.status === 'pending');

  const MAX_ROWS = 6;
  // Always show all currently-searching items (usually ≤3 — the chunk size).
  const rows: Array<{ name: string; status: 'pending' | 'searching' | 'done' | 'failed' }> = [
    ...searching,
  ];
  // Fill remaining slots with the most-recently completed items so the user
  // gets visible feedback as the list ticks over.
  const recentDone = completed.slice(-Math.max(0, MAX_ROWS - rows.length - (pending.length > 0 ? 1 : 0)));
  rows.unshift(...recentDone);
  // Tail hint: show how many are still queued.
  const remainingPending = pending.length;

  return (
    <View style={styles.workingItems}>
      {rows.map((item, idx) => {
        const icon =
          item.status === 'done'
            ? 'check'
            : item.status === 'failed'
            ? 'close'
            : item.status === 'searching'
            ? 'magnify'
            : 'circle-small';
        const tint =
          item.status === 'done'
            ? themeColors.money
            : item.status === 'failed'
            ? themeColors.error
            : item.status === 'searching'
            ? themeColors.accent
            : themeColors.textMuted;
        return (
          <View key={`${item.name}-${idx}`} style={styles.workingItemRow}>
            <MaterialCommunityIcons name={icon as any} size={14} color={tint} />
            <Text
              style={[
                styles.workingItemText,
                item.status === 'done' && styles.workingItemDone,
                item.status === 'failed' && styles.workingItemFailed,
              ]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
          </View>
        );
      })}
      {remainingPending > 0 && (
        <Text style={styles.workingItemsMore}>
          +{remainingPending} more queued
        </Text>
      )}
    </View>
  );
}

// Memoised: the chat FlatList re-renders every time AssistantScreen
// re-renders (composer keystrokes, voice ticks, store updates, etc).
// Without this each bubble would re-run its Zustand selectors on every
// character typed and cause visible scroll/typing jank on Android.
export const MessageBubble = React.memo(MessageBubbleImpl);
