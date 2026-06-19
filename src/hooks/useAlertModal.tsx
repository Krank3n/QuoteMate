/**
 * useAlertModal
 *
 * Single-state wrapper around the shared AlertModal component. Lets a screen
 * trigger consistent confirm / error / success modals with a one-line call
 * (`showAlert({ ... })`) instead of carrying a useState + JSX block per alert.
 * Replaces the project's previous use of native React Native Alert.alert,
 * which renders an OS dialog and breaks the visual language elsewhere.
 *
 * Action handlers (primary/secondary) auto-dismiss the modal once they
 * resolve, so call sites can pass plain async functions.
 */

import React, { useCallback, useState, useMemo } from 'react';
import { AlertModal, type AlertType } from '../components/AlertModal';

export interface AlertModalOptions {
  type?: AlertType;
  title: string;
  message: string;
  icon?: string;
  showConfetti?: boolean;
  primaryButtonText?: string;
  primaryButtonAction?: () => void | Promise<void>;
  secondaryButtonText?: string;
  secondaryButtonAction?: () => void | Promise<void>;
  /** When true, auto-dismiss is suppressed for the primary button — the
   * caller is expected to invoke `dismissAlert` itself. Useful when the
   * primary action navigates away and the dismiss would race the unmount. */
  primaryKeepsOpen?: boolean;
}

export function useAlertModal() {
  const [opts, setOpts] = useState<AlertModalOptions | null>(null);
  const [busy, setBusy] = useState(false);

  const dismissAlert = useCallback(() => {
    setOpts(null);
    setBusy(false);
  }, []);

  const showAlert = useCallback((next: AlertModalOptions) => {
    setBusy(false);
    setOpts(next);
  }, []);

  const wrappedPrimary = useMemo(() => {
    const action = opts?.primaryButtonAction;
    if (!action) return undefined;
    return async () => {
      try {
        setBusy(true);
        await action();
      } finally {
        if (!opts?.primaryKeepsOpen) dismissAlert();
        else setBusy(false);
      }
    };
  }, [opts, dismissAlert]);

  const wrappedSecondary = useMemo(() => {
    const action = opts?.secondaryButtonAction;
    if (!action) return undefined;
    return async () => {
      try {
        setBusy(true);
        await action();
      } finally {
        dismissAlert();
      }
    };
  }, [opts, dismissAlert]);

  const alertNode = opts ? (
    <AlertModal
      visible={true}
      onDismiss={dismissAlert}
      type={opts.type ?? 'info'}
      title={opts.title}
      message={opts.message}
      icon={opts.icon}
      showConfetti={opts.showConfetti}
      primaryButtonText={opts.primaryButtonText}
      primaryButtonAction={wrappedPrimary}
      secondaryButtonText={opts.secondaryButtonText}
      secondaryButtonAction={wrappedSecondary}
      primaryButtonLoading={busy && !!wrappedPrimary}
      secondaryButtonLoading={busy && !!wrappedSecondary}
    />
  ) : null;

  return { showAlert, dismissAlert, alertNode };
}
