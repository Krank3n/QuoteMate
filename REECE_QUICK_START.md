# Reece API Quick Start

## 🚀 5-Minute Setup

### 1. Import the API
```typescript
import { reeceApi } from './src/services/reeceApi';
```

### 2. Search Products
```typescript
const results = await reeceApi.searchProducts({
  searchPhrase: 'copper pipe',
  pageSize: 10
});

results.products.forEach(p => {
  console.log(p.productTitle, p.productId);
});
```

### 3. Get Quotes
```typescript
const quotes = await reeceApi.getQuoteHeaders({
  fromDate: '2024-01-01',
  toDate: '2024-12-31'
});
```

### 4. Get Branches
```typescript
const { branches } = await reeceApi.getAllBranches();
```

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `REECE_API_USAGE.md` | Complete API reference with examples |
| `REECE_INTEGRATION_GUIDE.md` | How to integrate into QuoteMate |
| `REECE_IMPLEMENTATION_SUMMARY.md` | What was built and why |
| `REECE_QUICK_START.md` | This file - quick reference |

## 🔑 Test Credentials (Already Configured)

```env
REECE_CLIENT_ID=3s1ok8cc65b1jj2575u7a685fd
REECE_CLIENT_SECRET=ldqnu1lbteknqnsr1b3d4j9h36qu9ucs64q152t22ske39epfvl
REECE_CUSTOMER_NUMBER=3204941
REECE_REGION=au
REECE_USE_TEST_ENV=true
```

## 🧪 Test the API

```bash
npx ts-node test-reece-api.ts
```

## 📦 What's Available

### Core API Methods

```typescript
// Authentication (automatic)
await reeceApi.acquireAccessToken();

// Product Search
await reeceApi.searchProducts({ searchPhrase: 'string' });

// Quotes
await reeceApi.getQuoteHeaders({ fromDate, toDate });
await reeceApi.getQuoteDetails([quoteNumber]);

// Pricing
await reeceApi.getPriceFile({ format: 'MAX_JSON' });
await reeceApi.triggerPriceFileGeneration();

// Orders
await reeceApi.createOrder({ ...orderData });
await reeceApi.previewOrder({ ...orderData });
await reeceApi.checkOrder({ ...orderData });

// Invoices
await reeceApi.searchInvoiceHeaders({ fromDate, toDate });
await reeceApi.getInvoices([documentNumber]);
await reeceApi.getInvoiceDocument(documentNumber);

// Branches
await reeceApi.getAllBranches();

// Punchout/Cart
const url = reeceApi.buildPunchoutUrl({ ...params });
await reeceApi.getCartByToken(cartToken);

// Customer Management
await reeceApi.generateOnboardingRequestToken();
await reeceApi.generateCustomerToken(requestToken);
await reeceApi.unlinkCustomer(customerToken);
```

## 🎯 Common Use Cases

### Search and Display Products
```typescript
const { products } = await reeceApi.searchProducts({
  searchPhrase: 'copper',
  pageNumber: 1,
  pageSize: 20
});

products.forEach(product => {
  console.log(`${product.productTitle} - $${product.productId}`);
});
```

### Get Recent Quotes
```typescript
const today = new Date();
const sixMonthsAgo = new Date();
sixMonthsAgo.setMonth(today.getMonth() - 6);

const quotes = await reeceApi.getQuoteHeaders({
  fromDate: sixMonthsAgo.toISOString().split('T')[0],
  toDate: today.toISOString().split('T')[0],
  quoteStages: ['Won', 'Entered']
});
```

### Find Nearest Branch
```typescript
const { branches } = await reeceApi.getAllBranches();

const nearest = branches
  .sort((a, b) => {
    // Sort by distance to user location
    const distA = calculateDistance(userLocation, a.geographicalCoordinates);
    const distB = calculateDistance(userLocation, b.geographicalCoordinates);
    return distA - distB;
  })[0];

console.log(`Nearest: ${nearest.name} - ${nearest.telephone}`);
```

### Create Order from Quote
```typescript
const order = await reeceApi.createOrder({
  orderByName: 'John Smith',
  orderByPhone: '+61 404 000 000',
  orderFromQuote: 554545432,
  requiredByDateTime: '2024-12-31T10:00:00',
  fulfillment: {
    type: 'PICKUP',
    pickupBranch: 3032
  },
  products: [] // Not needed when using orderFromQuote
});

console.log('Order created:', order.id);
```

## 🎨 UI Component Example

```typescript
import React, { useState } from 'react';
import { View, TextInput, Button, FlatList } from 'react-native';
import { reeceApi } from './services/reeceApi';

export const ProductSearch = () => {
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);

  const handleSearch = async () => {
    const results = await reeceApi.searchProducts({
      searchPhrase: search
    });
    setProducts(results.products);
  };

  return (
    <View>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search products..."
      />
      <Button title="Search" onPress={handleSearch} />
      <FlatList
        data={products}
        renderItem={({ item }) => (
          <Text>{item.productTitle}</Text>
        )}
      />
    </View>
  );
};
```

## ⚙️ Configuration

### Use Test Environment (Default)
```typescript
import { reeceApi } from './services/reeceApi';
// Already configured with test credentials
```

### Use Production
```typescript
import { createReeceApiClient } from './services/reeceApi';

const productionApi = createReeceApiClient({
  clientId: process.env.REECE_CLIENT_ID!,
  clientSecret: process.env.REECE_CLIENT_SECRET!,
  customerNumber: process.env.REECE_CUSTOMER_NUMBER,
  region: 'au',
  authBaseUrl: 'https://auth.api.reecegroup.com.au',
  apiBaseUrl: 'https://api.reecegroup.com.au',
}, false);
```

## 🔧 Troubleshooting

### Error: Failed to acquire access token
- Check your internet connection
- Verify credentials in `.env` file
- Ensure test environment is accessible

### Error: API request failed: 401
- Token might be expired (should auto-refresh)
- Try manually calling `reeceApi.acquireAccessToken()`

### Error: API request failed: 400
- Check request parameters
- Review API documentation for required fields
- Validate date formats (YYYY-MM-DD)

### No results found
- Try broader search terms
- Check date ranges (not too narrow)
- Verify customer has data in test environment

## 📞 Support

- **API Issues**: ConnectingCustomers@reece.com.au
- **Implementation Help**: See `REECE_API_USAGE.md`
- **Integration Help**: See `REECE_INTEGRATION_GUIDE.md`

## ✅ Checklist

- [ ] Reviewed this quick start
- [ ] Ran test script: `npx ts-node test-reece-api.ts`
- [ ] Tried example component: `ReeceBrowserExample.tsx`
- [ ] Read `REECE_API_USAGE.md`
- [ ] Planned integration points
- [ ] Tested in your app
- [ ] Obtained production credentials
- [ ] Updated .env for production
- [ ] Deployed!

---

**Need More Info?**
- Full API Reference: `REECE_API_USAGE.md` (500+ lines)
- Integration Guide: `REECE_INTEGRATION_GUIDE.md` (400+ lines)
- Implementation Summary: `REECE_IMPLEMENTATION_SUMMARY.md`
