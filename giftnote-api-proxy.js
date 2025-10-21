/**
 * Giftnote API Proxy Server
 * 
 * This is a server-side proxy to handle Giftnote API calls securely.
 * Keeps API credentials on the server and handles OAuth token management.
 * 
 * Deploy this as a Shopify App Proxy or standalone service.
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Giftnote API Configuration
const GIFTNOTE_CONFIG = {
  clientId: process.env.GIFTNOTE_CLIENT_ID || 'ballerina-farm',
  apiToken: process.env.GIFTNOTE_API_TOKEN || 'your-api-token-here',
  baseUrl: 'https://api.giftnote.com',
  quotaLimit: 10,
  quotaRefreshInterval: 3600000 // 1 hour in milliseconds
};

// Token cache
let accessToken = null;
let tokenExpiry = null;
let quotaUsed = 0;
let quotaResetTime = null;

/**
 * Get OAuth access token from Giftnote
 */
async function getAccessToken() {
  // Return cached token if still valid
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  try {
    console.log('🔄 Getting new access token from Giftnote...');
    
    const credentials = Buffer.from(`${GIFTNOTE_CONFIG.clientId}:${GIFTNOTE_CONFIG.apiToken}`).toString('base64');
    
    const response = await fetch(`${GIFTNOTE_CONFIG.baseUrl}/auth/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      throw new Error(`OAuth failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // 1 minute buffer
    
    console.log('✅ New access token obtained');
    return accessToken;

  } catch (error) {
    console.error('❌ Failed to get access token:', error);
    throw error;
  }
}

/**
 * Check if we're within quota limits
 */
function checkQuota() {
  // Reset quota if it's been more than an hour
  if (quotaResetTime && Date.now() > quotaResetTime) {
    quotaUsed = 0;
    quotaResetTime = Date.now() + GIFTNOTE_CONFIG.quotaRefreshInterval;
    console.log('🔄 Quota reset');
  }

  // Initialize quota reset time if not set
  if (!quotaResetTime) {
    quotaResetTime = Date.now() + GIFTNOTE_CONFIG.quotaRefreshInterval;
  }

  if (quotaUsed >= GIFTNOTE_CONFIG.quotaLimit) {
    throw new Error('Quota exceeded. Please try again later.');
  }
}

/**
 * Send gift message via Giftnote API
 */
async function sendGiftMessage(message, recipient, productInfo) {
  try {
    // Check quota
    checkQuota();

    // Get access token
    const token = await getAccessToken();

    // Prepare the gift message payload
    const payload = {
      message: message,
      recipient: {
        email: recipient.email,
        phone: recipient.phone
      },
      product: {
        id: productInfo.product_id,
        variant_id: productInfo.variant_id
      },
      delivery_methods: ['email', 'sms'] // Giftnote sends both together
    };

    console.log('📤 Sending gift message via Giftnote API...', {
      message: message.substring(0, 50) + '...',
      recipient_email: recipient.email,
      recipient_phone: recipient.phone ? 'provided' : 'not provided'
    });

    const response = await fetch(`${GIFTNOTE_CONFIG.baseUrl}/gifts/v0/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    // Increment quota usage
    quotaUsed++;

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Quota exceeded. Please try again later.');
      }
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    console.log('✅ Gift message sent successfully');
    return {
      success: true,
      message_id: result.message_id || 'unknown',
      quota_remaining: GIFTNOTE_CONFIG.quotaLimit - quotaUsed
    };

  } catch (error) {
    console.error('❌ Failed to send gift message:', error);
    throw error;
  }
}

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    quota_used: quotaUsed,
    quota_limit: GIFTNOTE_CONFIG.quotaLimit,
    quota_reset_in: quotaResetTime ? quotaResetTime - Date.now() : 'unknown',
    token_valid: accessToken && tokenExpiry && Date.now() < tokenExpiry
  });
});

/**
 * Send gift message endpoint
 */
app.post('/send', async (req, res) => {
  try {
    const { message, delivery, recipient, product_id, variant_id } = req.body;

    // Validate required fields
    if (!message || !recipient || !product_id) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: message, recipient, product_id'
      });
    }

    if (delivery === 'email_sms' && (!recipient.email || !recipient.phone)) {
      return res.status(400).json({
        success: false,
        error: 'Email and phone are required for digital delivery'
      });
    }

    // Send the gift message
    const result = await sendGiftMessage(message, recipient, {
      product_id,
      variant_id
    });

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('❌ Send endpoint error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check delivery status endpoint
 */
app.get('/status/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const token = await getAccessToken();

    const response = await fetch(`${GIFTNOTE_CONFIG.baseUrl}/gifts/v0/status/${messageId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Status check failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    
    res.json({
      success: true,
      status: result.status,
      delivered_at: result.delivered_at
    });

  } catch (error) {
    console.error('❌ Status check error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Giftnote API Proxy running on port ${PORT}`);
  console.log(`📊 Quota limit: ${GIFTNOTE_CONFIG.quotaLimit} requests/hour`);
  console.log(`🔑 Client ID: ${GIFTNOTE_CONFIG.clientId}`);
});

module.exports = app;
