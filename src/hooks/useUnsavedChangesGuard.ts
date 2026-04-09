/**
 * useUnsavedChangesGuard
 *
 * Intercepts back navigation when a form has unsaved changes and pops a
 * confirmation modal asking the user whether to save, discard, or cancel.
 *
 * Usage:
 *   const isDirty = useMemo(() => snapshot !== current, [...]);
 *   const { unsavedModalProps } = useUnsavedChangesGuard({
 *     isDirty,
 *     onSave: async () => { await save(); return true; },
 *   });
 *   ...
 *   <AlertModal {...unsavedModalProps} />
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import type { NavigationAction } from '@react-navigation/native';

interface Options {
  /** Whether the form currently has unsaved changes. */
  isDirty: boolean;
  /**
   * Called when the user picks "Save 'em". Should persist the form.
   * Return `false` to abort the exit (e.g. validation failed); any other
   * return value (including void) lets the navigation proceed.
   */
  onSave: () => Promise<boolean | void> | boolean | void;
  /**
   * Optional. Called when the user picks "Nah, bin it" — before the
   * navigation actually happens. Use this to revert in-memory edits that
   * would otherwise survive the screen exit (e.g. mutations to a global
   * store like `currentQuote`). For pure-form screens you can leave this
   * undefined: the local component state is thrown away on unmount anyway.
   */
  onDiscard?: () => void | Promise<void>;
}

export function useUnsavedChangesGuard({ isDirty, onSave, onDiscard }: Options) {
  const navigation = useNavigation<any>();
  const [visible, setVisible] = useState(false);
  const [pendingAction, setPendingAction] = useState<NavigationAction | null>(null);
  const allowExitRef = useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!isDirty || allowExitRef.current) return;
      e.preventDefault();
      setPendingAction(e.data.action);
      setVisible(true);
    });
    return unsubscribe;
  }, [navigation, isDirty]);

  const dispatchPending = (action: NavigationAction | null) => {
    allowExitRef.current = true;
    if (action) {
      navigation.dispatch(action);
    } else {
      navigation.goBack();
    }
  };

  const handleDiscard = async () => {
    const action = pendingAction;
    setVisible(false);
    setPendingAction(null);
    if (onDiscard) {
      // Run the consumer's revert hook before navigating so any in-memory
      // edits are rolled back before the destination screen mounts.
      await onDiscard();
    }
    dispatchPending(action);
  };

  const handleSaveAndExit = async () => {
    const action = pendingAction;
    setVisible(false);
    const result = await onSave();
    if (result === false) {
      // Save aborted (e.g. validation failure) — stay on screen.
      setPendingAction(null);
      return;
    }
    setPendingAction(null);
    dispatchPending(action);
  };

  const handleCancel = () => {
    setVisible(false);
    setPendingAction(null);
  };

  /**
   * Bypass the guard for the next navigation. Use this from explicit save flows
   * (e.g. a "Next" button that already calls saveDraft) so the user doesn't get
   * prompted right after they hit save. The flag is consumed by the next
   * beforeRemove and is otherwise sticky — call it immediately before the
   * navigation that should be allowed through.
   */
  const allowNextNavigation = () => {
    allowExitRef.current = true;
  };

  return {
    unsavedModalProps: {
      visible,
      onDismiss: handleCancel,
      type: 'warning' as const,
      title: "Hold up, mate!",
      message: "You've made some changes but haven't saved 'em. Wanna lock 'em in or chuck 'em in the bin?",
      primaryButtonText: "Save 'em",
      primaryButtonAction: handleSaveAndExit,
      secondaryButtonText: "Nah, bin it",
      secondaryButtonAction: handleDiscard,
    },
    allowNextNavigation,
  };
}
