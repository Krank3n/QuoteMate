/**
 * Payment Modal Component
 * Displays an embedded Stripe payment form without redirecting
 */

import React, { useState } from 'react';
import { View, StyleSheet, Platform, ScrollView } from 'react-native';
import { Modal, Portal, Button, Text, ActivityIndicator, Surface } from 'react-native-paper';
import { CardElement, useStripe, useElements, Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { colors } from '../theme';
import { stripeConfig } from '../config/stripeConfig';

const stripePromise = loadStripe(stripeConfig.publishableKey);

interface PaymentModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSuccess: () => void;
  priceId: string;
  userId: string;
  productName: string;
  price: string;
}

// Inner form component that uses Stripe hooks
function PaymentForm({
  onDismiss,
  onSuccess,
  priceId,
  userId,
  productName,
  price,
}: Omit<PaymentModalProps, 'visible'>) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      // Get the CardElement
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        throw new Error('Card element not found');
      }

      // Create payment method
      const { error: pmError, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      });

      if (pmError) {
        throw new Error(pmError.message);
      }

      // Call backend to create subscription with payment method
      const response = await fetch(
        `${process.env.API_BASE_URL || 'https://us-central1-hansendev.cloudfunctions.net'}/createSubscriptionWithPayment`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            priceId,
            userId,
            paymentMethodId: paymentMethod.id,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Payment failed');
      }

      // Handle 3D Secure if required
      if (data.requiresAction) {
        const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
          data.clientSecret
        );

        if (confirmError) {
          throw new Error(confirmError.message);
        }

        if (paymentIntent?.status !== 'succeeded') {
          throw new Error('Payment confirmation failed');
        }
      }

      // Success!
      onSuccess();
    } catch (err: any) {
      console.error('Payment error:', err);
      setError(err.message || 'Payment failed. Please try again.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Surface style={styles.surface}>
      <ScrollView>
        <Text style={styles.title}>Complete Your Purchase</Text>

        <View style={styles.productInfo}>
          <Text style={styles.productName}>{productName}</Text>
          <Text style={styles.price}>{price}</Text>
        </View>

        <View style={styles.cardContainer}>
          <Text style={styles.label}>Card Details</Text>
          <div style={cardElementStyle}>
            <CardElement
              options={{
                hidePostalCode: false,
                style: {
                  base: {
                    fontSize: '16px',
                    color: '#424770',
                    '::placeholder': {
                      color: '#aab7c4',
                    },
                  },
                  invalid: {
                    color: '#9e2146',
                  },
                },
              }}
            />
          </div>
          <Text style={styles.cardHint}>
            Card number, expiry, CVC, and postal code are required
          </Text>
        </View>

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View style={styles.buttonContainer}>
          <Button
            mode="contained"
            onPress={handleSubmit}
            disabled={!stripe || processing}
            loading={processing}
            style={styles.payButton}
            contentStyle={styles.payButtonContent}
          >
            {processing ? 'Processing...' : `Pay ${price}`}
          </Button>

          <Button
            mode="text"
            onPress={onDismiss}
            disabled={processing}
            style={styles.cancelButton}
          >
            Cancel
          </Button>
        </View>

        <Text style={styles.secureText}>
          🔒 Secured by Stripe. Your payment information is encrypted.
        </Text>
      </ScrollView>
    </Surface>
  );
}

// Wrapper component that provides Elements context inside Portal
export function PaymentModal({
  visible,
  onDismiss,
  onSuccess,
  priceId,
  userId,
  productName,
  price,
}: PaymentModalProps) {
  if (Platform.OS !== 'web') {
    return null; // Only for web platform
  }

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={styles.modalContainer}
      >
        <Elements stripe={stripePromise}>
          <PaymentForm
            onDismiss={onDismiss}
            onSuccess={onSuccess}
            priceId={priceId}
            userId={userId}
            productName={productName}
            price={price}
          />
        </Elements>
      </Modal>
    </Portal>
  );
}

// Inline styles for the CardElement div wrapper
const cardElementStyle = {
  border: '1px solid #ccc',
  borderRadius: '4px',
  padding: '12px',
  backgroundColor: '#fff',
  marginTop: '8px',
};

const styles = StyleSheet.create({
  modalContainer: {
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  surface: {
    padding: 24,
    borderRadius: 12,
    maxWidth: 500,
    width: '100%',
    maxHeight: '90vh',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  productInfo: {
    backgroundColor: colors.warningBg,
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
    alignItems: 'center',
  },
  productName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  price: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.primary,
  },
  cardContainer: {
    marginBottom: 20,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  cardHint: {
    fontSize: 12,
    color: colors.onSurface,
    marginTop: 8,
    fontStyle: 'italic',
  },
  errorContainer: {
    backgroundColor: colors.errorBg,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: colors.error,
    fontSize: 14,
  },
  buttonContainer: {
    marginTop: 8,
    marginBottom: 16,
  },
  payButton: {
    marginBottom: 12,
  },
  payButtonContent: {
    paddingVertical: 8,
  },
  cancelButton: {
    marginTop: 4,
  },
  secureText: {
    fontSize: 12,
    color: colors.onSurface,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
