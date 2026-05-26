import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import Business from "../models/Business.js";
import WhatsAppAccount from "../models/WhatsAppAccount.js";
import {
  syncAccountStatusFromMeta,
  updateAccountWithMetaStatus,
} from "../utils/meta_status_sync.js";

const router = Router();
const META_API = "https://graph.facebook.com/v24.0";
const APP_ID = process.env.META_APP_ID;
const APP_SECRET = process.env.META_APP_SECRET;

import { WhatsAppController } from "../controllers/whatsappController.js";

router.post("/", requireAuth, async (req, res) => {
  try {
    const { action, ...params } = req.body;
    const userId = req.user.id;

    switch (action) {
      case "get_app_id":
        return res.json({ app_id: APP_ID });

      case "exchange_token":
        // Fallback or map the params to body for controller
        req.body = params;
        return await WhatsAppController.connectAccount(req, res);

      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (err) {
    console.error("OTP error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
