import express from 'express';
import { Router } from 'express';
import crypto from 'crypto';
import pool from '../config/db.js';

const router = Router();
const META_API = 'https://graph.facebook.com/v24.0';

// ── Webhook Verification (GET) ──────────────────────────────────────────────
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verified!');
    return res.send(challenge);
  }
  res.status(403).send('Forbidden');
});

// ── Webhook Events (POST) ────────────────────────────────────────────────────
router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
  // Respond immediately to Meta to acknowledge receipt
  res.json({ success: true });

  try {
    const rawBody = req.body.toString();

    // HMAC-SHA256 Signature Verification
    const signature = req.headers['x-hub-signature-256'];
    if (process.env.META_APP_SECRET && signature) {
      const expected = 'sha256=' + crypto
        .createHmac('sha256', process.env.META_APP_SECRET)
        .update(rawBody)
        .digest('hex');
      if (expected !== signature) {
        console.warn('Webhook HMAC mismatch - ignoring');
        return;
      }
    }

    const body = JSON.parse(rawBody);
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry) {
      const wabaId = entry.id;

      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        const value = change.value;

        // Handle statuses (delivered, read, failed updates)
        if (value.statuses) {
          for (const status of value.statuses) {
            try {
              const newStatus = status.status; // sent, delivered, read, failed
              const msgId = status.id;
              await pool.execute(
                'UPDATE message_logs SET status = ?, updated_at = NOW() WHERE whatsapp_message_id = ?',
                [newStatus, msgId]
              );
              await pool.execute(
                'UPDATE chat_messages SET status = ? WHERE whatsapp_message_id = ?',
                [newStatus, msgId]
              );
            } catch (e) {
              console.error('Status update error:', e.message);
            }
          }
        }

        // Handle incoming messages
        if (value.messages) {
          for (const message of value.messages) {
            try {
              await processInboundMessage(message, value, wabaId);
            } catch (e) {
              console.error('Inbound message error:', e.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

// ── Process Inbound Message ──────────────────────────────────────────────────
async function processInboundMessage(message, value, wabaId) {
  const from = message.from; // sender phone number
  const waMessageId = message.id;
  const timestamp = new Date(parseInt(message.timestamp) * 1000);
  const contactName = value.contacts?.[0]?.profile?.name || from;

  // Extract message content
  let content = null;
  let messageType = 'text';
  if (message.type === 'text') {
    content = message.text?.body;
    messageType = 'text';
  } else if (message.type === 'image') {
    content = message.image?.caption || '[Image]';
    messageType = 'image';
  } else if (message.type === 'video') {
    content = message.video?.caption || '[Video]';
    messageType = 'video';
  } else if (message.type === 'document') {
    content = message.document?.filename || '[Document]';
    messageType = 'document';
  }

  // Find the user who owns this WABA
  const [waAccounts] = await pool.execute(
    'SELECT user_id, phone_number_id, access_token FROM whatsapp_accounts WHERE waba_id = ? LIMIT 1',
    [wabaId]
  );
  if (!waAccounts.length) {
    console.warn(`No account found for WABA: ${wabaId}`);
    return;
  }

  const { user_id: userId, phone_number_id: phoneNumberId, access_token: accessToken } = waAccounts[0];

  // Upsert contact
  const [contactResult] = await pool.execute(
    `INSERT INTO contacts (user_id, phone_number, name) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE name = IF(name = phone_number, VALUES(name), name), id = LAST_INSERT_ID(id)`,
    [userId, from, contactName]
  );
  // Get contact id - use a fresh query to be reliable
  const [contacts] = await pool.execute('SELECT id FROM contacts WHERE user_id = ? AND phone_number = ?', [userId, from]);
  const contactId = contacts[0]?.id;
  if (!contactId) return;

  // Upsert conversation
  const [convs] = await pool.execute(
    'SELECT id FROM conversations WHERE user_id = ? AND contact_id = ?',
    [userId, contactId]
  );
  let conversationId;
  if (convs.length > 0) {
    conversationId = convs[0].id;
    await pool.execute(
      'UPDATE conversations SET last_message = ?, last_message_at = NOW(), status = ? WHERE id = ?',
      [content, 'open', conversationId]
    );
  } else {
    const [convResult] = await pool.execute(
      'INSERT INTO conversations (user_id, contact_id, last_message, status) VALUES (?, ?, ?, ?)',
      [userId, contactId, content, 'open']
    );
    conversationId = convResult.insertId;
  }

  // Insert chat message (avoid duplicates)
  await pool.execute(
    `INSERT IGNORE INTO chat_messages (user_id, conversation_id, contact_id, direction, message_type, content, whatsapp_message_id, status) 
     VALUES (?, ?, ?, 'inbound', ?, ?, ?, 'delivered')`,
    [userId, conversationId, contactId, messageType, content, waMessageId]
  );

  // Log in message_logs
  await pool.execute(
    `INSERT IGNORE INTO message_logs (user_id, contact_id, phone_number, direction, whatsapp_message_id, status)
     VALUES (?, ?, ?, 'inbound', ?, 'delivered')`,
    [userId, contactId, from, waMessageId]
  );

  // ── Auto-Reply Logic ──────────────────────────────────────────────────────
  if (content && messageType === 'text') {
    await checkAndSendAutoReply(userId, from, content, phoneNumberId, accessToken, conversationId, contactId);
  }
}

// ── Auto-Reply Check ─────────────────────────────────────────────────────────
async function checkAndSendAutoReply(userId, to, incomingText, phoneNumberId, accessToken, conversationId, contactId) {
  try {
    const [rules] = await pool.execute(
      'SELECT * FROM auto_replies WHERE user_id = ? AND is_active = TRUE ORDER BY match_type DESC',
      [userId]
    );

    const lowerText = incomingText.toLowerCase().trim();
    let matchedRule = null;

    for (const rule of rules) {
      const kw = rule.keyword.toLowerCase().trim();
      if (rule.match_type === 'exact' && lowerText === kw) { matchedRule = rule; break; }
      if (rule.match_type === 'starts_with' && lowerText.startsWith(kw)) { matchedRule = rule; break; }
      if (rule.match_type === 'contains' && lowerText.includes(kw)) { matchedRule = rule; break; }
    }

    if (!matchedRule) return;

    // Send auto reply via Meta API
    const r = await fetch(`${META_API}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/^\+/, ''),
        type: 'text',
        text: { body: matchedRule.response },
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Auto-reply send failed:', data);
      return;
    }

    const autoReplyMsgId = data.messages?.[0]?.id;

    // Log auto-reply message
    await pool.execute(
      `INSERT INTO chat_messages (user_id, conversation_id, contact_id, direction, message_type, content, whatsapp_message_id, status)
       VALUES (?, ?, ?, 'outbound', 'text', ?, ?, 'sent')`,
      [userId, conversationId, contactId, `[Auto-Reply] ${matchedRule.response}`, autoReplyMsgId]
    );

    console.log(`Auto-reply sent for keyword "${matchedRule.keyword}" to ${to}`);
  } catch (err) {
    console.error('Auto-reply error:', err.message);
  }
}

export default router;
