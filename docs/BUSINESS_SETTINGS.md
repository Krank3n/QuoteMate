# Business Settings

Configure your business profile and preferences to personalize your quotes and invoices.

## Overview

Business settings allow you to:

- Set up your business identity
- Configure default pricing
- Choose your trade type
- Upload your logo
- Set up payment methods
- Control document appearance

## Accessing Settings

1. Tap the **Settings** tab in the bottom navigation
2. Scroll through available sections
3. Make changes as needed
4. Changes save automatically

## Business Information

### Business Name

Your registered business name appears on all documents.

**Example:** "Smith Plumbing Pty Ltd"

### ABN (Australian Business Number)

Your 11-digit ABN for tax purposes.

**Format:** XX XXX XXX XXX

**Displayed on:**
- Quotes
- Invoices
- PDF documents

### Contact Email

Business email for customer correspondence.

**Used for:**
- Document headers
- Customer contact

### Phone Number

Business phone number.

**Format:** Australian mobile or landline

### Business Address

Your registered business address.

**Displayed on:**
- Document headers
- Professional appearance

## Business Logo

### Uploading a Logo

1. Tap **Business Logo** section
2. Tap **Upload Logo** or existing logo
3. Select image from device
4. Crop/adjust as needed
5. Confirm selection

### Logo Requirements

| Requirement | Specification |
|-------------|---------------|
| Format | PNG, JPG, JPEG |
| Recommended Size | 300x300 pixels |
| Max File Size | 5 MB |
| Aspect Ratio | Square preferred |

### Logo Appearance

Your logo appears on:
- Quote PDFs (top corner)
- Invoice PDFs (top corner)
- Professional branding

### Removing a Logo

1. Tap the logo section
2. Select **Remove Logo**
3. Confirm removal

## Trade Configuration

### Trade Type

Select your primary trade:

| Trade | Description |
|-------|-------------|
| Carpenter | Woodworking and construction |
| Plumber | Plumbing and pipework |
| Electrician | Electrical installation and repair |
| Cleaner | Cleaning services |
| All | General tradesperson |

**Impact:**
- Material suggestions
- Pricing sources (e.g., Reece for plumbers)
- Template options

### Trade Categories

Select specific categories within your trade for more targeted material suggestions.

**Example Categories:**
- Bathroom renovations
- Kitchen installations
- New builds
- Repairs and maintenance

### Hardware Store Preference

Choose your preferred hardware supplier:

- **Bunnings** - Default option
- **Mitre 10** - Alternative supplier

**Impact:**
- Material search results
- Price lookups

## Pricing Defaults

### Default Labor Rate

Set your standard hourly rate.

**Example:** $85/hour

**Used as:**
- Default when creating new quotes
- Can be overridden per quote

### Default Markup Percentage

Set your standard markup on materials.

**Example:** 20%

**Used as:**
- Default for new quotes
- Can be adjusted per quote

## Display Options

### Show Labor Hours

Control whether labor hours appear on documents.

**Enabled:**
- Shows hours and rate breakdown
- Example: "8 hours @ $85/hr = $680"

**Disabled:**
- Shows only total labor cost
- Example: "Labor: $680"

### Show Payment Info

Control whether payment methods appear on invoices.

**Enabled:**
- Payment methods section on invoice PDF
- Bank details, PayID, etc. displayed

**Disabled:**
- Payment section hidden
- Communicate payment details separately

## Pricing Source

Material prices are resolved automatically through a local-first chain:

1. **Section templates** — your saved bundles with prices already attached
2. **Supplier price book** — your favourites tagged to your configured suppliers
3. **Bunnings scraper** — runs only if Bunnings is in your supplier list
4. **Web scraping** — for other configured suppliers with a search URL
5. **AI estimation** — Claude-powered fallback when nothing else turns up

You don't pick a method — the chain runs in order so your own data
always wins over a retail lookup.

## Payment Methods

Configure payment options displayed on invoices.

[See Payment Methods documentation](./PAYMENT_METHODS.md)

**Available Options:**
- Bank Transfer
- PayID
- BPAY
- PayPal
- Custom Instructions

## Account Settings

### Sign Out

1. Scroll to **Account** section
2. Tap **Sign Out**
3. Confirm your choice

**Note:** Local data remains; cloud sync stops.

### Delete Account

1. Scroll to **Account** section
2. Tap **Delete Account**
3. Read warnings carefully
4. Confirm permanent deletion

**Warning:** This action is irreversible.

## Cloud Sync

All business settings sync across devices:

- Change settings on one device
- Automatically available on all devices
- Real-time synchronization

## Best Practices

### Complete Your Profile

1. **Add business name and ABN** - Required for tax compliance
2. **Upload a professional logo** - Builds brand recognition
3. **Include contact details** - Easy for customers to reach you
4. **Set accurate rates** - Ensures quote accuracy

### Optimize Defaults

1. **Set realistic labor rate** - Reflects your actual charges
2. **Choose appropriate markup** - Industry standard is 15-30%
3. **Select correct trade** - Gets relevant suggestions

### Professional Appearance

1. **Use a clear logo** - High resolution, simple design
2. **Keep information current** - Update if details change
3. **Include full address** - Adds legitimacy
4. **Display ABN** - Required for GST invoices

## Troubleshooting

### Settings Not Saving

1. Check internet connection
2. Ensure you're signed in
3. Try closing and reopening the app
4. Check for app updates

### Logo Not Displaying

1. Verify image format (PNG/JPG)
2. Check file size (under 5MB)
3. Re-upload the image
4. Clear app cache if needed

### Settings Not Syncing

1. Verify internet connection
2. Check sign-in status
3. Wait a moment and refresh
4. Sign out and back in
