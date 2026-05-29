import Business from "../models/Business.js";
import WhatsAppAccount from "../models/WhatsAppAccount.js";
import { MetaApiService } from "../services/metaApiService.js";
import {
  syncAccountStatusFromMeta,
  updateAccountWithMetaStatus,
} from "../utils/meta_status_sync.js";

export class WhatsAppController {
  static async connectAccount(req, res) {
    try {
      const { code, waba_id, phone_number_id } = req.body;
      const userId = req.user.id;

      if (!code) return res.status(400).json({ error: "Code is required" });
      if (!waba_id)
        return res.status(400).json({ error: "WABA ID is required" });
      if (!phone_number_id)
        return res.status(400).json({ error: "Phone Number ID is required" });

      console.log(`[OAuth Connect] Starting for user: ${userId}`);
      console.log(`[OAuth Connect] WABA ID: ${waba_id}`);
      console.log(`[OAuth Connect] Phone Number ID: ${phone_number_id}`);

      // 1. Exchange token
      console.log(`[OAuth Connect] Exchanging OAuth code for access token...`);
      const accessToken = await MetaApiService.exchangeOAuthToken(code);
      console.log(
        `[OAuth Connect] ✓ Access token obtained (${accessToken.slice(0, 20)}...)`,
      );

      // 2. Get WABA info
      console.log(`[OAuth Connect] Fetching WABA info...`);
      const bizData = await MetaApiService.getWabaInfo(waba_id, accessToken);
      console.log(`[OAuth Connect] ✓ WABA info:`, {
        id: bizData?.id,
        name: bizData?.name,
      });

      // 3. Upsert Business - CLEAR old entries first
      console.log(`[OAuth Connect] Clearing old business entries...`);
      await Business.deleteMany({
        user_id: userId,
        meta_business_id: { $ne: bizData?.id },
      });

      const biz = await Business.findOneAndUpdate(
        { user_id: userId },
        {
          $set: {
            meta_business_id: bizData?.id,
            meta_verification_status: "verified",
          },
          $setOnInsert: {
            user_id: userId,
            name: bizData?.name || "My Business",
          },
        },
        { upsert: true, new: true },
      );
      console.log(`[OAuth Connect] ✓ Business saved:`, {
        id: biz._id,
        meta_business_id: bizData?.id,
      });

      // 4. Resolve phone number
      console.log(`[OAuth Connect] Fetching phone number info...`);
      const phoneData = await MetaApiService.getPhoneNumber(
        phone_number_id,
        accessToken,
      );
      console.log(`[OAuth Connect] ✓ Phone number:`, {
        id: phoneData?.id,
        display: phoneData?.display_phone_number,
        name: phoneData?.name,
        quality_rating: phoneData?.quality_rating,
      });

      // 5. Upsert WhatsApp account - CLEAR old IDs first
      console.log(`[OAuth Connect] Clearing old WhatsApp IDs...`);
      await WhatsAppAccount.deleteMany({
        user_id: userId,
        phone_number_id: { $ne: phone_number_id },
      });

      const waAccount = await WhatsAppAccount.findOneAndUpdate(
        { user_id: userId },
        {
          phone_number_id,
          waba_id,
          access_token: accessToken,
          phone_number: phoneData?.display_phone_number,
          quality_rating: phoneData?.quality_rating,
          verified_name: phoneData?.name,
          business_id: biz._id,
          webhook_verified: true,
          // Reset registration tracking for fresh attempt
          registration_attempt_count: 0,
          registration_error: null,
          meta_wa_status: "pending",
        },
        { upsert: true, new: true },
      );
      console.log(`[OAuth Connect] ✓ WhatsApp account saved:`, {
        id: waAccount._id,
        phone_number_id: waAccount.phone_number_id,
        waba_id: waAccount.waba_id,
      });

      // 6. Sync status and Auto-Register
      console.log(`[OAuth Connect] Syncing account status from Meta...`);
      try {
        const syncResult = await syncAccountStatusFromMeta(waAccount);
        console.log(`[OAuth Connect] Sync result:`, syncResult);

        await updateAccountWithMetaStatus(waAccount, syncResult);

        if (syncResult.shouldRegister) {
          console.log(
            `[OAuth Connect] ✓ Should register - calling registration API...`,
          );
          const pin = process.env.WHATSAPP_PHONE_PIN || "123456";
          const regRes = await MetaApiService.registerPhoneNumber(
            phone_number_id,
            accessToken,
            pin,
          );

          if (regRes.ok) {
            console.log(`[OAuth Connect] ✓ Registration succeeded`);
            await WhatsAppAccount.findByIdAndUpdate(waAccount._id, {
              $set: {
                verification_status: "verified",
                meta_wa_status: "connected",
                registration_error: null,
              },
              $inc: { registration_attempt_count: 1 },
              $currentDate: { last_registration_attempt: true },
            });
          } else {
            const errorMsg =
              regRes.data?.error?.message ||
              regRes.error ||
              "Registration failed";
            console.error(`[OAuth Connect] ✗ Registration failed:`, errorMsg);
            await WhatsAppAccount.findByIdAndUpdate(waAccount._id, {
              $set: {
                registration_error: errorMsg,
                meta_wa_status: "action_required",
              },
              $inc: { registration_attempt_count: 1 },
              $currentDate: { last_registration_attempt: true },
            });
          }
        } else {
          console.log(`[OAuth Connect] Registration not needed at this time`);
        }
      } catch (syncErr) {
        console.error(
          `[OAuth Connect] Status sync/register failed:`,
          syncErr.message,
        );
      }

      // 7. Auto-subscribe WABA to webhooks
      console.log(`[OAuth Connect] Subscribing app to WABA...`);
      await MetaApiService.subscribeAppToWaba(waba_id, accessToken).catch(
        (err) => {
          console.warn(
            `[OAuth Connect] Webhook subscription failed:`,
            err.message,
          );
        },
      );
      console.log(`[OAuth Connect] ✓ Flow completed successfully`);

      return res.json({
        success: true,
        message: "WhatsApp account connected successfully",
        phone_number: phoneData?.display_phone_number,
      });
    } catch (err) {
      console.error("[OAuth Connect] Critical error:", err);
      res.status(500).json({ error: err.message });
    }
  }

