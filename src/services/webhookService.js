import WhatsAppAccount from "../models/WhatsAppAccount.js";
import Contact from "../models/Contact.js";
import Message from "../models/Message.js";
import Template from "../models/Template.js";
import { AutoReply, Workflow } from "../models/Automation.js";
import Conversation from "../models/Conversation.js";
import Campaign from "../models/Campaign.js";
import { normalizePhone } from "../utils/phoneUtils.js";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
const META_API = `https://graph.facebook.com/${GRAPH_VERSION}`;

const formatWebhookError = (error) => {
  if (!error) return null;

  return [
    error.message,
    error.code ? `code: ${error.code}` : null,
    error.error_subcode ? `subcode: ${error.error_subcode}` : null,
    error.error_data?.details,
    error.href,
  ]
    .filter(Boolean)
    .join(" | ");
};

export class WebhookService {
  static async processWebhookEvent(body) {
    if (body.object !== "whatsapp_business_account") {
      console.warn(
        "[Webhook] Object is not whatsapp_business_account:",
        body.object,
      );
      return;
    }

    for (const entry of body.entry) {
      const wabaId = entry.id;
      for (const change of entry.changes) {
        const value = change.value;
        const metadata = value.metadata;
        const phoneNumberId = metadata?.phone_number_id;

        console.log(
          `[Webhook] Event: ${change.field}, WABA ID: ${wabaId}, Phone Num ID: ${phoneNumberId}`,
        );

        if (global.webhookLogs) {
          global.webhookLogs.unshift({
            time: new Date(),
            msg: `Event: ${change.field}, PNID: ${phoneNumberId}`,
            body: change.value,
          });
          if (global.webhookLogs.length > 50) global.webhookLogs.pop();
        }

        // Mark as verified if we find an account
        if (phoneNumberId || wabaId) {
          const matchedAccount = await WhatsAppAccount.findOneAndUpdate(
            { $or: [{ phone_number_id: phoneNumberId }, { waba_id: wabaId }] },
            { webhook_verified: true },
            { sort: { updatedAt: -1 }, returnDocument: "after" },
          ).catch((e) =>
            console.error("[Webhook] DB Error finding account:", e.message),
          );
        }

        // 1. Template Status Updates
        if (change.field === "message_template_status_update") {
          const { message_template_id, message_template_name, event } = value;
          console.log(
            `[Webhook] Template Update: ${message_template_name} -> ${event}`,
          );
          await Template.findOneAndUpdate(
            { name: message_template_name },
            { status: event || "APPROVED" },
          ).catch(() => {});
          continue;
        }

        // 2. Inbound Messages
        if (change.field !== "messages") continue;

        // 2a. Message Status Updates (Delivery Receipts)
        if (value.statuses) {
          for (const s of value.statuses) {
            let sStatus = s.status;
            let statusUpdate = { status: sStatus };
            if (s.errors && s.errors.length > 0) {
              statusUpdate.error_details = formatWebhookError(s.errors[0]);
              console.log(`[Webhook Status] ❌ Message ${s.id} failed: ${s.errors[0].message}`);
              sStatus = 'failed';
              statusUpdate.status = 'failed';
            }
            if (sStatus === "delivered") statusUpdate.delivered_at = new Date();
            if (sStatus === "read") statusUpdate.read_at = new Date();

            const hierarchy = { queued: 0, sent: 1, delivered: 2, read: 3, replied: 4, failed: 5 };
            
            // Handle Race Condition: Webhook might arrive before Message.create finishes
            let currentMsg = await Message.findOne({ whatsapp_message_id: s.id });
            if (!currentMsg) {
              console.log(`[Webhook] Message ${s.id} not found, retrying in 1s...`);
              await new Promise(res => setTimeout(res, 1000));
              currentMsg = await Message.findOne({ whatsapp_message_id: s.id });
            }

            let updatedMsg = null;
            if (currentMsg) {
              const currentLevel = hierarchy[currentMsg.status] || 0;
              const newLevel = hierarchy[sStatus] || 0;
              
              if (newLevel > currentLevel || sStatus === 'failed') {
                updatedMsg = await Message.findOneAndUpdate(
                  { whatsapp_message_id: s.id },
                  statusUpdate,
                  { new: true }
                );
              } else {
                // Keep existing status but update timestamps if applicable
                if (sStatus === 'delivered' && !currentMsg.delivered_at) {
                  await Message.updateOne({ whatsapp_message_id: s.id }, { delivered_at: new Date() });
                }
                updatedMsg = currentMsg;
              }
            }

            if (updatedMsg) {
              if (updatedMsg.campaign_id) {
                const incObj = {};
                if (s.status === "sent") incObj.accepted_count = 1;
                if (s.status === "delivered") incObj.delivered_count = 1;
                if (s.status === "read") incObj.read_count = 1;
                if (s.status === "failed") incObj.failed_count = 1;

                if (Object.keys(incObj).length > 0) {
                  const updatedCampaign = await Campaign.findByIdAndUpdate(
                    updatedMsg.campaign_id,
                    { $inc: incObj },
                    { new: true },
                  );
                  if (updatedCampaign) {
                    // Campaign stats are updated in database, no socket notification.
                  }
                }
              }
            }

            // Automated Follow-up Logic (from sample app)
            if (
              updatedMsg &&
              updatedMsg.requires_follow_up &&
              (s.status === "delivered" || s.status === "read")
            ) {
              await this.sendFollowUpMessage(
                updatedMsg,
                phoneNumberId,
                wabaId,
              ).catch(console.error);
              await Message.findByIdAndUpdate(updatedMsg._id, {
                requires_follow_up: false,
              });
            }
          }
        }

        // 2b. New Incoming Messages
        if (value.messages) {
          for (const msg of value.messages) {
            console.log(`[Webhook] Inbound message from ${msg.from}`);
            await this.processMessage(msg, value, phoneNumberId, wabaId).catch(
              (e) => console.error("Msg error:", e.message),
            );
          }
        }
      }
    }
  }

