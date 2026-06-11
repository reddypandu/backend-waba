import Campaign from "../models/Campaign.js";
import Contact from "../models/Contact.js";
import WhatsAppAccount from "../models/WhatsAppAccount.js";
import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";
import Template from "../models/Template.js";
import { normalizePhone } from "./phoneUtils.js";

const findTemplateComponent = (components = [], type) =>
  components.find((component) => component.type?.toUpperCase() === type);

const replaceTemplateParams = (text = "", parameters = []) =>
  text.replace(/\{\{(\d+)\}\}/g, (_match, index) => {
    const value = parameters[Number(index) - 1]?.text;
    return value === undefined || value === null ? "" : String(value);
  });

const getMediaFromParameter = (parameter = {}) =>
  parameter.image?.link ||
  parameter.video?.link ||
  parameter.document?.link ||
  null;

const buildTemplateSnapshot = (templateRecord, sentComponents = []) => {
  const templateComponents = Array.isArray(templateRecord?.components)
    ? templateRecord.components
    : [];
  const header = findTemplateComponent(templateComponents, "HEADER");
  const body = findTemplateComponent(templateComponents, "BODY");
  const footer = findTemplateComponent(templateComponents, "FOOTER");
  const buttons = findTemplateComponent(templateComponents, "BUTTONS");
  const sentHeader = findTemplateComponent(sentComponents, "HEADER");
  const sentBody = findTemplateComponent(sentComponents, "BODY");

  const mediaUrl =
    getMediaFromParameter(sentHeader?.parameters?.[0]) ||
    templateRecord?.local_url ||
    header?.example?.header_url?.[0] ||
    header?.example?.header_handle?.[0] ||
    null;

  return {
    name: templateRecord?.name,
    language: templateRecord?.language,
    category: templateRecord?.category,
    header: header
      ? {
          format: header.format,
          text:
            header.format === "TEXT"
              ? replaceTemplateParams(header.text || "", sentHeader?.parameters)
              : header.text || "",
          media_url: ["IMAGE", "VIDEO", "DOCUMENT"].includes(header.format)
            ? mediaUrl
            : null,
        }
      : null,
    body: replaceTemplateParams(
      body?.text || templateRecord?.body_text || "",
      sentBody?.parameters,
    ),
    footer: footer?.text || templateRecord?.footer_text || "",
    buttons: buttons?.buttons || templateRecord?.buttons || [],
  };
};

const META_API = "https://graph.facebook.com/v22.0";
const STALE_RUNNING_MS = 2 * 60 * 1000;

const formatMetaError = (data, fallback = "Meta API Error") => {
  const error = data?.error;
  if (!error) return fallback;
  // Detect specific messaging capability issues
  const errorCode = error.code;
  const errorSubcode = error.error_subcode;
  let specificError = null;

  if (errorCode === 131026) {
    specificError =
      "Account temporarily restricted. Add payment method in Meta Business Manager.";
  } else if (errorCode === 131092) {
    specificError =
      "Account messaging limit exceeded or messaging capability disabled.";
  } else if (errorCode === 550 && errorSubcode === 1104) {
    specificError =
      "Phone number not registered or messaging not enabled. Complete number registration in Meta.";
  } else if (error.message?.includes("Payment")) {
    specificError =
      "Payment method required. Add payment method to WhatsApp Business Account.";
  } else if (error.message?.includes("messaging")) {
    specificError = `Messaging capability issue: ${error.message}`;
  }

  if (specificError) return specificError;
  const parts = [
    error.message,
    error.code ? `code: ${error.code}` : null,
    error.error_subcode ? `subcode: ${error.error_subcode}` : null,
    error.error_data?.details,
    error.fbtrace_id ? `trace: ${error.fbtrace_id}` : null,
  ].filter(Boolean);

  return parts.join(" | ") || fallback;
};

/**
 * Sends a campaign based on its current configuration
 * @param {string} campaignId
 */
