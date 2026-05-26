import { Router } from 'express';
import { WebhookController } from '../controllers/webhookController.js';

const router = Router();

// ── GET: Verification ────────────────────────────────────────────────────────
router.get('/', WebhookController.verify);

// ── POST: Inbound events ─────────────────────────────────────────────────────
router.post('/', WebhookController.handleWebhook);

export default router;
