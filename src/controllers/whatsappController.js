import Business from "../models/Business.js";
import WhatsAppAccount from "../models/WhatsAppAccount.js";
import { MetaApiService } from "../services/metaApiService.js";
import {
  attemptRegistrationIfNeeded,
  getDashboardStatus,
} from "../utils/meta_status_sync.js";

export class WhatsAppController {
  static async connectAccount(req, res) {
    try {
      const { code, business_id, waba_id, phone_number_id } = req.body;
      const userId = req.user.id;

      if (!code) return res.status(400).json({ error: "Code is required" });

      console.log("[OAuth Connect] Starting", {
        user_id: userId,
        hinted_business_id: business_id || null,
        hinted_waba_id: waba_id || null,
        hinted_phone_number_id: phone_number_id || null,
      });

      const accessToken = await MetaApiService.exchangeOAuthToken(code);
      console.log("[OAuth Connect] Access token obtained", {
        token_preview: `${accessToken.slice(0, 20)}...`,
      });

      const assets = await MetaApiService.discoverSignupAssets(accessToken, {
        business_id,
        waba_id,
        phone_number_id,
      });

      const resolvedBusiness = assets.business;
      const resolvedWaba = assets.waba;
      const resolvedPhone = assets.phoneNumber;
      const resolvedBusinessId = resolvedBusiness?.id || resolvedWaba?.business?.id;
      const resolvedWabaId = resolvedWaba?.id || waba_id;
      const resolvedPhoneNumberId = resolvedPhone?.id || phone_number_id;

      if (!resolvedWabaId || !resolvedPhoneNumberId) {
        console.error("[OAuth Connect] Could not resolve required Meta IDs", {
          business_id: resolvedBusinessId || null,
          waba_id: resolvedWabaId || null,
          phone_number_id: resolvedPhoneNumberId || null,
        });
        return res.status(400).json({
          error:
            "Could not resolve fresh WABA ID and Phone Number ID from Meta. Please complete Embedded Signup again.",
        });
      }

      console.log("[OAuth Connect] Resolved Meta IDs", {
        business_id: resolvedBusinessId || null,
        waba_id: resolvedWabaId,
        phone_number_id: resolvedPhoneNumberId,
      });

      const tokenInfo = await MetaApiService.verifyToken(accessToken);
      const requiredScopes = ["whatsapp_business_management", "whatsapp_business_messaging", "business_management"];
      const hasScopes = requiredScopes.every(scope => tokenInfo.scopes.includes(scope));
      console.log("[OAuth Connect] Token Verification", {
        is_valid: tokenInfo.valid,
        has_required_scopes: hasScopes,
        scopes: tokenInfo.scopes,
        belongs_to_business: !!resolvedBusinessId
      });


      const phoneData =
        resolvedPhone ||
        (await MetaApiService.getPhoneNumber(resolvedPhoneNumberId, accessToken));

      const biz = await Business.findOneAndUpdate(
        { user_id: userId },
        {
          $set: {
            meta_business_id: resolvedBusinessId,
            meta_verification_status: "verified",
            name:
              resolvedBusiness?.name ||
              resolvedWaba?.business?.name ||
              resolvedWaba?.name ||
              "My Business",
          },
          $setOnInsert: { user_id: userId },
        },
        { upsert: true, new: true },
      );

      const existing = await WhatsAppAccount.findOne({ user_id: userId });
      const samePhone = existing?.phone_number_id === resolvedPhoneNumberId;

      const waAccount = await WhatsAppAccount.findOneAndUpdate(
        { user_id: userId },
        {
          $set: {
            phone_number_id: resolvedPhoneNumberId,
            waba_id: resolvedWabaId,
            access_token: accessToken,
            phone_number: phoneData?.display_phone_number,
            quality_rating: phoneData?.quality_rating,
            verified_name: phoneData?.verified_name || phoneData?.name,
            business_id: biz._id,
            webhook_verified: true,
            registration_error: null,
            meta_error_message: null,
            meta_wa_status: samePhone ? existing?.meta_wa_status || "pending" : "pending",
            registration_attempt_count: samePhone
              ? existing?.registration_attempt_count || 0
              : 0,
            was_messaging: samePhone ? existing?.was_messaging || false : false,
          },
          $setOnInsert: {
            user_id: userId,
          },
        },
        { upsert: true, new: true },
      );

      console.log("[OAuth Connect] WhatsApp account saved", {
        id: waAccount._id,
        business_id: biz.meta_business_id || null,
        waba_id: waAccount.waba_id,
        phone_number_id: waAccount.phone_number_id,
      });

      const registrationResult = await attemptRegistrationIfNeeded(waAccount, { force: true });
      console.log("[OAuth Connect] Registration evaluation result", {
        status: registrationResult.status,
        attempted: registrationResult.attempted,
        success: registrationResult.success,
        dashboard_status: registrationResult.dashboard_status,
        error: registrationResult.error || null,
      });

      await MetaApiService.subscribeAppToWaba(resolvedWabaId, accessToken).catch(
        (err) => {
          console.warn("[OAuth Connect] Webhook subscription failed:", err.message);
        },
      );

      const finalAccount =
        registrationResult.account || (await WhatsAppAccount.findById(waAccount._id));

      return res.json({
        success: true,
        message: "WhatsApp account connected successfully",
        business_id: resolvedBusinessId || null,
        waba_id: resolvedWabaId,
        phone_number_id: resolvedPhoneNumberId,
        phone_number: finalAccount?.phone_number || phoneData?.display_phone_number,
        registration_status: registrationResult.status,
        dashboard_status: getDashboardStatus(finalAccount),
      });
    } catch (err) {
      console.error("[OAuth Connect] Critical error:", err);
      res.status(500).json({ error: err.message });
    }
  }

