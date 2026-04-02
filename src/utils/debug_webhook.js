import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const API_URL = 'http://127.0.0.1:5005/api/webhook'; // Adjust port if needed
const APP_SECRET = process.env.META_APP_SECRET;

const simulateWebhook = async () => {
  const payload = {
    "object": "whatsapp_business_account",
    "entry": [
      {
        "id": "644997078241389", // WABA ID
        "changes": [
          {
            "value": {
              "messaging_product": "whatsapp",
              "metadata": {
                "display_phone_number": "918328099781",
                "phone_number_id": "643426635515729"
              },
              "contacts": [
                {
                  "profile": { "name": "Test User" },
                  "wa_id": "919000000000"
                }
              ],
              "messages": [
                {
                  "from": "919000000000",
                  "id": "wamid.HBgLOTE5MDAwMDAwMDAwFQIAERgSRDM3M0REODVDNzRCOEI0RTkyNQA=" + Date.now(),
                  "timestamp": Math.floor(Date.now() / 1000).toString(),
                  "text": { "body": "Hello, this is a test message!" },
                  "type": "text"
                }
              ]
            },
            "field": "messages"
          }
        ]
      }
    ]
  };

  const body = JSON.stringify(payload);
  const headers = { 'Content-Type': 'application/json' };

  if (APP_SECRET) {
    const signature = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
    headers['x-hub-signature-256'] = signature;
  }

  try {
    console.log('Sending simulated webhook to:', API_URL);
    const response = await fetch(API_URL, {
        method: 'POST',
        headers,
        body
    });
    console.log('Response Status:', response.status);
    const data = await response.json();
    console.log('Response Data:', data);
  } catch (error) {
    console.error('Error sending webhook:', error.message);
  }
};

simulateWebhook();
