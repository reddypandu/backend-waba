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

router.post("/", requireAuth, async (req, res) => {
  try {
    const { action, ...params } = req.body;
    const userId = req.user.id;

    switch (action) {
      case "get_app_id":
        return res.json({ app_id: APP_ID });

      case "exchange_token": {
        const { code, waba_id, phone_number_id } = params;
        if (!code) return res.status(400).json({ error: "Code is required" });

        // 1. Exchange code for short-lived token
        const tokenRes = await fetch(
          `${META_API}/oauth/access_token?client_id=${APP_ID}&client_secret=${APP_SECRET}&code=${code}`,
        );
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok)
          throw new Error(
            `Token exchange failed: ${JSON.stringify(tokenData)}`,
          );

        // 2. Exchange for long-lived token
        const llRes = await fetch(
          `${META_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`,
        );
        const llData = await llRes.json();
        if (!llRes.ok)
          throw new Error(`Long-lived token failed: ${JSON.stringify(llData)}`);
        const accessToken = llData.access_token;

        // 3. Get WABA info
        let metaBusinessId = null;
        try {
          const bizRes = await fetch(`${META_API}/${waba_id}?fields=id,name`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const bizData = await bizRes.json();
          metaBusinessId = bizData?.id;
        } catch (_) {}

        // 4. Upsert business
        const biz = await Business.findOneAndUpdate(
          { user_id: userId },
          {
            $set: {
              meta_business_id: metaBusinessId,
              meta_verification_status: "verified",
            },
            $setOnInsert: { user_id: userId, name: "My Business" },
          },
          { upsert: true, new: true },
        );

        // 5. Resolve phone number
        let phoneNumber = null;
        if (phone_number_id) {
          try {
            const pRes = await fetch(
              `${META_API}/${phone_number_id}?fields=display_phone_number`,
              { headers: { Authorization: `Bearer ${accessToken}` } },
            );
            const pData = await pRes.json();
            phoneNumber = pData?.display_phone_number;
          } catch (_) {}
        }

        // 6. Upsert WhatsApp account
        const waAccount = await WhatsAppAccount.findOneAndUpdate(
          { user_id: userId },
          {
            phone_number_id,
            waba_id,
            access_token: accessToken,
            phone_number: phoneNumber,
            business_id: biz._id,
            webhook_verified: true,
          },
          { upsert: true, new: true },
        );

        // 7. SAFE: Sync actual Meta status (NEW - identifies test numbers, messaging activity, etc.)
        try {
          const syncResult = await syncAccountStatusFromMeta(waAccount);
          await updateAccountWithMetaStatus(waAccount, syncResult);
          console.log(
            `[OAuth Register] Account ${phone_number_id} status synced: ${syncResult.metaStatus}, IsTest: ${syncResult.isTestNumber}`,
          );
        } catch (syncErr) {
          console.warn(
            `[OAuth Register] Status sync failed (non-fatal):`,
            syncErr.message,
          );
          // Don't fail registration if sync fails - account is still connected
        }

        // 8. Auto-subscribe WABA to webhooks
        try {
          await fetch(`${META_API}/${waba_id}/subscribed_apps`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        } catch (_) {}

        return res.json({
          success: true,
          message: "WhatsApp account connected successfully",
          phone_number: phoneNumber,
          note: "Status sync complete. Check dashboard for actual Meta status.",
        });
      }

      default:
        return res.status(400).json({ error: "Unknown action" });
    }
  } catch (err) {
    console.error("OTP error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