  static async retryRegistration(req, res) {
    try {
      const userId = req.user.id;
      const accountId = req.params.id;
      const filter = { user_id: userId };
      if (accountId) filter._id = accountId;

      console.log("[Retry Register] Starting", {
        user_id: userId,
        account_id: accountId || null,
      });

      const waAccount = await WhatsAppAccount.findOne(filter);
      if (!waAccount) {
        return res.status(404).json({
          error: "WhatsApp account not found. Please connect first.",
        });
      }

      console.log("[Retry Register] Account", {
        business_id: waAccount.business_id,
        waba_id: waAccount.waba_id,
        phone_number_id: waAccount.phone_number_id,
        registration_attempt_count: waAccount.registration_attempt_count,
        last_attempt: waAccount.last_registration_attempt,
      });

      if (!waAccount.access_token) {
        return res.status(400).json({
          error: "No access token found. Please reconnect.",
          status: "action_required",
        });
      }

      const result = await attemptRegistrationIfNeeded(waAccount);
      const statusCode = result.success || !result.attempted ? 200 : 400;

      return res.status(statusCode).json({
        success: result.success,
        attempted: result.attempted,
        status: result.status,
        dashboard_status: result.dashboard_status,
        message: result.message,
        error: result.error,
        timeout: result.timeout || false,
        meta_response: result.meta_response,
      });
    } catch (err) {
      console.error("[Retry Register] Error:", err);
      res.status(500).json({ error: err.message });
    }
  }

  static async handleActions(req, res) {
    try {
      const { action } = req.body;
      const userId = req.user.id;
      const waAccount = await WhatsAppAccount.findOne({ user_id: userId });
      if (!waAccount) {
        return res
          .status(400)
          .json({ error: "WhatsApp not configured. Complete setup first." });
      }

      const { access_token, waba_id } = waAccount;

      if (action === "get_templates" || action === "sync_templates") {
        const metaTemplates = await MetaApiService.fetchTemplates(
          waba_id,
          access_token,
        );

        if (action === "sync_templates") {
          const Template = (await import("../models/Template.js")).default;
          const { uploadToCloudinary } = await import("../services/cloudinary.js");

          for (const mt of metaTemplates) {
            let cloudinaryUrl = undefined;
            const header = mt.components?.find((c) => c.type === "HEADER");
            if (header && ["IMAGE", "VIDEO", "DOCUMENT"].includes(header.format)) {
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

      return res.status(400).json({ error: "Unknown controller action" });
    } catch (err) {
      console.error("WhatsApp Controller Action error:", err);
      res.status(500).json({ error: err.message });
    }
  }
}
