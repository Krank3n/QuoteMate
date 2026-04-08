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
}

export function useUnsavedChangesGuard({ isDirty, onSave }: Options) {
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

  const handleDiscard = () => {
    const action = pendingAction;
    setVisible(false);
    setPendingAction(null);
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
  };
}
