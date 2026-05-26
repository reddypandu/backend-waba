import Business from "../models/Business.js";
import WhatsAppAccount from "../models/WhatsAppAccount.js";
import { MetaApiService } from "../services/metaApiService.js";
import { syncAccountStatusFromMeta, updateAccountWithMetaStatus } from "../utils/meta_status_sync.js";

export class WhatsAppController {
  
  static async connectAccount(req, res) {
    try {
      const { code, waba_id, phone_number_id } = req.body;
      const userId = req.user.id;

      if (!code) return res.status(400).json({ error: "Code is required" });

      // 1. Exchange token
      const accessToken = await MetaApiService.exchangeOAuthToken(code);

      // 2. Get WABA info
      const bizData = await MetaApiService.getWabaInfo(waba_id, accessToken);
      
      // 3. Upsert Business
      const biz = await Business.findOneAndUpdate(
        { user_id: userId },
        {
          $set: {
            meta_business_id: bizData?.id,
            meta_verification_status: "verified",
          },
          $setOnInsert: { user_id: userId, name: bizData?.name || "My Business" },
        },
        { upsert: true, new: true }
      );

      // 4. Resolve phone number
      const phoneData = await MetaApiService.getPhoneNumber(phone_number_id, accessToken);

      // 5. Upsert WhatsApp account
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
        },
        { upsert: true, new: true }
      );

      // 6. Sync status and Auto-Register
      try {
        const syncResult = await syncAccountStatusFromMeta(waAccount);
        await updateAccountWithMetaStatus(waAccount, syncResult);

        if (syncResult.shouldRegister) {
          const pin = process.env.WHATSAPP_PHONE_PIN || "123456";
          const regRes = await MetaApiService.registerPhoneNumber(phone_number_id, accessToken, pin);
          
          if (regRes.ok) {
            await WhatsAppAccount.findByIdAndUpdate(waAccount._id, {
              $set: {
                verification_status: "verified",
                meta_wa_status: "connected",
                registration_error: null,
              },
              $inc: { registration_attempt_count: 1 },
              $currentDate: { last_registration_attempt: true }
            });
          } else {
            await WhatsAppAccount.findByIdAndUpdate(waAccount._id, {
              $set: { registration_error: regRes.data?.error?.message || "Registration failed" },
              $inc: { registration_attempt_count: 1 },
              $currentDate: { last_registration_attempt: true }
            });
          }
        }
      } catch (syncErr) {
        console.warn(`[OAuth Register] Status sync failed:`, syncErr.message);
      }

      // 7. Auto-subscribe WABA to webhooks
      await MetaApiService.subscribeAppToWaba(waba_id, accessToken).catch(() => {});

      return res.json({
        success: true,
        message: "WhatsApp account connected successfully",
        phone_number: phoneData?.display_phone_number,
      });

    } catch (err) {
      console.error("connectAccount error:", err);
      res.status(500).json({ error: err.message });
    }
  }

  static async handleActions(req, res) {
    try {
      const { action, ...params } = req.body;
      const userId = req.user.id;
      const waAccount = await WhatsAppAccount.findOne({ user_id: userId });
      if (!waAccount) return res.status(400).json({ error: 'WhatsApp not configured. Complete setup first.' });

      const { access_token, phone_number_id, waba_id } = waAccount;

      if (action === 'get_templates' || action === 'sync_templates') {
        const metaTemplates = await MetaApiService.fetchTemplates(waba_id, access_token);
        
        // Update local MongoDB templates with statuses from Meta
        if (action === 'sync_templates') {
          // We would normally import Template and uploadToCloudinary here
          // For now, keeping the logic lightweight or moving it entirely to a templateService
          const Template = (await import('../models/Template.js')).default;
          const { uploadToCloudinary } = await import('../services/cloudinary.js');

          for (const mt of metaTemplates) {
            let cloudinaryUrl = undefined;
            const header = mt.components?.find(c => c.type === 'HEADER');
            if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format)) {
               const existing = await Template.findOne({ user_id: userId, name: mt.name });
               if (!existing || !existing.local_url) {
                  const exampleUrl = header.example?.header_handle?.[0] || header.example?.header_url?.[0];
                  if (exampleUrl) {
                     try {
                       cloudinaryUrl = await uploadToCloudinary(exampleUrl);
                     } catch(err) {
                       console.error(`[Sync] Failed to upload media for ${mt.name}:`, err.message);
                     }
                  }
               }
            }
            
            const updateData = {
                  status: mt.status, 
                  category: mt.category, 
                  language: mt.language,
                  components: mt.components,
                  meta_template_id: mt.id 
            };
            if (cloudinaryUrl) updateData.local_url = cloudinaryUrl;

            await Template.findOneAndUpdate(
              { user_id: userId, name: mt.name },
              { $set: updateData },
              { upsert: true }
            );
          }
        }
        await WhatsAppAccount.findOneAndUpdate({ user_id: userId }, { verification_status: 'verified' });
        const Template = (await import('../models/Template.js')).default;
        const allTemplates = await Template.find({ user_id: userId });
        return res.json({ templates: allTemplates });
      }

      // Fallback for other actions - would normally be split into dedicated controllers
      // (create_template, send_template, get_contacts, send_message, edit_template, delete_campaign)
      // Since this is Phase 1, we are just refactoring the template sync. We should probably keep the rest as is or move them.
      // Actually, we can move the rest of the switch cases here or leave them in the router.
      
    } catch (err) {
      console.error('WhatsApp Controller Action error:', err);
      res.status(500).json({ error: err.message });
    }
  }

}
