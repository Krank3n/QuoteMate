# Payment Tracking

QuoteMate provides comprehensive payment tracking for invoices, allowing you to record payments, track partial payments, and monitor outstanding balances.

## Overview

The payment tracking system allows you to:

- Record full or partial payments
- Track multiple payments per invoice
- Log payment methods and dates
- Add notes to each payment
- Automatically update invoice status

## Recording a Payment

### From the Invoice View

1. Open an invoice from the Invoices list
2. Tap **Record Payment**
3. Enter the payment details:
   - **Amount**: The payment amount received
   - **Payment Date**: When the payment was received
   - **Payment Method**: How the customer paid
   - **Notes**: Optional notes about the payment

### Payment Validation

- Payment amount cannot exceed the amount due
- Payment date is required
- A payment method must be selected

## Payment Methods

The following payment methods are supported:

| Method | Description |
|--------|-------------|
| Bank Transfer | Direct bank deposit or EFT |
| Card | Credit or debit card payment |
| Cash | Physical cash payment |
| Cheque | Payment by cheque |
| Other | Any other payment method |

## Invoice Status Updates

When you record a payment, the invoice status is automatically updated:

| Scenario | New Status |
|----------|------------|
| Full payment recorded | `paid` |
| Partial payment recorded | `partial` |
| Multiple payments totaling full amount | `paid` |

## Payment History

Each invoice maintains a complete payment history showing:

- Payment amount
- Payment date
- Payment method
- Notes
- Running balance

## Viewing Payment Details

On the View Invoice screen, you can see:

- **Total Amount**: The full invoice amount
- **Amount Paid**: Sum of all payments received
- **Amount Due**: Remaining balance (Total - Paid)
- **Payment History**: List of all recorded payments

## Partial Payments

The system fully supports partial payments:

1. Customer pays $500 on a $1,000 invoice
2. Invoice status changes to `partial`
3. Amount Due shows $500 remaining
4. Later, customer pays remaining $500
5. Invoice status changes to `paid`

## Payment Calculations

The system provides several helper functions:

### Amount Due Calculation

```
Amount Due = Total (incl. GST) - Sum of All Payments
```

### Days Until Due

Calculates the number of days remaining until the invoice is due:

- Positive number: Days remaining
- Zero: Due today
- Negative number: Days overdue

### Overdue Detection

An invoice is considered overdue when:

- Current date is past the due date
- Invoice status is not `paid`, `cancelled`, or `draft`
- There is still an amount due

## Best Practices

1. **Record payments promptly** to maintain accurate records
2. **Include payment notes** for reference (e.g., "Bank reference: 12345")
3. **Verify payment method** matches your records
4. **Follow up on partial payments** to collect remaining balance
5. **Review overdue invoices regularly** using the status filter

## Payment Terms Impact

Payment terms affect due date calculation:

| Payment Terms | Due Date |
|---------------|----------|
| Due on Receipt | Same as invoice date |
| Net 7 | Invoice date + 7 days |
| Net 14 | Invoice date + 14 days |
| Net 30 | Invoice date + 30 days |
| Custom (X days) | Invoice date + X days |

## PDF Invoice Updates

When payments are recorded, the generated PDF reflects:

- Current payment status
- Amount paid to date
- Remaining balance due
- Payment terms and due date

## Cloud Synchronization

Payment records are synced across all devices:

- Record a payment on your phone, see it on your tablet
- Real-time updates ensure accuracy
- Full payment history preserved
