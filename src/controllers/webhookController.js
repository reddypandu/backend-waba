import crypto from 'crypto';
import fs from 'fs';
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
    res.sendStatus(200);

    try {
      const body = req.body;
      const rawBody = req.rawBody || JSON.stringify(body);
      
      const sig = req.headers['x-hub-signature-256'];
      try {
        fs.appendFileSync('webhook_debug.log', JSON.stringify({ time: new Date(), body: req.body, sig }) + '\n');
      } catch (err) {
        console.error('Failed to log webhook:', err);
      }
      
      console.log("[Webhook] Incoming payload:\n", JSON.stringify(body, null, 2));

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