  static async processMessage(msg, value, phoneNumberId, wabaId) {
    const from = msg.from;
    const contactName = value.contacts?.[0]?.profile?.name || from;

    let content = null,
      messageType = msg.type;
    let interactiveReplyId = null;

    if (msg.type === "text") content = msg.text?.body;
    else if (msg.type === "image") content = msg.image?.caption || "[Image]";
    else if (msg.type === "video") content = msg.video?.caption || "[Video]";
    else if (msg.type === "document")
      content = msg.document?.filename || "[Document]";
    else if (msg.type === "interactive") {
      if (msg.interactive?.type === "button_reply") {
        content = msg.interactive.button_reply.title;
        interactiveReplyId = msg.interactive.button_reply.id;
      } else if (msg.interactive?.type === "list_reply") {
        content = msg.interactive.list_reply.title;
        interactiveReplyId = msg.interactive.list_reply.id;
      } else {
        content = "[Interactive]";
      }
    } else if (msg.type === "button") {
      content = msg.button?.text || "[Button]";
    }

    const waAccount = await WhatsAppAccount.findOne({
      $or: [{ phone_number_id: phoneNumberId }, { waba_id: wabaId }],
    }).sort({ updatedAt: -1 });

    if (!waAccount) {
      console.error(
        `[Webhook] Account not found for PNID: ${phoneNumberId}, WABA: ${wabaId}`,
      );
      return;
    }
    const userId = waAccount.user_id;
    const normalizedPhone = normalizePhone(from);

    const contact = await Contact.findOneAndUpdate(
      { user_id: userId, phone_number: normalizedPhone },
      {
        $setOnInsert: {
          user_id: userId,
          phone_number: normalizedPhone,
          name: contactName,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    const conversation = await Conversation.findOneAndUpdate(
      { user_id: userId, contact_id: contact._id },
      {
        $set: {
          phone_number: normalizedPhone,
          last_message: content,
          last_message_at: new Date(),
          status: "open",
        },
        $inc: { unread_count: 1 },
      },
      { upsert: true, returnDocument: "after" },
    );

    try {
      const newMsg = await Message.create({
        user_id: userId,
        conversation_id: conversation._id,
        contact_id: contact._id,
        direction: "inbound",
        message_type: messageType,
        content,
        phone_number: normalizedPhone,
        whatsapp_message_id: msg.id,
        status: "delivered",
        interactive_reply_id: interactiveReplyId,
      });

      // --- CAMPAIGN ANALYTICS: TRACK REPLIES ---
      let repliedCampaignId = null;
      if (msg.context?.id) {
        const originalMsg = await Message.findOneAndUpdate(
          { whatsapp_message_id: msg.context.id },
          { status: "replied" },
        );
        if (originalMsg?.campaign_id)
          repliedCampaignId = originalMsg.campaign_id;
      } else {
        const lastOutbound = await Message.findOne({
          phone_number: normalizedPhone,
          direction: "outbound",
        }).sort({ createdAt: -1 });
        if (lastOutbound?.campaign_id) {
          repliedCampaignId = lastOutbound.campaign_id;
          lastOutbound.status = "replied";
          await lastOutbound.save();
        }
      }

      if (repliedCampaignId) {
        const updatedCampaign = await Campaign.findByIdAndUpdate(
          repliedCampaignId,
          { $inc: { replied_count: 1 } },
          { new: true },
        );
        if (updatedCampaign) {
          // Campaign stats are updated in database, no socket notification.
        }
      }
      // ------------------------------------------

      // Real-time socket notifications removed. Inbox will refresh by regular polling.
    } catch (e) {
      console.error("[Webhook] processMessage error:", e);
      if (e.code !== 11000) throw e;
    }

    const workflowHandled = await this.checkWorkflow(
      userId,
      conversation,
      content,
      interactiveReplyId,
      waAccount.phone_number_id,
      waAccount.access_token,
      conversation._id,
      contact._id,
    );

    if (!workflowHandled && content && messageType === "text") {
      await this.checkAutoReply(
        userId,
        from,
        content,
        waAccount.phone_number_id,
        waAccount.access_token,
        conversation._id,
        contact._id,
      );
    }
  }

  static async checkAutoReply(
    userId,
    to,
    text,
    phoneNumberId,
    accessToken,
    convId,
    contactId,
  ) {
    const rules = await AutoReply.find({ user_id: userId, is_active: true });
    const lower = text.toLowerCase().trim();
    let matched = null;

    for (const rule of rules) {
      const keywords = rule.keyword
        .split(",")
        .map((k) => k.toLowerCase().trim());
      const isMatched = keywords.some((kw) => {
        if (!kw) return false;
        if (rule.match_type === "exact" && lower === kw) return true;
        if (rule.match_type === "starts_with" && lower.startsWith(kw))
          return true;
        if (rule.match_type === "contains" && lower.includes(kw)) return true;
        return false;
      });

      if (isMatched) {
        matched = rule;
        break;
      }
    }
    if (!matched) return;

    const endpoint = `${META_API}/${phoneNumberId}/messages`;
    const requestBody = {
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "text",
      text: { body: matched.response },
    };

    console.log("[AutoReply] Sending auto-reply message", {
      endpoint,
      method: "POST",
      phone_number_id: phoneNumberId,
      recipient: to,
      message_preview: matched.response.substring(0, 100),
    });

    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const data = await r.json();

    console.log("[AutoReply] Response received", {
      status: r.status,
      ok: r.ok,
      message_id: data.messages?.[0]?.id,
      error: data.error?.message,
      error_code: data.error?.code,
    });

    if (!r.ok) {
      console.error("[AutoReply] Failed to send", {
        error_message: data.error?.message,
        error_code: data.error?.code,
        error_subcode: data.error?.error_subcode,
      });
      return;
    }

    await Message.create({
      user_id: userId,
      conversation_id: convId,
      contact_id: contactId,
      direction: "outbound",
      message_type: "text",
      content: `[Auto-Reply] ${matched.response}`,
      whatsapp_message_id: data.messages?.[0]?.id,
      status: "sent",
    }).catch(() => {});
  }

  static async checkWorkflow(
    userId,
    conversation,
    text,
    interactiveReplyId,
    phoneNumberId,
    accessToken,
    convId,
    contactId,
  ) {
    const workflows = await Workflow.find({ user_id: userId, is_active: true }).sort({ createdAt: 1 });
    if (!workflows.length) return false;

    const normalizedText = String(text || "").trim().toLowerCase();
    let workflow = null;
    let action = null;
    let isContinuation = false;

    if (conversation.workflow_id && conversation.workflow_step_id) {
      workflow = await Workflow.findById(conversation.workflow_id);
      if (!workflow) {
        conversation.workflow_id = null;
        conversation.workflow_step_id = null;
        await conversation.save();
      }
    }

    if (workflow) {
      action = this.findNextWorkflowAction(workflow, conversation.workflow_step_id, normalizedText, interactiveReplyId);
      isContinuation = Boolean(action);
    } else {
      for (const wf of workflows) {
        if (wf.trigger_type === "message_received") {
          action = wf.actions?.[0];
        } else if (wf.trigger_type === "keyword_match" && wf.trigger_value) {
          const trigger = String(wf.trigger_value).trim().toLowerCase();
          if (normalizedText === trigger || normalizedText.includes(trigger)) {
            action = wf.actions?.[0];
          }
        }

        if (action) {
          workflow = wf;
          break;
        }
      }
    }

    if (!workflow || !action) return false;

    if (isContinuation) {
      await Workflow.updateOne(
        { _id: workflow._id },
        {
          $inc: { "analytics.conversion_count": 1 },
          $set: { "analytics.last_triggered_at": new Date() },
        },
      ).catch(() => {});
    } else {
      await Workflow.updateOne(
        { _id: workflow._id },
        {
          $inc: { "analytics.trigger_count": 1 },
          $set: { "analytics.last_triggered_at": new Date() },
        },
      ).catch(() => {});
    }

    const sent = await this.executeWorkflowAction(
      workflow,
      action,
      phoneNumberId,
      accessToken,
      conversation,
      convId,
      contactId,
    );

    return sent;
  }

  static findNextWorkflowAction(workflow, currentStepId, normalizedText, interactiveReplyId) {
    const currentStep = workflow.actions?.find((a) => a.id === currentStepId);
    if (!currentStep) return null;

    if (currentStep.type === "send_buttons" && Array.isArray(currentStep.buttons)) {
      const match = currentStep.buttons.find((button) => {
        if (interactiveReplyId && button.id === interactiveReplyId) return true;
        const title = String(button.title || "").trim().toLowerCase();
        return title && title === normalizedText;
      });
      if (match && match.next_step) {
        return workflow.actions?.find((a) => a.id === match.next_step);
      }
    }

    if (currentStep.next_step) {
      return workflow.actions?.find((a) => a.id === currentStep.next_step);
    }

    return null;
  }

  static async executeWorkflowAction(
    workflow,
    action,
    phoneNumberId,
    accessToken,
    conversation,
    convId,
    contactId,
  ) {
    if (!action) return false;

    const to = conversation.phone_number.replace(/^\+/, "");
    let requestBody = null;
    let messageType = "text";
    let content = action.text || "";

    if (action.type === "send_buttons") {
      messageType = "interactive";
      requestBody = {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: content || "Please choose an option." },
          action: {
            buttons: (action.buttons || []).slice(0, 3).map((button) => ({
              type: "reply",
              reply: {
                id: button.id || button.title,
                title: String(button.title || "").substring(0, 20),
              },
            })),
          },
        },
      };
    } else {
      requestBody = {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: content || "" },
      };
    }

    const endpoint = `${META_API}/${phoneNumberId}/messages`;
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const data = await r.json();

    if (!r.ok) {
      console.error("[Workflow] Failed to send action", {
        workflow_id: workflow._id,
        action_id: action.id,
        error: data.error?.message,
      });
      await Workflow.updateOne(
        { _id: workflow._id },
        {
          $inc: { "analytics.failed_count": 1 },
          $set: { "analytics.last_failed_at": new Date() },
        },
      ).catch(() => {});
      return false;
    }

    await Workflow.updateOne(
      { _id: workflow._id },
      {
        $inc: { "analytics.execution_count": 1 },
        $set: { "analytics.last_executed_at": new Date() },
      },
    ).catch(() => {});

    await Message.create({
      user_id: workflow.user_id,
      conversation_id: convId,
      contact_id: contactId,
      direction: "outbound",
      message_type: messageType,
      content: action.type === "send_buttons" ? `[Workflow Button] ${content}` : content,
      whatsapp_message_id: data.messages?.[0]?.id,
      status: "sent",
    }).catch(() => {});

    const nextStepExists = Boolean(
      (action.type === "send_buttons" && action.buttons?.some((button) => button.next_step)) ||
      action.next_step,
    );

    if (nextStepExists) {
      conversation.workflow_id = workflow._id;
      conversation.workflow_step_id = action.id;
    } else {
      conversation.workflow_id = null;
      conversation.workflow_step_id = null;
    }

    await conversation.save();
    return true;
  }

