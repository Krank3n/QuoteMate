// Suggested prompts seeded from the tradie's real recent state. Pure local
// computation — no LLM call. The screen renders these as chips above the
// composer on first visit / empty conversation.

import { useMemo } from 'react';
import { useStore } from '../store/useStore';

export interface SuggestedPrompt {
  id: string;
  label: string;
  text: string;
}

export function useSuggestedPrompts(): SuggestedPrompt[] {
  const documents = useStore((s) => s.documents);
  const contacts = useStore((s) => s.contacts);

  return useMemo(() => {
    const prompts: SuggestedPrompt[] = [];

    const draft = documents
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .find((d) => d.type === 'quote' && d.stage === 'draft');
    if (draft && draft.customerName) {
      prompts.push({
        id: 'continue_draft',
        label: `Finish ${draft.customerName.split(' ')[0]}'s draft`,
        text: `What's left to do on the ${draft.customerName} ${draft.job?.name || 'draft'}?`,
      });
    }

    const latestContact = contacts
      .slice()
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    if (latestContact) {
      prompts.push({
        id: 'draft_for_contact',
        label: `Draft a quote for ${latestContact.name.split(' ')[0]}`,
        text: `Draft a quote for ${latestContact.name}.`,
      });
    }

    prompts.push({
      id: 'pending',
      label: "What's pending?",
      text: "What quotes are pending follow-up?",
    });

    prompts.push({
      id: 'add_line',
      label: 'Add a line to a quote',
      text: 'Add a line item to my most recent quote.',
    });

    // Cap at 4 so chips fit on one row on smaller phones.
    return prompts.slice(0, 4);
  }, [documents, contacts]);
}
