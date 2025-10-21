# Giftnote API Proxy

Server-side proxy for secure Giftnote API integration with Shopify.

## Features

- Secure OAuth token management
- Quota tracking (10 requests/hour)
- Health monitoring endpoint
- Error handling and logging
- CORS configuration for Shopify

## Environment Variables

Set these in your deployment platform:

```
GIFTNOTE_CLIENT_ID=ballerina-farm
GIFTNOTE_API_TOKEN=your-actual-api-token
PORT=3000
```

## Endpoints

- `GET /health` - Health check and quota status
- `POST /send` - Send gift message via Giftnote API
- `GET /status/:messageId` - Check delivery status

## Deployment

This app can be deployed to:
- Railway
- Heroku
- Vercel
- DigitalOcean App Platform
- Any Node.js hosting service

## Usage

The widget will call `/send` endpoint with:
```json
{
  "message": "Happy Birthday!",
  "delivery": "email_sms",
  "recipient": {
    "email": "test@example.com",
    "phone": "+1234567890"
  },
  "product_id": "123456789",
  "variant_id": "987654321"
}
```
