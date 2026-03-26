import express, { Router } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import Contact from '../models/Contact.js';
import Message from '../models/Message.js';
import Template from '../models/Template.js';
import { AutoReply } from '../models/Automation.js';

const router = Router();
const Conversation = mongoose.model('Conversation');
const META_API = 'https://graph.facebook.com/v24.0';

// ── GET: Verification ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    await WhatsAppAccount.updateMany({}, { webhook_verified: true }).catch(() => {});
    return res.send(challenge);
  }
  res.status(403).send('Forbidden');
});

// ── POST: Inbound events ─────────────────────────────────────────────────────
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  res.json({ success: true });

  try {
    const rawBody = req.body.toString();
    const sig = req.headers['x-hub-signature-256'];
    if (process.env.META_APP_SECRET && sig) {
      const expected = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex');
      if (expected !== sig) return;
    }

    const body = JSON.parse(rawBody);
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry) {
      const wabaId = entry.id;
      for (const change of entry.changes) {
        const value = change.value;
        const metadata = value.metadata;
        const phoneNumberId = metadata?.phone_number_id;

        console.log(`[Webhook] Event: ${change.field}, WABA: ${wabaId}, PNID: ${phoneNumberId}`);

        // Mark as verified if we find an account
        if (phoneNumberId || wabaId) {
          await WhatsAppAccount.findOneAndUpdate(
            { $or: [{ phone_number_id: phoneNumberId }, { waba_id: wabaId }] }, 
            { webhook_verified: true }
          ).catch(() => {});
        }

        // 1. Template Status Updates
        if (change.field === 'message_template_status_update') {
          const { message_template_id, message_template_name, event } = value;
          console.log(`[Webhook] Template Update: ${message_template_name} -> ${event}`);
          await Template.findOneAndUpdate(
            { name: message_template_name }, 
            { status: event || 'APPROVED' }
          ).catch(() => {});
          continue;
        }

        // 2. Inbound Messages
        if (change.field !== 'messages') continue;

        if (value.statuses) {
          for (const s of value.statuses) {
            const updatedMsg = await Message.findOneAndUpdate({ whatsapp_message_id: s.id }, { status: s.status });
            
            // Automated Follow-up Logic (from sample app): If message was flagged for follow-up and was delivered/read
            if (updatedMsg && updatedMsg.requires_follow_up && (s.status === 'delivered' || s.status === 'read')) {
              await sendFollowUpMessage(updatedMsg, phoneNumberId, wabaId).catch(console.error);
              await Message.findByIdAndUpdate(updatedMsg._id, { requires_follow_up: false });
            }
          }
        }

        if (value.messages) {
          for (const msg of value.messages) {
            console.log(`[Webhook] Inbound message from ${msg.from}`);
            await processMessage(msg, value, phoneNumberId, wabaId).catch(e => console.error('Msg error:', e.message));
          }
        }
      }
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ── Process Inbound Message ───────────────────────────────────────────────────
async function processMessage(msg, value, phoneNumberId, wabaId) {
  const from = msg.from;
  const contactName = value.contacts?.[0]?.profile?.name || from;

  let content = null, messageType = msg.type;
  let interactiveReplyId = null;
  
  if (msg.type === 'text') content = msg.text?.body;
  else if (msg.type === 'image') content = msg.image?.caption || '[Image]';
  else if (msg.type === 'video') content = msg.video?.caption || '[Video]';
  else if (msg.type === 'document') content = msg.document?.filename || '[Document]';
  else if (msg.type === 'interactive') {
    if (msg.interactive?.type === 'button_reply') {
      content = msg.interactive.button_reply.title;
      interactiveReplyId = msg.interactive.button_reply.id;
    } else if (msg.interactive?.type === 'list_reply') {
      content = msg.interactive.list_reply.title;
      interactiveReplyId = msg.interactive.list_reply.id;
    } else {
      content = '[Interactive]';
    }
  } else if (msg.type === 'button') {
    content = msg.button?.text || '[Button]';
  }

  // Find account by either ID
  const waAccount = await WhatsAppAccount.findOne({
    $or: [{ phone_number_id: phoneNumberId }, { waba_id: wabaId }]
  });
  
  if (!waAccount) {
    console.error(`[Webhook] Account not found for PNID: ${phoneNumberId}, WABA: ${wabaId}`);
    return;
  }
  const userId = waAccount.user_id;

  const contact = await Contact.findOneAndUpdate(
    { user_id: userId, phone_number: from },
    { $setOnInsert: { user_id: userId, phone_number: from, name: contactName } },
    { upsert: true, new: true }
  );

  const conversation = await Conversation.findOneAndUpdate(
    { user_id: userId, contact_id: contact._id },
    { $set: { phone_number: from, last_message: content, last_message_at: new Date(), status: 'open' }, $inc: { unread_count: 1 } },
    { upsert: true, new: true }
  );

  try {
    await Message.create({
      user_id: userId, conversation_id: conversation._id, contact_id: contact._id,
      direction: 'inbound', message_type: messageType, content, phone_number: from,
      whatsapp_message_id: msg.id, status: 'delivered',
      interactive_reply_id: interactiveReplyId,
    });
  } catch (e) { if (e.code !== 11000) throw e; }

  if (content && messageType === 'text') {
    await checkAutoReply(userId, from, content, waAccount.phone_number_id, waAccount.access_token, conversation._id, contact._id);
  }
}

async function checkAutoReply(userId, to, text, phoneNumberId, accessToken, convId, contactId) {
  const rules = await AutoReply.find({ user_id: userId, is_active: true });
  const lower = text.toLowerCase().trim();
  let matched = null;

  for (const rule of rules) {
    const kw = rule.keyword.toLowerCase().trim();
    if (rule.match_type === 'exact' && lower === kw) { matched = rule; break; }
    if (rule.match_type === 'starts_with' && lower.startsWith(kw)) { matched = rule; break; }
    if (rule.match_type === 'contains' && lower.includes(kw)) { matched = rule; break; }
  }
  if (!matched) return;

  const r = await fetch(`${META_API}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/^\+/, ''), type: 'text', text: { body: matched.response } }),
  });
  const data = await r.json();
  if (!r.ok) return;

  await Message.create({
    user_id: userId, conversation_id: convId, contact_id: contactId,
    direction: 'outbound', message_type: 'text', content: `[Auto-Reply] ${matched.response}`,
    whatsapp_message_id: data.messages?.[0]?.id, status: 'sent',
  }).catch(() => {});
}

async function sendFollowUpMessage(msg, phoneNumberId, wabaId) {
  const waAccount = await WhatsAppAccount.findOne({
    $or: [{ phone_number_id: phoneNumberId }, { waba_id: wabaId }]
  });
  if (!waAccount) return;
  
  const text = "Thanks for checking out our message! Would you like to try another demo?";
  
  const r = await fetch(`${META_API}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${waAccount.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: msg.phone_number, type: 'text', text: { body: text } }),
  });
  const data = await r.json();
  if (r.ok) {
    await Message.create({
      user_id: waAccount.user_id, conversation_id: msg.conversation_id, contact_id: msg.contact_id,
      direction: 'outbound', message_type: 'text', content: `[Follow-up] ${text}`,
      whatsapp_message_id: data.messages?.[0]?.id, status: 'sent',
    }).catch(() => {});
  }
}

export default router;
