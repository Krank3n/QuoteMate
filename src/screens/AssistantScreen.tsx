// Mate — the QuoteMate assistant chat surface.
//
// The model never writes to Firestore. Read tools execute server-side; intent
// tools come back as Proposal cards rendered inline with the assistant
// message. Tap Apply -> store.applyProposal -> existing store actions ->
// the screen drives navigation off the returned hint.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import { useStore, NavigateHint } from '../store/useStore';
import {
  AssistantOfflineError,
  AssistantQuotaError,
  sendAssistantTurn,
} from '../services/assistantService';
import { generateId } from '../utils/generateId';
import {
  ChatMessage,
  Proposal,
  ProposalStatus,
} from '../types/assistant';
import { MessageBubble } from '../components/assistant/MessageBubble';
import { ProposalCard } from '../components/assistant/ProposalCard';
import { SuggestedPromptChip } from '../components/assistant/SuggestedPromptChip';
import { WebContainer } from '../components/WebContainer';
import { useSuggestedPrompts } from '../hooks/useSuggestedPrompts';

interface ChatItem {
  key: string;
  message: ChatMessage;
}

export function AssistantScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<any>>();
  const conversations = useStore((s) => s.conversations);
  const currentConversationId = useStore((s) => s.currentConversationId);
  const startConversation = useStore((s) => s.startConversation);
  const appendMessage = useStore((s) => s.appendMessage);
  const updateMessage = useStore((s) => s.updateMessage);
  const applyProposal = useStore((s) => s.applyProposal);
  const updateProposalStatus = useStore((s) => s.updateProposalStatus);
  const loadConversations = useStore((s) => s.loadConversations);
  const markScreenTourSeen = useStore((s) => s.markScreenTourSeen);
  const hasSeenScreenTour = useStore((s) => s.hasSeenScreenTour);
  const setCurrentQuote = useStore((s) => s.setCurrentQuote);
  const quotes = useStore((s) => s.quotes);
  const documents = useStore((s) => s.documents);
  const suggestedPrompts = useSuggestedPrompts();

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatItem>>(null);
  const seenIntro = hasSeenScreenTour('mate_intro');

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Lazy-create a conversation on first focus.
  useEffect(() => {
    if (!currentConversationId) startConversation();
  }, [currentConversationId, startConversation]);

  useEffect(() => {
    if (!seenIntro) {
      markScreenTourSeen('mate_intro');
    }
  }, [seenIntro, markScreenTourSeen]);

  const conversation = useMemo(
    () => conversations.find((c) => c.id === currentConversationId),
    [conversations, currentConversationId],
  );

  const items: ChatItem[] = useMemo(() => {
    if (!conversation) return [];
    return conversation.messages
      .slice()
      .reverse()
      .map((m) => ({ key: m.id, message: m }));
  }, [conversation]);

  const handleNavigate = useCallback(
    (hint: NavigateHint | undefined) => {
      if (!hint) return;
      switch (hint.kind) {
        case 'job_preview': {
          // setCurrentQuote so the wizard's screens read the right draft.
          const quote = quotes.find((q) => q.id === hint.quoteId);
          if (quote) setCurrentQuote(quote);
          navigation.navigate('NewJob', { screen: 'JobPreview' });
          break;
        }
        case 'quote_materials_list': {
          // Materials were generated in-chat; navigate to MaterialsList with
          // autoFetchPrices=true so the wizard's existing pricing UI kicks
          // off automatically (Phase 2 will bring pricing into chat too).
          const quote = quotes.find((q) => q.id === hint.quoteId);
          if (quote) setCurrentQuote(quote);
          navigation.navigate('NewJob', {
            screen: 'MaterialsList',
            params: { autoFetchPrices: true },
          });
          break;
        }
        case 'open_send_modal': {
          const doc = documents.find((d) => d.id === hint.documentId);
          if (!doc) return;
          // ViewJob is the unified job screen; the send modal lives inside it.
          navigation.navigate('ViewJob', { documentId: doc.id, openSend: true, prefillEmail: hint.recipientEmail });
          break;
        }
        case 'open_contact':
          navigation.navigate('Contacts', { highlightId: hint.contactId });
          break;
        case 'open_invoice':
          navigation.navigate('ViewJob', { documentId: hint.invoiceId });
          break;
      }
    },
    [navigation, quotes, documents, setCurrentQuote],
  );

  const handleApply = useCallback(
    async (message: ChatMessage, proposal: Proposal) => {
      if (!conversation) return;
      updateProposalStatus(conversation.id, message.id, proposal.id, 'applied');

      // For proposals that run the long materials pipeline, mount a working
      // card up-front so the chat shows live progress instead of a silent
      // gap. Pricing in Phase 2 will extend this same card.
      const wantsProgress = proposal.type === 'propose_draft_quote';
      let workingMessageId: string | undefined;
      if (wantsProgress) {
        workingMessageId = generateId();
        appendMessage(conversation.id, {
          id: workingMessageId,
          role: 'assistant',
          text: '',
          createdAt: new Date().toISOString(),
          working: { phase: 'preflight', status: 'Getting ready…', done: false },
        });
      }

      const result = await applyProposal(proposal, (status) => {
        if (!workingMessageId) return;
        updateMessage(conversation.id, workingMessageId, { working: status });
      });

      if (!result.ok) {
        updateProposalStatus(conversation.id, message.id, proposal.id, 'failed');
        // Surface the real reason in the chat so the user can see what broke
        // instead of just an opaque "Failed" badge on the card.
        // eslint-disable-next-line no-console
        console.warn('[Mate] applyProposal failed', result.error);
        appendMessage(conversation.id, {
          id: generateId(),
          role: 'assistant',
          text: '',
          createdAt: new Date().toISOString(),
          errorMessage: result.error || 'Apply failed without an error message.',
        });
        return;
      }
      // Surface a note (e.g. partial success — draft created but pipeline
      // failed) before deciding what to do with the navigate hint.
      if (result.note) {
        appendMessage(conversation.id, {
          id: generateId(),
          role: 'assistant',
          text: result.note,
          createdAt: new Date().toISOString(),
        });
      }

      // For draft proposals, keep the user in chat. Render the quote inline
      // (JobScopeCard) so the tradie can review and keep chatting with Mate
      // to tweak it without leaving. Other proposal types (send, delete,
      // convert, create contact) still auto-navigate because their result
      // IS a navigation, not a long-running pipeline.
      if (proposal.type === 'propose_draft_quote') {
        if (result.navigate && result.navigate.kind === 'job_preview') {
          appendMessage(conversation.id, {
            id: generateId(),
            role: 'assistant',
            text: "Here's the draft — have a squiz. Tell me what to tweak, or tap to open it.",
            createdAt: new Date().toISOString(),
          });
          appendMessage(conversation.id, {
            id: generateId(),
            role: 'assistant',
            text: '',
            createdAt: new Date().toISOString(),
            inlineQuoteId: result.navigate.quoteId,
          });
        }
        return;
      }

      handleNavigate(result.navigate);
    },
    [conversation, applyProposal, appendMessage, updateMessage, updateProposalStatus, handleNavigate],
  );

  const handleDismiss = useCallback(
    (message: ChatMessage, proposal: Proposal) => {
      if (!conversation) return;
      updateProposalStatus(conversation.id, message.id, proposal.id, 'dismissed');
    },
    [conversation, updateProposalStatus],
  );

  const submit = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || sending) return;
      // Resolve the active conversation against the current store, not the
      // closure — `currentConversationId` can point at a missing conversation
      // after loadConversations runs (it clobbered the freshly minted one).
      // Always validate before using.
      const storeState = useStore.getState();
      let convoId = storeState.conversations.find((c) => c.id === storeState.currentConversationId)?.id;
      if (!convoId) convoId = startConversation();
      const currentMessages =
        useStore.getState().conversations.find((c) => c.id === convoId)?.messages || [];

      setInput('');
      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
      };
      appendMessage(convoId, userMsg);

      setSending(true);
      try {
        const history = [...currentMessages, userMsg];
        const response = await sendAssistantTurn({ history });
        // eslint-disable-next-line no-console
        console.log('[Mate] response', {
          textLen: response.text?.length || 0,
          proposalCount: response.proposals.length,
          usage: response.usage,
        });
        const hasContent = !!(response.text && response.text.trim()) || response.proposals.length > 0;
        const fallback = '(Mate returned an empty reply — check the Firebase Functions logs for assistantChat.)';
        const assistantMsg: ChatMessage = {
          id: response.messageId,
          role: 'assistant',
          text: response.text?.trim() || (response.proposals.length > 0 ? 'Here you go — tap Apply.' : ''),
          createdAt: new Date().toISOString(),
          proposals: response.proposals,
          proposalStatus: Object.fromEntries(response.proposals.map((p) => [p.id, 'pending' as ProposalStatus])),
          errorMessage: hasContent ? undefined : fallback,
        };
        appendMessage(convoId, assistantMsg);
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn('[Mate] error', err?.name, err?.message);
        const isQuota = err instanceof AssistantQuotaError;
        const isOffline = err instanceof AssistantOfflineError;
        appendMessage(convoId, {
          id: generateId(),
          role: 'assistant',
          text: '',
          createdAt: new Date().toISOString(),
          errorMessage: isQuota
            ? err.message
            : isOffline
              ? err.message
              : `Mate hit a snag: ${err?.message || 'unknown error'}`,
        });
      } finally {
        setSending(false);
      }
    },
    [appendMessage, conversation, currentConversationId, input, sending, startConversation],
  );

  const handleCtaPress = useCallback(
    (message: ChatMessage) => {
      if (!message.cta) return;
      if (message.cta.action.type === 'open_quote') {
        handleNavigate({ kind: 'job_preview', quoteId: message.cta.action.quoteId });
      }
    },
    [handleNavigate],
  );

  const handleInlineQuoteEdit = useCallback(
    (quoteId: string, step: 'job' | 'materials' | 'labor') => {
      const quote = quotes.find((q) => q.id === quoteId);
      if (!quote) return;
      setCurrentQuote(quote);
      // Mirror JobsList/ViewJob: tap an edit affordance on the scope card,
      // land on the matching wizard step. Mate stays in history so the user
      // can come back and keep chatting.
      const screen =
        step === 'materials'
          ? 'MaterialsList'
          : step === 'labor'
            ? 'LaborMarkup'
            : 'Details';
      navigation.navigate('NewJob', { screen });
    },
    [navigation, quotes, setCurrentQuote],
  );

  const handleInlineQuoteOpen = useCallback(
    (quoteId: string) => {
      const quote = quotes.find((q) => q.id === quoteId);
      if (quote) setCurrentQuote(quote);
      navigation.navigate('NewJob', { screen: 'JobPreview' });
    },
    [navigation, quotes, setCurrentQuote],
  );

  const handleInlineJobEdit = useCallback(
    (jobId: string) => {
      navigation.navigate('NewJob', {
        screen: 'Details',
        params: { jobId, editing: true },
      });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatItem }) => {
      const proposals = item.message.proposals || [];
      return (
        <View>
          <MessageBubble
            message={item.message}
            onCtaPress={() => handleCtaPress(item.message)}
            onInlineQuoteEdit={handleInlineQuoteEdit}
            onInlineQuoteOpen={handleInlineQuoteOpen}
            onInlineJobEdit={handleInlineJobEdit}
          />
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              status={(item.message.proposalStatus?.[p.id] as ProposalStatus) || 'pending'}
              onApply={() => handleApply(item.message, p)}
              onDismiss={() => handleDismiss(item.message, p)}
            />
          ))}
        </View>
      );
    },
    [handleApply, handleDismiss, handleCtaPress, handleInlineQuoteEdit, handleInlineQuoteOpen],
  );

  const isEmpty = !conversation || conversation.messages.length === 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <WebContainer style={styles.webBody}>
        {isEmpty && (
          <View style={[styles.intro, { paddingTop: insets.top + 16 }]}>
            <MaterialCommunityIcons name="chat-processing" size={36} color={colors.primary} />
            <Text style={styles.introTitle}>Mate</Text>
            <Text style={styles.introSubtitle}>
              Ask me to draft a quote, find a customer, or chase a follow-up. I draft, you confirm — nothing saves without your tap.
            </Text>
          </View>
        )}

        <FlatList
          ref={listRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={items}
          keyExtractor={(i) => i.key}
          renderItem={renderItem}
          inverted
          keyboardShouldPersistTaps="handled"
        />

        {sending && (
          <View style={styles.typingRow}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <Text style={styles.typing}>Mate is thinking…</Text>
          </View>
        )}

        {suggestedPrompts.length > 0 && isEmpty && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
          >
            {suggestedPrompts.map((p) => (
              <SuggestedPromptChip
                key={p.id}
                label={p.label}
                onPress={() => submit(p.text)}
              />
            ))}
          </ScrollView>
        )}

        <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 8) + 70 }]}>
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask Mate…"
              placeholderTextColor={colors.placeholder}
              editable={!sending}
              multiline
              returnKeyType="send"
              // iOS single-line Return fires onSubmitEditing; we keep multiline
              // for long messages but still want Return to send. On web, Enter
              // (without Shift) submits — Shift+Enter inserts a newline.
              onSubmitEditing={() => submit()}
              blurOnSubmit={false}
              {...(Platform.OS === 'web'
                ? {
                    onKeyPress: (e: any) => {
                      if (e?.nativeEvent?.key === 'Enter' && !e?.nativeEvent?.shiftKey) {
                        e.preventDefault?.();
                        submit();
                      }
                    },
                  }
                : {})}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
              onPress={() => submit()}
              disabled={!input.trim() || sending}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <MaterialCommunityIcons name="arrow-up" size={22} color={colors.white} />
            </TouchableOpacity>
          </View>
        </View>
      </WebContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  webBody: {
    flex: 1,
  },
  intro: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 16,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  introTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
  },
  introSubtitle: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  list: { flex: 1 },
  listContent: {
    paddingVertical: 8,
    // Cap chat content on iPad/large screens so bubbles don't stretch
    // edge-to-edge — matches MaterialsListScreen's 800px cap. WebContainer
    // handles this on web, but it's a no-op on native, so set it here too.
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  typing: { color: colors.textMuted, fontSize: 13 },
  chips: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  composerWrap: {
    paddingHorizontal: 8,
    width: '100%',
    maxWidth: 800,
    alignSelf: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: colors.surfaceGray,
  },
});