  static async sendFollowUpMessage(msg, phoneNumberId, wabaId) {
    const waAccount = await WhatsAppAccount.findOne({
      $or: [{ phone_number_id: phoneNumberId }, { waba_id: wabaId }],
    });
    if (!waAccount) return;

    const text =
      "Thanks for checking out our message! Would you like to try another demo?";
    const endpoint = `${META_API}/${phoneNumberId}/messages`;
    const requestBody = {
      messaging_product: "whatsapp",
      to: msg.phone_number,
      type: "text",
      text: { body: text },
    };

    console.log("[FollowUp] Sending follow-up message", {
      endpoint,
      method: "POST",
      phone_number_id: phoneNumberId,
      recipient: msg.phone_number,
      message_preview: text.substring(0, 100),
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

    console.log("[FollowUp] Response received", {
      status: r.status,
      ok: r.ok,
      message_id: data.messages?.[0]?.id,
      error: data.error?.message,
      error_code: data.error?.code,
    });

    if (r.ok) {
      await Message.create({
        user_id: waAccount.user_id,
        conversation_id: msg.conversation_id,
        contact_id: msg.contact_id,
        direction: "outbound",
        message_type: "text",
        content: `[Follow-up] ${text}`,
        whatsapp_message_id: data.messages?.[0]?.id,
        status: "sent",
      }).catch(() => {});
    }
  }
}