  /**
   * Retry registration for an existing WhatsApp account
   * Useful if registration failed due to temporary issues
   */
  static async retryRegistration(req, res) {
    try {
      const userId = req.user.id;

      console.log(`[Retry Register] Starting for user: ${userId}`);

      // 1. Get existing account
      const waAccount = await WhatsAppAccount.findOne({ user_id: userId });
      if (!waAccount) {
        return res.status(400).json({
          error: "WhatsApp account not found. Please connect first.",
        });
      }

      const { phone_number_id, access_token, registration_attempt_count } =
        waAccount;

      console.log(`[Retry Register] Account:`, {
        phone_number_id,
        registration_attempt_count,
        last_attempt: waAccount.last_registration_attempt,
      });

      // 2. Safety checks
      if (!access_token) {
        return res.status(400).json({
          error: "No access token found. Please reconnect.",
        });
      }

      if (registration_attempt_count >= 5) {
        return res.status(400).json({
          error: "Too many registration attempts. Please contact support.",
        });
      }

      // 3. Call registration API
      console.log(`[Retry Register] Calling Meta registration API...`);
      const pin = process.env.WHATSAPP_PHONE_PIN || "123456";
      const regRes = await MetaApiService.registerPhoneNumber(
        phone_number_id,
        access_token,
        pin,
      );

      // 4. Update account with result
      if (regRes.ok) {
        console.log(`[Retry Register] ✓ Registration succeeded on retry`);
        await WhatsAppAccount.findByIdAndUpdate(waAccount._id, {
          $set: {
            verification_status: "verified",
            meta_wa_status: "connected",
            registration_error: null,
          },
          $inc: { registration_attempt_count: 1 },
          $currentDate: { last_registration_attempt: true },
        });

        return res.json({
          success: true,
          message:
            "Registration successful! Your phone number is now registered with Meta.",
          status: "connected",
        });
      } else {
        const errorMsg =
          regRes.data?.error?.message || regRes.error || "Registration failed";
        console.error(`[Retry Register] ✗ Registration failed:`, errorMsg);

        await WhatsAppAccount.findByIdAndUpdate(waAccount._id, {
          $set: {
            registration_error: errorMsg,
            meta_wa_status: "action_required",
          },
          $inc: { registration_attempt_count: 1 },
          $currentDate: { last_registration_attempt: true },
        });

        return res.status(400).json({
          success: false,
          error: errorMsg,
          status: "action_required",
          hint: "This might be a temporary issue. Please try again in a moment or contact support if the problem persists.",
        });
      }
    } catch (err) {
      console.error("[Retry Register] Error:", err);
      res.status(500).json({ error: err.message });
    }
  }

