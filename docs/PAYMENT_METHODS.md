# Payment Methods Configuration

QuoteMate allows you to configure multiple payment methods that appear on your invoices, making it easy for customers to pay you.

## Overview

Configure your preferred payment methods in Settings, and they'll automatically appear on your generated invoice PDFs. This helps customers understand how to pay you quickly and reduces payment delays.

## Accessing Payment Settings

1. Navigate to the **Settings** tab
2. Scroll to the **Payment Methods** section
3. Configure your preferred payment options

## Available Payment Methods

### Bank Transfer

Accept direct deposits or electronic fund transfers (EFT).

**Required Information:**
- **BSB**: Your bank's BSB number (6 digits)
- **Account Number**: Your bank account number
- **Account Name**: The name on your account (optional, auto-filled from business name)

**Example:**
```
BSB: 123-456
Account: 12345678
Name: Smith Plumbing Pty Ltd
```

### PayID

Accept instant payments via Australia's PayID system.

**PayID Types:**
- **Phone Number**: Your mobile number linked to PayID
- **Email**: Your email address linked to PayID
- **ABN**: Your Australian Business Number linked to PayID

**Example:**
```
PayID: 0412 345 678 (Mobile)
```

### BPAY

Accept BPAY payments for customers who prefer this method.

**Required Information:**
- **Biller Code**: Your BPAY biller code
- **Reference Number**: Customer reference (can be invoice number)

**Note:** BPAY requires a business account with BPAY registration.

**Example:**
```
Biller Code: 12345
Ref: INV-001
```

### PayPal

Accept PayPal payments for online convenience.

**Required Information:**
- **PayPal Email**: The email associated with your PayPal business account

**Example:**
```
PayPal: payments@smithplumbing.com.au
```

### Custom Instructions

Add any additional payment instructions or notes.

**Examples:**
- "Please include invoice number in payment reference"
- "Payments over $1,000 require bank transfer"
- "Cash payments accepted on site"

## Configuring Payment Methods

### Enable/Disable Methods

Each payment method can be individually enabled or disabled:

1. Toggle the switch next to each payment method
2. Enabled methods will appear on invoices
3. Disabled methods are hidden from invoices

### Show Payment Info on Documents

Control whether payment information appears on your documents:

1. Find the **Show Payment Info** toggle
2. Enable to display payment methods on invoices
3. Disable to hide payment information

This is useful if you:
- Invoice through a different system
- Prefer to communicate payment details separately
- Have different payment arrangements per client

## How Payment Info Appears

When enabled, payment information appears at the bottom of your invoice PDFs:

```
─────────────────────────────
PAYMENT METHODS

Bank Transfer
BSB: 123-456
Account: 12345678
Account Name: Smith Plumbing Pty Ltd

PayID
Mobile: 0412 345 678

BPAY
Biller Code: 12345
Reference: INV-001
─────────────────────────────
```

## Best Practices

### Security

1. **Use a business account** - Keep personal and business finances separate
2. **Verify details** - Double-check all account numbers before saving
3. **Update promptly** - Change settings immediately if account details change

### Customer Experience

1. **Offer multiple options** - Different customers prefer different methods
2. **Bank Transfer + PayID** - These are the most common combination
3. **Include clear instructions** - Help customers pay correctly the first time

### Professional Appearance

1. **Consistent formatting** - Use proper formatting for BSB (xxx-xxx)
2. **Business name** - Use your registered business name
3. **Complete information** - Provide all necessary details for each method

## Syncing Payment Settings

Your payment method configuration syncs across devices:

- Set up once, use everywhere
- Changes sync in real-time
- All team members see the same settings

## Privacy Considerations

Payment details on invoices are visible to customers. Consider:

- Only include methods you actively use
- Keep account numbers accurate
- Review before sending each invoice

## Troubleshooting

### Payment Info Not Showing

1. Check that **Show Payment Info** is enabled
2. Verify at least one payment method is configured
3. Ensure the payment method toggle is enabled

### Wrong Details Appearing

1. Go to Settings > Payment Methods
2. Update the incorrect information
3. Save changes
4. Regenerate the invoice PDF

### Missing Payment Methods

If a payment method option is missing:

1. Ensure you have the latest app version
2. Check Settings for all available options
3. Contact support if issues persist
