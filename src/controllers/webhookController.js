import crypto from 'crypto';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import { WebhookService } from '../services/webhookService.js';

export class WebhookController {
  
  static async verify(req, res) {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
    if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
      await WhatsAppAccount.updateMany({}, { webhook_verified: true }).catch(() => {});
      return res.send(challenge);
    }
    res.status(403).send('Forbidden');
  }

  static async handleWebhook(req, res) {
    // Acknowledge receipt immediately to avoid Meta retries
    res.json({ success: true });

    try {
      const body = req.body;
      const rawBody = req.rawBody || JSON.stringify(body);
      const sig = req.headers['x-hub-signature-256'];

      if (process.env.META_APP_SECRET && sig) {
        const expected = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex');
        if (expected !== sig) {
          console.warn('[Webhook] Signature mismatch! Expected:', expected, 'Received:', sig);
          return;
        }
      }

      // Process in background
      WebhookService.processWebhookEvent(body).catch(err => {
        console.error('[Webhook] Async processing error:', err.message);
      });

    } catch (err) {
      console.error('Webhook Controller error:', err.message);
    }
  }

}