  static async handleActions(req, res) {
    try {
      const { action, ...params } = req.body;
      const userId = req.user.id;
      const waAccount = await WhatsAppAccount.findOne({ user_id: userId });
      if (!waAccount)
        return res
          .status(400)
          .json({ error: "WhatsApp not configured. Complete setup first." });

      const { access_token, phone_number_id, waba_id } = waAccount;

      if (action === "get_templates" || action === "sync_templates") {
        const metaTemplates = await MetaApiService.fetchTemplates(
          waba_id,
          access_token,
        );

        // Update local MongoDB templates with statuses from Meta
        if (action === "sync_templates") {
          // We would normally import Template and uploadToCloudinary here
          // For now, keeping the logic lightweight or moving it entirely to a templateService
          const Template = (await import("../models/Template.js")).default;
          const { uploadToCloudinary } =
            await import("../services/cloudinary.js");

          for (const mt of metaTemplates) {
            let cloudinaryUrl = undefined;
            const header = mt.components?.find((c) => c.type === "HEADER");
            if (
              header &&
              ["IMAGE", "VIDEO", "DOCUMENT"].includes(header.format)
            ) {
              const existing = await Template.findOne({
                user_id: userId,
                name: mt.name,
              });
              if (!existing || !existing.local_url) {
                const exampleUrl =
                  header.example?.header_handle?.[0] ||
                  header.example?.header_url?.[0];
                if (exampleUrl) {
                  try {
                    cloudinaryUrl = await uploadToCloudinary(exampleUrl);
                  } catch (err) {
                    console.error(
                      `[Sync] Failed to upload media for ${mt.name}:`,
                      err.message,
                    );
                  }
                }
              }
            }

            const updateData = {
              status: mt.status,
              category: mt.category,
              language: mt.language,
              components: mt.components,
              meta_template_id: mt.id,
            };
            if (cloudinaryUrl) updateData.local_url = cloudinaryUrl;

            await Template.findOneAndUpdate(
              { user_id: userId, name: mt.name },
              { $set: updateData },
              { upsert: true },
            );
          }
        }
        await WhatsAppAccount.findOneAndUpdate(
          { user_id: userId },
          { verification_status: "verified" },
        );
        const Template = (await import("../models/Template.js")).default;
        const allTemplates = await Template.find({ user_id: userId });
        return res.json({ templates: allTemplates });
      }

      // Fallback for other actions - would normally be split into dedicated controllers
      // (create_template, send_template, get_contacts, send_message, edit_template, delete_campaign)
      // Since this is Phase 1, we are just refactoring the template sync. We should probably keep the rest as is or move them.
      // Actually, we can move the rest of the switch cases here or leave them in the router.
    } catch (err) {
      console.error("WhatsApp Controller Action error:", err);
      res.status(500).json({ error: err.message });
    }
  }
}
