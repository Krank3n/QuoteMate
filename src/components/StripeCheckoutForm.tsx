/**
 * Stripe Checkout Form Component
 * Embedded Stripe payment form using Stripe Elements
 */

import React, { useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Button, Text, ActivityIndicator } from 'react-native-paper';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { colors } from '../theme';

interface StripeCheckoutFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  amount: string;
  planName: string;
}

export function StripeCheckoutForm({
  onSuccess,
  onCancel,
  amount,
  planName,
}: StripeCheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/?payment=success`,
        },
      });

      if (error) {
        setErrorMessage(error.message || 'An error occurred');
        setIsProcessing(false);
      } else {
        // Payment succeeded
        onSuccess();
      }
    } catch (err: any) {
      console.error('Payment error:', err);
      setErrorMessage(err.message || 'An unexpected error occurred');
      setIsProcessing(false);
    }
  };

  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.planName}>{planName}</Text>
        <Text style={styles.amount}>{amount}</Text>
      </View>

      <form onSubmit={handleSubmit} style={{ width: '100%' }}>
        <View style={styles.paymentElement}>
          <PaymentElement />
        </View>

        {errorMessage && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        <View style={styles.buttonContainer}>
          <Button
            mode="outlined"
            onPress={onCancel}
            disabled={isProcessing}
            style={styles.cancelButton}
          >
            Cancel
          </Button>

          <Button
            mode="contained"
            onPress={handleSubmit as any}
            disabled={!stripe || isProcessing}
            loading={isProcessing}
            style={styles.submitButton}
          >
            {isProcessing ? 'Processing...' : 'Subscribe'}
          </Button>
        </View>
      </form>

      {isProcessing && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    padding: 20,
    backgroundColor: colors.surface,
    borderRadius: 8,
  },
  header: {
    marginBottom: 24,
    alignItems: 'center',
  },
  planName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  amount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.primary,
  },
  paymentElement: {
    marginBottom: 24,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  cancelButton: {
    flex: 1,
  },
  submitButton: {
    flex: 1,
  },
  errorContainer: {
    padding: 12,
    backgroundColor: colors.errorBg,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.error,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
