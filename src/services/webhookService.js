import WhatsAppAccount from "../models/WhatsAppAccount.js";
import Contact from "../models/Contact.js";
import Message from "../models/Message.js";
import Template from "../models/Template.js";
import { AutoReply } from "../models/Automation.js";
import Conversation from "../models/Conversation.js";
import { emitToUser } from "../socket.js";

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
            const statusUpdate = { status: s.status };
            if (s.errors && s.errors.length > 0) {
              statusUpdate.error_details = formatWebhookError(s.errors[0]);
              console.log(
                `[Webhook Status] ❌ Message ${s.id} failed: ${s.errors[0].message}`,
              );
            }
            if (s.status === "delivered")
              statusUpdate.delivered_at = new Date();
            if (s.status === "read") statusUpdate.read_at = new Date();

            const updatedMsg = await Message.findOneAndUpdate(
              { whatsapp_message_id: s.id },
              statusUpdate,
              { new: true },
            );

            if (updatedMsg) {
              emitToUser(updatedMsg.user_id, "message_status", {
                message_id: updatedMsg._id,
                whatsapp_message_id: s.id,
                status: s.status,
                error_details: statusUpdate.error_details,
              });
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

    const contact = await Contact.findOneAndUpdate(
      { user_id: userId, phone_number: from },
      {
        $setOnInsert: {
          user_id: userId,
          phone_number: from,
          name: contactName,
        },
      },
      { upsert: true, returnDocument: "after" },
    );

    const conversation = await Conversation.findOneAndUpdate(
      { user_id: userId, contact_id: contact._id },
      {
        $set: {
          phone_number: from,
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
        phone_number: from,
        whatsapp_message_id: msg.id,
        status: "delivered",
        interactive_reply_id: interactiveReplyId,
      });

      emitToUser(userId, "new_message", {
        message: newMsg,
        conversation: conversation,
        contact: contact,
      });
    } catch (e) {
      if (e.code !== 11000) throw e;
    }

    if (content && messageType === "text") {
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