export async function sendCampaign(campaignId) {
  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return { error: "Campaign not found" };
    if (campaign.status === "running") {
      const startedAt = campaign.started_at
        ? new Date(campaign.started_at).getTime()
        : 0;
      const isStale = !startedAt || Date.now() - startedAt > STALE_RUNNING_MS;
      const messageCount = await Message.countDocuments({
        campaign_id: { $in: [campaign._id, campaign._id.toString()] },
      });

      if (!isStale || messageCount > 0) {
        return { success: true, message: "Campaign already running" };
      }

      console.warn(
        `[Campaign] Recovering stale running campaign with no messages: ${campaign._id}`,
      );
    }

    const waAccount = await WhatsAppAccount.findOne({
      user_id: campaign.user_id,
    });
    if (!waAccount) return { error: "WhatsApp not configured" };

    campaign.status = "running";
    campaign.started_at = new Date();
    await campaign.save();

    // Start sending in background...
    processCampaignInBackground(campaign, waAccount);

    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

async function processCampaignInBackground(campaign, waAccount) {
  try {
    console.log("[Campaign] Starting background send", {
      campaign_id: campaign._id,
      waba_id: waAccount.waba_id,
      phone_number_id: waAccount.phone_number_id,
      phone_number: waAccount.phone_number,
    });

    const {
      template_name,
      contact_ids,
      requires_follow_up,
      interactive_params,
      components: templateComponents = [],
    } = campaign;
    const contacts = await Contact.find({ _id: { $in: contact_ids } });

    // Removed GET /PHONE_NUMBER_ID account capability check per user request

    const templateRecord = await Template.findOne({
      user_id: campaign.user_id,
      name: template_name,
    });
    const templateLanguage = templateRecord?.language || "en_US";

    const componentsMap = new Map();
    if (templateComponents && Array.isArray(templateComponents)) {
      templateComponents.forEach((comp) => {
        if (comp.type) componentsMap.set(comp.type, comp);
      });
    }

    if (interactive_params) {
      if (interactive_params.header_image_url && !componentsMap.has("header")) {
        const url = interactive_params.header_image_url;
        const isVideo =
          url.match(/\.(mp4|webm|ogg)$/i) ||
          template_name.toLowerCase().includes("video");
        const mediaType = isVideo ? "video" : "image";

        componentsMap.set("header", {
          type: "header",
          parameters: [
            {
              type: mediaType,
              [mediaType]: { link: url },
            },
          ],
        });
      }
      if (interactive_params.offer_code) {
        const futureTime = new Date(new Date().getTime() + 48 * 60 * 60 * 1000);
        if (!componentsMap.has("button")) {
          componentsMap.set("limited_time_offer", {
            type: "limited_time_offer",
            parameters: [
              {
                type: "limited_time_offer",
                limited_time_offer: {
                  expiration_time_ms: futureTime.getTime(),
                },
              },
            ],
          });
          componentsMap.set("button", {
            type: "button",
            sub_type: "copy_code",
            index: 0,
            parameters: [
              {
                type: "coupon_code",
                coupon_code: interactive_params.offer_code,
              },
            ],
          });
        }
      }
    }

    const finalComponents = Array.from(componentsMap.values());
    let sent = 0,
      failed = 0;

    // Rate limiting: Meta allows ~50-80 msgs/sec per number. We'll be safe with 50.
    const BATCH_SIZE = 50;
    const DELAY_MS = 1000;

    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (contact) => {
        const recipient = normalizePhone(contact.phone_number);
        let conversation = null;

        try {
          if (!recipient || recipient.length < 8) {
            failed++;
            await Message.create({
              user_id: campaign.user_id,
              contact_id: contact._id,
              campaign_id: campaign._id,
              direction: "outbound",
              message_type: "template",
              template_name,
              content: `[Failed Template: ${template_name}]`,
              phone_number: contact.phone_number,
              status: "failed",
              error_details:
                "Invalid recipient phone number. Use country code and digits only, for example 919876543210.",
            });
            return;
          }

          conversation = await Conversation.findOneAndUpdate(
            { user_id: campaign.user_id, contact_id: contact._id },
            {
              $set: {
                phone_number: recipient,
                last_message: `[Template: ${template_name}]`,
                last_message_at: new Date(),
                status: "open",
              },
            },
            { upsert: true, returnDocument: "after" },
          );

          // Deep clone components to replace variables per-contact
          const contactComponents = JSON.parse(JSON.stringify(finalComponents));
          contactComponents.forEach(comp => {
            if (comp.parameters) {
              comp.parameters.forEach(param => {
                if (param.type === 'text' && typeof param.text === 'string') {
                  param.text = param.text.replace(/\{\{name(?:\|([^}]*))?\}\}/gi, (match, fallback) => {
                    const cName = contact.name?.trim();
                    const isValidName = cName && cName.toLowerCase() !== "user" && cName !== contact.phone_number;
                    return isValidName ? cName : (fallback || "");
                  });
                }
              });
            }
          });

          const endpoint = `${META_API}/${waAccount.phone_number_id}/messages`;
          const requestBody = {
            messaging_product: "whatsapp",
            to: recipient,
            type: "template",
            template: {
              name: template_name,
              language: { code: templateLanguage },
              ...(contactComponents.length > 0 && {
                components: contactComponents,
              }),
            },
          };

          console.log("Sending campaign message to:", recipient);
          console.log("[Campaign] Sending template message", {
            campaign_id: campaign._id,
            contact_phone: contact.phone_number,
            recipient: recipient,
            endpoint: endpoint,
            method: "POST",
            request_body: JSON.stringify(requestBody),
          });

          const r = await fetch(endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${waAccount.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
          });
          const data = await r.json();

          console.log("[Campaign] Message send response", {
            campaign_id: campaign._id,
            contact_phone: contact.phone_number,
            recipient: recipient,
            status: r.status,
            ok: r.ok,
            meta_response: data,
          });

          const msgId = data.messages?.[0]?.id;

          // Extract media URL for history
          const headerComp = finalComponents.find((c) => c.type === "header");
          const mediaUrl =
            headerComp?.parameters?.[0]?.image?.link ||
            headerComp?.parameters?.[0]?.video?.link ||
            headerComp?.parameters?.[0]?.document?.link;

          if (r.ok && msgId) {
            sent++;
            const templateSnapshot = buildTemplateSnapshot(
              templateRecord,
              contactComponents,
            );
            const messageContent =
              templateSnapshot.body || `[Template: ${template_name}]`;

            await Message.create({
              user_id: campaign.user_id,
              conversation_id: conversation?._id,
              contact_id: contact._id,
              campaign_id: campaign._id,
              direction: "outbound",
              message_type: "template",
              template_name,
              content: messageContent,
              media_url: mediaUrl || templateSnapshot.header?.media_url,
              template_snapshot: templateSnapshot,
              phone_number: recipient,
              whatsapp_message_id: msgId,
              status: "sent",
              requires_follow_up,
            });
          } else {
            failed++;
            const errorMsg = r.ok
              ? "Meta accepted the request but did not return a WhatsApp message id."
              : formatMetaError(data);

            console.log("[Campaign] Message send failed", {
              campaign_id: campaign._id,
              contact: contact.phone_number,
              recipient,
              status: r.status,
              error: data?.error,
              error_msg: errorMsg,
            });

            await Message.create({
              user_id: campaign.user_id,
              conversation_id: conversation?._id,
              contact_id: contact._id,
              campaign_id: campaign._id,
              direction: "outbound",
              message_type: "template",
              template_name,
              content: `[Failed Template: ${template_name}]`,
              phone_number: recipient,
              status: "failed",
              error_details: errorMsg,
            });
          }
        } catch (e) {
          failed++;
          await Message.create({
            user_id: campaign.user_id,
            conversation_id: conversation?._id,
            contact_id: contact._id,
            campaign_id: campaign._id,
            direction: "outbound",
            message_type: "template",
            template_name,
            content: `[Failed Template: ${template_name}]`,
            phone_number: recipient || contact.phone_number,
            status: "failed",
            error_details: `${e.name || "SendError"}: ${e.message || "Unable to send message"}`,
          }).catch((logErr) => {
            console.error(
              "[Campaign] Failed to record send error:",
              logErr.message,
            );
          });
        }
      });

      await Promise.allSettled(batchPromises);

      // Delay before next batch if we have more contacts to process
      if (i + BATCH_SIZE < contacts.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }

    campaign.status = "completed";
    campaign.completed_at = new Date();
    await campaign.save();
  } catch (err) {
    console.error("Workflow error in campaign process:", err);
    campaign.status = "failed";
    await campaign.save();
  }
}
