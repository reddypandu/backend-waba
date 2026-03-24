import express, { Router } from 'express';
import crypto from 'crypto';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import Contact from '../models/Contact.js';
import Conversation from '../models/Conversation.js';
import Message from '../models/Message.js';
import { AutoReply } from '../models/Automation.js';

const router = Router();
const META_API = 'https://graph.facebook.com/v24.0';

// ── GET: Verification ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) return res.send(challenge);
  res.status(403).send('Forbidden');
});

// ── POST: Inbound events ─────────────────────────────────────────────────────
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  res.json({ success: true }); // Respond immediately

  try {
    const rawBody = req.body.toString();

    // HMAC verification
    const sig = req.headers['x-hub-signature-256'];
    if (process.env.META_APP_SECRET && sig) {
      const expected = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex');
      if (expected !== sig) { console.warn('❌ HMAC mismatch'); return; }
    }

    const body = JSON.parse(rawBody);
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const value = change.value;

        // Status updates (delivered, read, failed)
        if (value.statuses) {
          for (const s of value.statuses) {
            await Message.findOneAndUpdate({ whatsapp_message_id: s.id }, { status: s.status });
          }
        }

        // Inbound messages
        if (value.messages) {
          for (const msg of value.messages) {
            await processMessage(msg, value, entry.id).catch(e => console.error('Msg error:', e.message));
          }
        }
      }
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ── Process Inbound Message ───────────────────────────────────────────────────
async function processMessage(msg, value, wabaId) {
  const from = msg.from;
  const contactName = value.contacts?.[0]?.profile?.name || from;

  let content = null, messageType = msg.type;
  if (msg.type === 'text') content = msg.text?.body;
  else if (msg.type === 'image') content = msg.image?.caption || '[Image]';
  else if (msg.type === 'video') content = msg.video?.caption || '[Video]';
  else if (msg.type === 'document') content = msg.document?.filename || '[Document]';

  const waAccount = await WhatsAppAccount.findOne({ waba_id: wabaId });
  if (!waAccount) return;
  const userId = waAccount.user_id;

  // Upsert contact
  const contact = await Contact.findOneAndUpdate(
    { user_id: userId, phone_number: from },
    { $setOnInsert: { user_id: userId, phone_number: from, name: contactName } },
    { upsert: true, new: true }
  );

  // Upsert conversation
  const conversation = await Conversation.findOneAndUpdate(
    { user_id: userId, contact_id: contact._id },
    { $set: { last_message: content, last_message_at: new Date(), status: 'open' }, $inc: { unread_count: 1 } },
    { upsert: true, new: true }
  );

  // Save message (ignore duplicate whatsapp_message_ids)
  try {
    await Message.create({
      user_id: userId,
      conversation_id: conversation._id,
      contact_id: contact._id,
      direction: 'inbound',
      message_type: messageType,
      content,
      phone_number: from,
      whatsapp_message_id: msg.id,
      status: 'delivered',
    });
  } catch (e) {
    if (e.code !== 11000) throw e; // ignore duplicate key
  }

  // Auto-reply check
  if (content && messageType === 'text') {
    await checkAutoReply(userId, from, content, waAccount.phone_number_id, waAccount.access_token, conversation._id, contact._id);
  }
}

// ── Auto-Reply Engine ─────────────────────────────────────────────────────────
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
  if (!r.ok) { console.error('Auto-reply failed:', data); return; }

  await Message.create({
    user_id: userId, conversation_id: convId, contact_id: contactId,
    direction: 'outbound', message_type: 'text',
    content: `[Auto-Reply] ${matched.response}`,
    whatsapp_message_id: data.messages?.[0]?.id,
    status: 'sent',
  }).catch(() => {});
}

export default router;
