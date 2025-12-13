# Reece API Integration Guide

Complete guide for using the Reece API integration in QuoteMate.

## Table of Contents

1. [Overview](#overview)
2. [Configuration](#configuration)
3. [Authentication](#authentication)
4. [Customer Onboarding](#customer-onboarding)
5. [Product Search](#product-search)
6. [Quotes](#quotes)
7. [Pricing](#pricing)
8. [Punchout](#punchout)
9. [Orders](#orders)
10. [Invoices](#invoices)
11. [Branches](#branches)
12. [Error Handling](#error-handling)

## Overview

The Reece API provides access to:
- Product catalogue search
- Quote management
- Price files
- Shopping cart (punchout)
- Order creation
- Invoice retrieval
- Branch information

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Test Environment (Default)
REECE_CLIENT_ID=3s1ok8cc65b1jj2575u7a685fd
REECE_CLIENT_SECRET=ldqnu1lbteknqnsr1b3d4j9h36qu9ucs64q152t22ske39epfvl
REECE_CUSTOMER_NUMBER=3204941
REECE_REGION=au
REECE_USE_TEST_ENV=true

# Production Environment
# REECE_CLIENT_ID=your_production_client_id
# REECE_CLIENT_SECRET=your_production_client_secret
# REECE_CUSTOMER_NUMBER=your_customer_number
# REECE_REGION=au
# REECE_USE_TEST_ENV=false
```

### Basic Setup

```typescript
import { reeceApi, createReeceApiClient } from './services/reeceApi';

// Use the default instance (test credentials)
const api = reeceApi;

// Or create a custom instance
const customApi = createReeceApiClient({
  clientId: 'your_client_id',
  clientSecret: 'your_client_secret',
  customerNumber: 'your_customer_number',
  region: 'au',
}, false); // false = use production environment
```

## Authentication

The API automatically handles OAuth2 authentication and token refresh.

```typescript
// Manually acquire a token (usually not needed)
const tokenResponse = await api.acquireAccessToken();
console.log('Access token:', tokenResponse.access_token);
console.log('Expires in:', tokenResponse.expires_in);
```

## Customer Onboarding

For platforms that serve multiple customers, use the onboarding flow:

### Step 1: Generate Request Token

```typescript
const requestToken = await api.generateOnboardingRequestToken();
```

### Step 2: Redirect User for Authentication

```typescript
const callbackUrl = 'https://yourapp.com/reece/callback';
const redirectUrl = api.buildOnboardingRedirectUrl(requestToken, callbackUrl);

// Redirect user to this URL
window.location.href = redirectUrl;
```

### Step 3: Generate Customer Token

After the user authenticates and is redirected back:

```typescript
// Extract request token from callback
const requestToken = 'token_from_callback';

// Generate customer token
const customerData = await api.generateCustomerToken(requestToken);
console.log('Customer token:', customerData.customerToken);
console.log('Customer number:', customerData.customerNumber);
console.log('Customer name:', customerData.displayName);
console.log('Home branch:', customerData.homeBranch);

// The API will automatically use this customer token for future requests
```

### Unlink Customer

```typescript
await api.unlinkCustomer(customerToken);
```

## Product Search

Search the Reece product catalogue:

```typescript
const searchResults = await api.searchProducts({
  searchPhrase: 'copper pipe',
  pageNumber: 1,
  pageSize: 20,
});

console.log('Total results:', searchResults.totalResults);
console.log('GST rate:', searchResults.gstRate);

searchResults.products.forEach(product => {
  console.log('Product ID:', product.productId);
  console.log('Title:', product.productTitle);
  console.log('Images:', product.productImages);
  console.log('Units of measure:', product.unitOfMeasures);
});
```

## Quotes

### Get Quote Headers

Retrieve a list of quotes:

```typescript
const quotes = await api.getQuoteHeaders({
  fromDate: '2024-01-01',
  toDate: '2024-12-31',
  quoteStages: ['Won', 'Entered'], // Optional: filter by stage
});

quotes.forEach(quote => {
  console.log('Quote number:', quote.quoteNumber);
  console.log('Date:', quote.quoteDate);
  console.log('Branch:', quote.branchNumber);
  console.log('Job name:', quote.jobName);
  console.log('Stage:', quote.stage);
  console.log('Expiry:', quote.expiryDate);
});
```

### Get Quote Details

Retrieve detailed information for specific quotes:

```typescript
const quoteDetails = await api.getQuoteDetails([4012342, 4012343]);

quoteDetails.documents.forEach(quote => {
  console.log('Quote number:', quote.quoteNumber);
  console.log('Customer number:', quote.customerNumber);
  console.log('Branch:', quote.branchName);
  console.log('Salesperson:', quote.salesPersonName);
  console.log('Total:', quote.totals.documentTotal);

  quote.quoteLines.forEach(line => {
    console.log('Line:', line.lineNumber);
    console.log('Product:', line.productDescription);
    console.log('Quantity:', line.quantity);
    console.log('Price:', line.unitPriceExcludingGst);
  });
});
```

## Pricing

### Get Price File

```typescript
// Get price file in JSON format with additional fields
const priceFile = await api.getPriceFile({
  format: 'MAX_JSON',
  additionalFields: ['CATEGORY', 'SECTION', 'PRODUCT_IMAGES'],
});

// Or get it in CSV format
const csvPriceFile = await api.getPriceFile({
  format: 'MAX_CSV',
});
```

### Update Price File Settings

```typescript
const callbackUrl = 'https://yourapp.com/reece/price-callback';
const settingsUrl = api.buildPriceFileSettingsUrl(customerToken, callbackUrl);

// Redirect user to configure price file settings
window.location.href = settingsUrl;
```

### Trigger Price File Generation

```typescript
await api.triggerPriceFileGeneration();
// Price file will be generated asynchronously
```

### Disconnect Price File

```typescript
await api.disconnectPriceFile();
```

## Punchout

Build a shopping cart using Reece's interface:

### Step 1: Build Punchout URL

```typescript
const punchoutUrl = api.buildPunchoutUrl({
  clientId: 'your_domain_key',
  hookUrl: 'https://yourapp.com/reece/cart-callback',
  customerToken: 'customer_token', // or customerNumber
});

// Redirect user to Reece to build cart
window.location.href = punchoutUrl;
```

### Step 2: Retrieve Cart

After user completes shopping and is redirected back:

```typescript
// Extract cart token from callback
const cartToken = 'token_from_callback';

const cart = await api.getCartByToken(
  cartToken,
  customerToken,
  customerNumber
);

cart.products.forEach(product => {
  console.log('Product:', product.productDescription);
  console.log('Quantity:', product.quantity);
  console.log('Price (ex GST):', product.unitPriceExcludingGst);
  console.log('Price (inc GST):', product.unitPriceIncludingGst);
  console.log('Market price:', product.unitMarketPriceExcludingGst);
});
```

## Orders

### Preview an Order

Preview an order before submitting:

```typescript
const orderPreview = await api.previewOrder({
  jobName: 'Bathroom Renovation',
  orderNumber: 'JOB-2024-001',
  orderByName: 'John Smith',
  orderByPhone: '+61 404 000 000',
  orderByEmail: 'john@example.com',
  requiredByDateTime: '2024-12-31T10:00:00',
  fulfillment: {
    type: 'PICKUP',
    pickupBranch: 3032,
  },
  products: [
    {
      productId: 1400200,
      quantity: 5,
      unitOfMeasure: 'EA',
      unitPriceExcludingGst: 10.50,
      unitPriceIncludingGst: 11.55,
    },
  ],
});

console.log('Cartage fee:', orderPreview.cartageFee);
```

### Check/Validate an Order

```typescript
const orderCheck = await api.checkOrder({
  // ... same structure as preview
});

orderCheck.products.forEach(product => {
  console.log('Product status:', product.status);
});
```

### Create an Order

```typescript
const order = await api.createOrder({
  jobName: 'Bathroom Renovation',
  orderNumber: 'JOB-2024-001',
  orderByName: 'John Smith',
  orderByPhone: '+61 404 000 000',
  orderByEmail: 'john@example.com',
  comment: 'Please deliver to rear entrance',
  requiredByDateTime: '2024-12-31T10:00:00',
  notification: {
    email: 'john@example.com',
    sms: '+61 404 000 000',
  },
  fulfillment: {
    type: 'DELIVERY',
    deliveryDetails: {
      deliveryInstructions: 'Ring doorbell',
      contactName: 'John Smith',
      contactNumber: '+61 404 000 000',
      deliveryAddress: {
        addressLine1: '123 Main Street',
        suburb: 'Melbourne',
        state: 'VIC',
        postcode: '3000',
      },
    },
  },
  products: [
    {
      productId: 1400200,
      quantity: 5,
      unitOfMeasure: 'EA',
      unitPriceExcludingGst: 10.50,
      unitPriceIncludingGst: 11.55,
    },
  ],
  attachments: [
    {
      type: 'URL_LINK',
      name: 'purchase-order.pdf',
      content: 'https://example.com/po.pdf',
    },
  ],
});

console.log('Order ID:', order.id);
console.log('Order status:', order.status);
```

### Order from Quote

```typescript
const order = await api.createOrder({
  orderByName: 'John Smith',
  orderByPhone: '+61 404 000 000',
  orderFromQuote: 554545432, // Order all products from this quote
  requiredByDateTime: '2024-12-31T10:00:00',
  fulfillment: {
    type: 'PICKUP',
    pickupBranch: 3032,
  },
  products: [], // Not needed when ordering from quote
});
```

## Invoices

### Search Invoice Headers

```typescript
const invoiceHeaders = await api.searchInvoiceHeaders({
  documentTypes: ['TAX_INVOICE', 'CREDIT_NOTE'],
  fromDate: '2024-01-01',
  toDate: '2024-12-31',
});

invoiceHeaders.documentHeaders.forEach(header => {
  console.log('Document number:', header.documentNumber);
  console.log('Type:', header.documentType);
  console.log('Date:', header.documentDate);
  console.log('Job number:', header.jobNumber);
});
```

### Get Invoice Details

```typescript
const invoices = await api.getInvoices([12345678, 12345679]);

invoices.documents.forEach(invoice => {
  console.log('Invoice number:', invoice.documentNumber);
  console.log('Type:', invoice.documentType);
  console.log('Customer:', invoice.customer.name);
  console.log('Total:', invoice.totals.total);
  console.log('Due date:', invoice.documentDueDate);
  console.log('PDF URL:', invoice.invoiceUrl);

  invoice.invoiceLines.forEach(line => {
    console.log('Product:', line.productDescription);
    console.log('Quantity:', line.quantity);
    console.log('Price:', line.unitPriceExcludingGst);
  });
});
```

### Get Invoice PDF

```typescript
const pdfBlob = await api.getInvoiceDocument(12345678);

// Save or display the PDF
const url = URL.createObjectURL(pdfBlob);
window.open(url);
```

### Invoice Sync Settings

```typescript
// Enable invoice syncing
await api.updateInvoiceSyncSettings({
  format: 'CSV',
});

// Disable invoice syncing
await api.disconnectInvoiceSync();
```

## Branches

Get information about all Reece branches:

```typescript
const branchesResponse = await api.getAllBranches();

branchesResponse.branches.forEach(branch => {
  console.log('Branch number:', branch.branchNumber);
  console.log('Name:', branch.name);
  console.log('Short name:', branch.shortName);
  console.log('Phone:', branch.telephone);
  console.log('Email:', branch.emailAddress);
  console.log('Manager:', branch.managerName);
  console.log('Timezone:', branch.timeZone);
  console.log('Address:', branch.address);
  console.log('Coordinates:', branch.geographicalCoordinates);
});
```

## Error Handling

All API methods throw errors on failure. Always wrap calls in try-catch:

```typescript
try {
  const products = await api.searchProducts({
    searchPhrase: 'copper pipe',
  });
  // Handle success
} catch (error) {
  console.error('Failed to search products:', error);
  // Handle error
  if (error.message.includes('401')) {
    // Authentication error
  } else if (error.message.includes('400')) {
    // Bad request
  } else if (error.message.includes('404')) {
    // Not found
  }
}
```

## Advanced Configuration

### Setting Customer Token/Number

```typescript
// Use customer token
api.setCustomerToken('customer_token_here');

// Or use customer number
api.setCustomerNumber('3204941');
```

### Checking Configuration

```typescript
if (api.isConfigured()) {
  console.log('API is properly configured');
} else {
  console.log('API missing credentials');
}

const config = api.getConfig();
console.log('Current config:', config);
```

## Test Credentials

The implementation includes test credentials for development:

```
Client ID: 3s1ok8cc65b1jj2575u7a685fd
Client Secret: ldqnu1lbteknqnsr1b3d4j9h36qu9ucs64q152t22ske39epfvl
Customer Number: 3204941
Auth Base URL: https://auth.api.test.reecegroup.com.au
API Base URL: https://api.test.reecegroup.com.au
Region: au
```

## Production Deployment

1. Obtain production credentials from Reece
2. Update environment variables:
   ```env
   REECE_CLIENT_ID=your_production_client_id
   REECE_CLIENT_SECRET=your_production_client_secret
   REECE_CUSTOMER_NUMBER=your_customer_number
   REECE_USE_TEST_ENV=false
   ```
3. Create a production API instance:
   ```typescript
   const productionApi = createReeceApiClient({
     clientId: process.env.REECE_CLIENT_ID,
     clientSecret: process.env.REECE_CLIENT_SECRET,
     customerNumber: process.env.REECE_CUSTOMER_NUMBER,
     region: 'au',
     authBaseUrl: 'https://auth.api.reecegroup.com.au',
     apiBaseUrl: 'https://api.reecegroup.com.au',
   }, false);
   ```

## Support

For API access and support, contact the ReeceConnect team:
- Email: ConnectingCustomers@reece.com.au
- Documentation: https://docs.api.reecegroup.com.au/latest/index.html
