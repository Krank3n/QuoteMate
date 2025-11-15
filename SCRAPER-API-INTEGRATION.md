# Retail Scraper API Integration

## Overview
QuoteMate now integrates with a standalone retail scraper API hosted on DigitalOcean for real-time pricing from Australian hardware stores.

## API Configuration

### Production API Details
```
Base URL: http://165.22.151.190
API Key: 666d9a00cd10ee9a034215ec3cebc188cbf3e21c789093128e8bc1829c9b3266
```

### Environment Variables
Add to `.env`:
```env
BUNNINGS_SCRAPER_URL=http://165.22.151.190
BUNNINGS_SCRAPER_API_KEY=666d9a00cd10ee9a034215ec3cebc188cbf3e21c789093128e8bc1829c9b3266
```

## API Endpoints

### 1. Health Check
```bash
GET /health
```

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2025-11-12T20:14:15.362Z",
  "uptime": 2071.105185877,
  "cache": {
    "size": 0,
    "keys": []
  }
}
```

### 2. Search Products
```bash
POST /api/search
Headers:
  Content-Type: application/json
  X-API-Key: <your-api-key>
Body:
{
  "searchTerm": "treated pine 90x45",
  "limit": 10,
  "sortBy": "relevance" // or "price-low" or "price-high"
}
```

**Success Response:**
```json
{
  "success": true,
  "results": [
    {
      "productName": "Treated Pine H4 90 x 45mm",
      "price": 15.90,
      "priceIncGst": 15.90,
      "unit": "each",
      "itemNumber": "0065432",
      "brand": "Bunnings",
      "stockLevel": "in-stock",
      "productUrl": "https://www.bunnings.com.au/...",
      "imageUrl": "https://...",
      "confidence": "high"
    }
  ],
  "cached": false,
  "timestamp": "2025-11-12T20:00:00.000Z"
}
```

### 3. Get Product Details
```bash
GET /api/product/:itemNumber
Headers:
  X-API-Key: <your-api-key>
```

## Integration Status

### ✅ Completed
- [x] Environment variables configured in `.env`
- [x] API credentials updated
- [x] Service files updated (`bunningsScraperClient.ts`)
- [x] Health endpoint tested successfully

### ⚠️ Current Issue: Bot Detection
The API is currently experiencing bot detection issues when trying to scrape Bunnings:

```json
{
  "success": false,
  "error": "Access forbidden - possible bot detection",
  "timestamp": "2025-11-12T20:16:10.672Z"
}
```

**Possible Causes:**
1. Bunnings has updated their bot detection mechanisms
2. The scraper needs better browser fingerprinting
3. IP address (165.22.151.190) may be rate-limited or flagged
4. Headers/user-agent need to be more realistic

## Solutions to Bot Detection

### Option 1: Update Scraper (Recommended)
SSH into the DigitalOcean droplet and update the scraper code:

```bash
ssh root@165.22.151.190
cd ~/retail-scraper-api
```

Update the scraper to use better bot avoidance:
- Add realistic browser headers
- Implement rotating user agents
- Add delays between requests
- Use browser automation (Playwright/Puppeteer) instead of direct HTTP requests

### Option 2: Use Proxy Service
Consider using a proxy service to route requests through residential IPs:
- Bright Data (formerly Luminati)
- ScraperAPI
- Oxylabs

### Option 3: Fallback Strategy
The app already has fallback mechanisms:
1. Try scraper API first
2. If it fails, fall back to Bunnings official API (if available)
3. If both fail, use AI-based price estimation

## How QuoteMate Uses the API

The integration is already in place in `MaterialsListScreen.tsx`:

```typescript
// src/screens/NewQuote/MaterialsListScreen.tsx:278-323
if (useScraperApi) {
  // Use Bunnings Scraper API (Priority #1 - Real Prices)
  try {
    console.log(`🔍 Scraper: Searching for "${searchTerm}"...`);
    const product = await findBestMatchForMaterial(searchTerm);

    if (product && product.price > 0) {
      material.price = product.price;
      material.totalPrice = product.price * material.quantity;
      material.manualPriceOverride = false;
      material.pricingSource = 'scraper';
      // ... store additional product data
      fetchedCount++;
    }
  } catch (error) {
    // Fallback to next pricing method
  }
}
```

## Testing the Integration

### From Your Mac
```bash
# Test health endpoint
curl http://165.22.151.190/health

# Test search (currently returns bot detection error)
curl -X POST http://165.22.151.190/api/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 666d9a00cd10ee9a034215ec3cebc188cbf3e21c789093128e8bc1829c9b3266" \
  -d '{"searchTerm":"screws","limit":3,"sortBy":"relevance"}'
```

### From the QuoteMate App
Once the bot detection is resolved, the app will automatically use the scraper when:
1. User clicks "Fetch Prices" on the Materials screen
2. User searches for a product to add
3. User edits a material and clicks "Fetch Price"

## Next Steps

1. **Fix Bot Detection** - Update the scraper on the droplet to avoid detection
2. **Test with Real Searches** - Once fixed, test with various product searches
3. **Monitor Performance** - Check response times and cache hit rates
4. **Regenerate API Key** - The current key is exposed in this conversation
   ```bash
   # On your Mac
   openssl rand -hex 32

   # On droplet
   nano ~/retail-scraper-api/.env
   docker restart retail-scraper-api
   ```
5. **Consider Domain + SSL** - Point a domain like `api.quotemate.com` to the IP and add HTTPS

## Production Checklist

- [ ] Fix bot detection issues
- [ ] Regenerate API key (current one is exposed)
- [ ] Set up domain name (optional but recommended)
- [ ] Add SSL certificate with Let's Encrypt
- [ ] Test all endpoints from the app
- [ ] Monitor error rates and response times
- [ ] Set up logging and alerting
- [ ] Consider backup/failover strategy

## Cache Behavior
- Responses are cached for **60 days** to reduce scraping frequency
- Cache is stored in memory (will be lost on restart)
- Consider using Redis for persistent caching

## Rate Limiting
- Currently set to **10 requests per minute** per IP
- Adjust if needed on the droplet

## Support
- Droplet IP: `165.22.151.190`
- API runs on port `80` (Docker container)
- Logs: `docker logs retail-scraper-api`
