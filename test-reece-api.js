/**
 * Test script for Reece API endpoints
 * Tests authentication and basic product search
 */

// Test credentials from .env
const TEST_CONFIG = {
  clientId: '3s1ok8cc65b1jj2575u7a685fd',
  clientSecret: 'ldqnu1lbteknqnsr1b3d4j9h36qu9ucs64q152t22ske39epfvl',
  customerNumber: '3204941',
  region: 'au',
  authBaseUrl: 'https://auth.api.test.reecegroup.com.au',
  apiBaseUrl: 'https://api.test.reecegroup.com.au',
};

// Base64 encode function (Node.js compatible)
function base64Encode(str) {
  return Buffer.from(str).toString('base64');
}

// Test 1: OAuth2 Authentication
async function testAuthentication() {
  console.log('\n========================================');
  console.log('TEST 1: OAuth2 Authentication');
  console.log('========================================');

  try {
    const credentials = base64Encode(
      `${TEST_CONFIG.clientId}:${TEST_CONFIG.clientSecret}`
    );

    console.log('📡 Requesting access token from:', TEST_CONFIG.authBaseUrl);
    console.log('   Client ID:', TEST_CONFIG.clientId);

    const response = await fetch(`${TEST_CONFIG.authBaseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'Default/read Default/write',
      }).toString(),
    });

    console.log('📥 Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Authentication failed!');
      console.error('   Error:', errorText);
      return null;
    }

    const data = await response.json();
    console.log('✅ Authentication successful!');
    console.log('   Access token:', data.access_token.substring(0, 20) + '...');
    console.log('   Expires in:', data.expires_in, 'seconds');
    console.log('   Token type:', data.token_type);

    return data.access_token;
  } catch (error) {
    console.error('❌ Authentication error:', error.message);
    return null;
  }
}

// Test 2: Onboarding - Get Request Token
async function testOnboardingRequestToken(accessToken) {
  console.log('\n========================================');
  console.log('TEST 2: Onboarding - Get Request Token');
  console.log('========================================');

  try {
    console.log('📡 Requesting onboarding token...');

    const response = await fetch(
      `${TEST_CONFIG.apiBaseUrl}/${TEST_CONFIG.region}/customer-application-onboarding-gateway/request-token`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('📥 Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Request token failed!');
      console.error('   Error:', errorText);
      return null;
    }

    const data = await response.json();
    console.log('✅ Request token received!');
    console.log('   Request token:', data.requestToken);

    return data.requestToken;
  } catch (error) {
    console.error('❌ Request token error:', error.message);
    console.error('   Full error:', error);
    return null;
  }
}

// Test 3: Product Search
async function testProductSearch(accessToken) {
  console.log('\n========================================');
  console.log('TEST 3: Product Search');
  console.log('========================================');

  const searchQueries = [
    'copper pipe',
    'pvc pipe',
    'valve',
  ];

  for (const query of searchQueries) {
    try {
      console.log(`\n🔍 Searching for: "${query}"`);

      const queryParams = new URLSearchParams({
        searchPhrase: query,
        pageNumber: '1',
        pageSize: '5',
      });

      const url = `${TEST_CONFIG.apiBaseUrl}/${TEST_CONFIG.region}/product-gateway/search?${queryParams.toString()}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-reecegroup-customerNumber': TEST_CONFIG.customerNumber,
        },
      });

      console.log('📥 Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Search failed for "${query}"`);
        console.error('   Error:', errorText);
        continue;
      }

      const data = await response.json();
      console.log(`✅ Search successful! Found ${data.totalResults} results`);

      if (data.products && data.products.length > 0) {
        console.log(`   Showing first ${Math.min(3, data.products.length)} products:`);
        data.products.slice(0, 3).forEach((product, index) => {
          console.log(`   ${index + 1}. ${product.productTitle} (ID: ${product.productId})`);
        });
      } else {
        console.log('   No products found');
      }

    } catch (error) {
      console.error(`❌ Search error for "${query}":`, error.message);
      console.error('   Error code:', error.code);
      console.error('   Error cause:', error.cause);
    }
  }
}

// Test 4: Quote Headers
async function testQuoteHeaders(accessToken) {
  console.log('\n========================================');
  console.log('TEST 4: Quote Headers');
  console.log('========================================');

  try {
    console.log('📡 Fetching quote headers...');

    const response = await fetch(
      `${TEST_CONFIG.apiBaseUrl}/${TEST_CONFIG.region}/quote-gateway/quote-headers`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-reecegroup-customerNumber': TEST_CONFIG.customerNumber,
        },
      }
    );

    console.log('📥 Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Quote headers failed!');
      console.error('   Error:', errorText);
      return;
    }

    const data = await response.json();
    console.log(`✅ Quote headers received! Found ${data.length} quotes`);

    if (data.length > 0) {
      console.log(`   Showing first ${Math.min(3, data.length)} quotes:`);
      data.slice(0, 3).forEach((quote, index) => {
        console.log(`   ${index + 1}. Quote #${quote.quoteNumber} - ${quote.description || 'No description'}`);
      });
    }

  } catch (error) {
    console.error('❌ Quote headers error:', error.message);
  }
}

// Main test runner
async function runTests() {
  console.log('\n');
  console.log('╔════════════════════════════════════════╗');
  console.log('║     REECE API TEST SUITE              ║');
  console.log('╔════════════════════════════════════════╗');
  console.log('');
  console.log('Testing with:');
  console.log('  Auth URL:', TEST_CONFIG.authBaseUrl);
  console.log('  API URL:', TEST_CONFIG.apiBaseUrl);
  console.log('  Region:', TEST_CONFIG.region);
  console.log('  Customer:', TEST_CONFIG.customerNumber);

  // Test 1: Authentication
  const accessToken = await testAuthentication();

  if (!accessToken) {
    console.log('\n❌ Cannot continue tests without valid access token');
    process.exit(1);
  }

  // Test 2: Onboarding Request Token
  await testOnboardingRequestToken(accessToken);

  // Test 3: Product Search
  await testProductSearch(accessToken);

  // Test 4: Quote Headers
  await testQuoteHeaders(accessToken);

  console.log('\n========================================');
  console.log('TEST SUITE COMPLETE');
  console.log('========================================\n');
}

// Run the tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
