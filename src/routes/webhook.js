import { Router } from "express";
import { WebhookController } from "../controllers/webhookController.js";

const router = Router();

// ── GET: Verification ────────────────────────────────────────────────────────
router.get("/", WebhookController.verify);

// ── POST: Inbound events ─────────────────────────────────────────────────────
// router.post('/', WebhookController.handleWebhook);

// ── POST: Inbound events ────────────────────────────────────

router.post(
  "/",
  (req, res, next) => {
    console.log("[WEBHOOK RECEIVED]", JSON.stringify(req.body, null, 2));

    next();
  },
  WebhookController.handleWebhook,
);

export default router;
