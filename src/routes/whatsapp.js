import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const META_API = 'https://graph.facebook.com/v24.0';

router.post('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { action, ...params } = req.body;

    // Fetch user's WhatsApp credentials from MySQL
    const [accounts] = await pool.execute(
      'SELECT access_token, phone_number_id, waba_id FROM whatsapp_accounts WHERE user_id = ? LIMIT 1',
      [userId]
    );

    const waAccount = accounts[0];
    if (!waAccount?.access_token) {
      throw new Error('WhatsApp not configured. Complete setup first.');
    }

    const { access_token: WHATSAPP_ACCESS_TOKEN, phone_number_id: WHATSAPP_PHONE_NUMBER_ID, waba_id: WHATSAPP_BUSINESS_ACCOUNT_ID } = waAccount;

    switch (action) {
      case 'get_templates': {
        const r = await fetch(`${META_API}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?limit=100`, {
          headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}` }
        });
        const data = await r.json();
        if (!r.ok) throw new Error(`Meta API error: ${JSON.stringify(data)}`);
        return res.json(data);
      }

      case 'create_template': {
        const { name, category, language, components } = params;
        const r = await fetch(`${META_API}/${WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, category, language, components }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(`Meta API error: ${JSON.stringify(data)}`);
        return res.json(data);
      }

      case 'edit_template': {
        const { template_id, name, category, components } = params;
        const r = await fetch(`${META_API}/${template_id}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, category, components }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(`Meta API error: ${JSON.stringify(data)}`);
        return res.json(data);
      }

      case 'send_message': {
        const { to, type, template, text, conversation_id, contact_id } = params;
        const normalizedTo = to.replace(/^\+/, '');

        let messageBody = { messaging_product: 'whatsapp', to: normalizedTo };
        if (type === 'template') {
          messageBody.type = 'template';
          messageBody.template = template;
        } else {
          messageBody.type = 'text';
          messageBody.text = { body: text };
        }

        const r = await fetch(`${META_API}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(messageBody),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(`Meta API error: ${JSON.stringify(data)}`);

        const waMessageId = data.messages?.[0]?.id;
        
        // Log message to MySQL
        await pool.execute(
          'INSERT INTO chat_messages (user_id, conversation_id, contact_id, direction, message_type, content, whatsapp_message_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            userId, conversation_id, contact_id, 'outbound', 
            type === 'template' ? 'template' : 'text',
            type === 'template' ? `Template: ${template?.name}` : text,
            waMessageId, 'sent'
          ]
        );

        if (conversation_id) {
          await pool.execute(
            'UPDATE conversations SET last_message = ?, last_message_at = NOW() WHERE id = ?',
            [type === 'template' ? `Template: ${template.name}` : text, conversation_id]
          );
        }
        return res.json(data);
      }

      case 'get_campaigns': {
        const [campaigns] = await pool.execute(
          'SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC',
          [userId]
        );
        return res.json(campaigns);
      }

      case 'get_campaign_detail': {
        const { id } = params;
        const [campaigns] = await pool.execute('SELECT * FROM campaigns WHERE id = ? AND user_id = ?', [id, userId]);
        if (campaigns.length === 0) throw new Error('Campaign not found');
        
        const [logs] = await pool.execute(`
          SELECT cl.*, c.phone_number, c.name as contact_name
          FROM campaign_logs cl
          LEFT JOIN contacts c ON cl.contact_id = c.id
          WHERE cl.campaign_id = ?
          ORDER BY cl.created_at DESC
        `, [id]);

        return res.json({ campaign: campaigns[0], logs });
      }

      case 'create_campaign': {
        const { name, template_id, audience_type, schedule_type, scheduled_at } = params;
        const [result] = await pool.execute(
          'INSERT INTO campaigns (user_id, name, template_id, audience_type, schedule_type, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [userId, name, template_id, audience_type, schedule_type, scheduled_at || null, 'draft']
        );
        return res.json({ success: true, id: result.insertId });
      }

      default:
        return res.status(400).json({ error: 'Unknown action' });
    }
  } catch (err) {
    console.error('WhatsApp API error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
