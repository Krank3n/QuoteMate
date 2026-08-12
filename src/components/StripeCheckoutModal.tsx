/**
 * Stripe Checkout Modal
 * Modal wrapper for embedded Stripe checkout
 */

import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Modal, Platform, ScrollView } from 'react-native';
import { Portal, Surface, Text, IconButton, ActivityIndicator } from 'react-native-paper';
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { StripeCheckoutForm } from './StripeCheckoutForm';
import { stripeConfig } from '../config/stripeConfig';
import { makeStyles, useThemeColors } from '../theme';

interface StripeCheckoutModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
  priceId: string;
  userId: string;
  planName: string;
  amount: string;
}

export function StripeCheckoutModal({
  visible,
  onDismiss,
  onSuccess,
  priceId,
  userId,
  planName,
  amount,
}: StripeCheckoutModalProps) {
  const styles = useStyles();
  const themeColors = useThemeColors();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stripePromise] = useState(() => {
    return loadStripe(stripeConfig.publishableKey);
  });

  useEffect(() => {
    if (visible && Platform.OS === 'web') {
      createPaymentIntent();
    }
  }, [visible, priceId, userId]);

  const createPaymentIntent = async () => {
    setLoading(true);
    setError(null);

    try {
      const { stripeService } = require('../services/stripeService');
      await stripeService.initialize();
      const secret = await stripeService.createPaymentIntent(priceId, userId);
      setClientSecret(secret);
    } catch (err: any) {
      setError(err.message || 'Failed to initialize payment');
    } finally {
      setLoading(false);
    }
  };

  if (Platform.OS !== 'web' || !visible) {
    return null;
  }

  return (
    <Portal>
      <Modal
        visible={visible}
        onRequestClose={onDismiss}
        transparent
        animationType="fade"
      >
        <View style={styles.overlay}>
          <Surface style={styles.modal}>
            <View style={styles.header}>
              <Text style={styles.title}>Complete Your Subscription</Text>
              <IconButton
                icon="close"
                size={24}
                onPress={onDismiss}
              />
            </View>

            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={true}
            >
              {loading && (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={themeColors.accentText} />
                  <Text style={styles.loadingText}>Preparing checkout...</Text>
                </View>
              )}

              {error && (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {!loading && !error && clientSecret && (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: 'night',
                      variables: {
                        colorPrimary: themeColors.accent,
                        colorBackground: themeColors.surfaceRaised,
                        colorText: themeColors.text,
                        colorDanger: themeColors.error,
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        spacingUnit: '4px',
                        borderRadius: '8px',
                        colorTextSecondary: themeColors.textMuted,
                        colorTextPlaceholder: themeColors.textDisabled,
                      },
                      rules: {
                        '.Input': {
                          backgroundColor: themeColors.bg,
                          border: `1px solid ${themeColors.border}`,
                          color: themeColors.text,
                        },
                        '.Input:focus': {
                          border: `2px solid ${themeColors.accent}`,
                          boxShadow: 'none',
                        },
                        '.Label': {
                          color: themeColors.text,
                          fontSize: '14px',
                          fontWeight: '500',
                        },
                        '.Error': {
                          color: themeColors.error,
                        },
                      },
                    },
                  }}
                >
                  <StripeCheckoutForm
                    onSuccess={onSuccess}
                    onCancel={onDismiss}
                    amount={amount}
                    planName={planName}
                  />
                </Elements>
              )}
            </ScrollView>
          </Surface>
        </View>
      </Modal>
    </Portal>
  );
}

const useStyles = makeStyles((t) => ({
  overlay: {
    flex: 1,
    backgroundColor: t.colors.backdrop,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modal: {
    width: '100%',
    maxWidth: 600,
    maxHeight: '90%',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: t.colors.surfaceRaised,
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
    backgroundColor: t.colors.surfaceRaised,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: t.colors.text,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: t.colors.textMuted,
  },
  errorContainer: {
    padding: 20,
    margin: 20,
    backgroundColor: t.colors.errorSubtle,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.error,
  },
  errorText: {
    color: t.colors.error,
    textAlign: 'center',
  },
}));
