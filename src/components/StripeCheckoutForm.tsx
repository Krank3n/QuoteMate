/**
 * Stripe Checkout Form Component
 * Embedded Stripe payment form using Stripe Elements
 */

import React, { useState } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Button, Text, ActivityIndicator } from 'react-native-paper';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { makeStyles, useThemeColors } from '../theme';

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
  const styles = useStyles();
  const themeColors = useThemeColors();
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
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required', // Only redirect if authentication is absolutely required
        confirmParams: {
          return_url: `${window.location.origin}/?payment=success`, // Fallback for required redirects
        },
      });

      if (error) {
        // Payment failed
        setErrorMessage(error.message || 'An error occurred');
        setIsProcessing(false);
      } else if (paymentIntent && paymentIntent.status === 'succeeded') {
        // Payment succeeded without redirect
        onSuccess();
      } else {
        // Payment requires additional action (shouldn't reach here with redirect: 'if_required')
        setIsProcessing(false);
      }
    } catch (err: any) {
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
            mode="contained" buttonColor={themeColors.accent} textColor={themeColors.onAccent}
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
          <ActivityIndicator size="large" color={themeColors.accentText} />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    width: '100%',
    padding: 20,
    backgroundColor: t.colors.surfaceRaised,
    borderRadius: 8,
  },
  header: {
    marginBottom: 24,
    alignItems: 'center',
  },
  planName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: t.colors.text,
    marginBottom: 8,
  },
  amount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: t.colors.money,
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
    backgroundColor: t.colors.errorSubtle,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: t.colors.error,
  },
  errorText: {
    color: t.colors.error,
    fontSize: 14,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.colors.backdrop,
    justifyContent: 'center',
    alignItems: 'center',
  },
}));
