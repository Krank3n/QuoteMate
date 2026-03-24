---
name: reece-api
description: Reference guide for Reece Group API integration — endpoints, auth flow, onboarding, and current status
disable-model-invocation: true
allowed-tools: Bash, Read, Edit, Glob, Grep, WebFetch
---

# Reece API Integration Reference

Quick reference for working on the Reece API integration in QuoteMate.

## Current Status (as of 2026-03-19)

- **OAuth2 token acquisition**: WORKING. Credentials are valid.
- **Customer onboarding**: BLOCKED. maX test account 3204941 registration fails ("We've hit a blockage"). Waiting on Christie Howard to fix.
- **Product search, pricing, invoicing, etc.**: BLOCKED. All require a `Customer-Token` or working `Customer-Number`, which requires completing onboarding first.
- **IP whitelist**: May need updating. Last sent to Christie: `122.150.250.38` on 2026-03-13. Check current IP with `curl ifconfig.me`.

## Contact

- Christie Howard (Digital Product Manager) — Christie.Howard@reece.com.au
- Team email: ConnectingCustomers@reece.com.au

## Environment & Credentials

```
# Test environment (currently in use)
Auth URL:  https://auth.api.test.reecegroup.com.au/oauth2/token
API URL:   https://open.api.test.reecegroup.com.au
Stage web: https://stage.reece.com.au/

# Production (for later)
Auth URL:  https://auth.api.reecegroup.com.au/oauth2/token
API URL:   https://open.api.reecegroup.com.au

# Credentials (in .env)
Client ID:       REECE_CLIENT_ID
Client Secret:   REECE_CLIENT_SECRET
Customer Number: REECE_CUSTOMER_NUMBER (3204941 for test)
Region:          REECE_REGION (au)
```

Test environment is only available weekdays 5am–8pm Melbourne time (AEST/AEDT).

## Authentication Flow

### Step 1: Get OAuth2 Access Token
```bash
curl -X POST 'https://auth.api.test.reecegroup.com.au/oauth2/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H "Authorization: Basic $(echo -n '<clientId>:<clientSecret>' | base64)" \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'scope=Default/read Default/write'
```
Returns: `{ "access_token": "...", "expires_in": 3600, "token_type": "Bearer" }`

### Step 2: Customer Onboarding (OAuth2 + redirect flow)
1. `POST /{au|nz}/customer-application-onboarding-gateway/request-token` → get `requestToken`
2. Redirect user to: `https://stage.reece.com.au/link-application/account-select?request_token={token}&callback_url={url}`
3. User logs in with maX account and authorises
4. `POST /{au|nz}/customer-application-onboarding-gateway/customer-token` with `{ "requestToken": "..." }` → get `customerToken`

### Step 3: Make API calls
All API calls require:
- `Authorization: Bearer <AccessToken>` header
- PLUS one of: `Customer-Token: <token>` OR `Customer-Number: <number>` header

## Key API Endpoints

All endpoints are prefixed with `/{au|nz}/` (e.g., `/au/product-gateway/search`).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/product-gateway/search?searchPhrase=...&pageNumber=1&pageSize=10` | GET | Search product catalogue |
| `/price-gateway/price-file?format=MAX_JSON` | GET | Download full price file |
| `/price-gateway/price-file/trigger-generation` | POST | Trigger price file generation |
| `/quote-gateway/quote-headers?fromDate=...&toDate=...` | GET | List quotes |
| `/quote-gateway/quote-details?quoteNumbers=...` | GET | Quote details |
| `/invoice-gateway/invoice-headers?documentTypes=...&fromDate=...&toDate=...` | GET | List invoices |
| `/invoice-gateway/invoices?documentNumbers=...` | GET | Invoice details |
| `/invoice-gateway/invoice-documents?documentNumbers=...` | GET | Invoice PDF |
| `/order-gateway/orders` | POST | Create order |
| `/order-gateway/preview` | POST | Preview order |
| `/order-gateway/check` | POST | Check order validity |
| `/branches` | GET | List all branches |
| `/punch-out-catalog/gateway?clientId=...&hookUrl=...&customerToken=...` | GET | Punchout to maX cart |
| `/punch-out-cart/cart/{cartToken}` | GET | Fetch punchout cart |

## Codebase Files

- **Backend (Firebase Functions)**: `functions/src/index.ts` — lines ~1630-1936
  - `getReeceAuthToken()` — OAuth2 token with caching
  - `checkReeceApi` — health check endpoint
  - `searchReeceProduct` — product search
  - `getReecePrice` — pricing lookup
  - `getReeceInventory` — inventory check
- **Frontend service**: `src/services/reeceApi.ts` — client-side wrapper calling Firebase Functions
- **Store config**: `src/constants/tradeStores.ts` — Reece listed as default plumbing store
- **Materials screen**: `src/screens/NewQuote/MaterialsListScreen.tsx` — uses Reece for price lookup

## Quick Test Commands

```bash
# Test OAuth token (should return access_token)
curl -s -X POST 'https://auth.api.test.reecegroup.com.au/oauth2/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H "Authorization: Basic $(echo -n '3s1ok8cc65b1jj2575u7a685fd:ldqnu1lbteknqnsr1b3d4j9h36qu9ucs64q152t22ske39epfvl' | base64)" \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'scope=Default/read Default/write' | python3 -m json.tool

# Test onboarding request token (should return requestToken)
TOKEN="<paste access_token from above>"
curl -s -X POST "https://open.api.test.reecegroup.com.au/au/customer-application-onboarding-gateway/request-token" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Test product search (will fail until onboarding complete)
curl -s "https://open.api.test.reecegroup.com.au/au/product-gateway/search?searchPhrase=copper%20pipe&pageNumber=1&pageSize=5" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Customer-Number: 3204941" | python3 -m json.tool
```

## TODO (once onboarding is unblocked)

1. Build the customer onboarding redirect flow in the app (request token → redirect → callback → customer token)
2. Store customer tokens per user in Firestore
3. Test product search, pricing, and invoicing endpoints with real customer token
4. Implement price file sync (bulk download of customer-specific prices)
5. Add punchout flow so users can build carts on maX and pull them back into QuoteMate
6. Update frontend `reeceApi.ts` to support the onboarding flow
7. Switch from test to production environment
