import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import Contact from '../models/Contact.js';
import Campaign from '../models/Campaign.js';
import Template from '../models/Template.js';
import Message from '../models/Message.js';
import User from '../models/User.js';

const router = Router();
const META_API = 'https://graph.facebook.com/v24.0';

// ── WhatsApp Actions (templates, send, contacts) ─────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { action, ...params } = req.body;
    const userId = req.user.id;
    const waAccount = await WhatsAppAccount.findOne({ user_id: userId });
    if (!waAccount) return res.status(400).json({ error: 'WhatsApp not configured. Complete setup first.' });

    const { access_token, phone_number_id, waba_id } = waAccount;

    if (action === 'get_templates' || action === 'sync_templates') {
      const r = await fetch(`${META_API}/${waba_id}/message_templates?limit=100`, { headers: { Authorization: `Bearer ${access_token}` } });
      const data = await r.json();
      const metaTemplates = data.data || [];
      
      // Update local MongoDB templates with statuses from Meta
      if (action === 'sync_templates') {
        for (const mt of metaTemplates) {
          await Template.findOneAndUpdate(
            { user_id: userId, name: mt.name },
            { 
              status: mt.status, 
              category: mt.category, 
              language: mt.language,
              components: mt.components,
              meta_template_id: mt.id 
            },
            { upsert: true }
          );
        }
      }
      return res.json({ templates: metaTemplates });
    }

    if (action === 'create_template') {
      const { name, category, language, components } = params;
      const r = await fetch(`${META_API}/${waba_id}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, language, components }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: data.error?.message || 'Meta API error' });
      
      const newTemplate = await Template.create({
        user_id: userId, name, category, language, components, status: 'PENDING', meta_template_id: data.id
      });
      return res.json({ success: true, template: newTemplate });
    }

    if (action === 'send_template') {
      const { to, template_name, template_language = 'en', components } = params;
      const r = await fetch(`${META_API}/${phone_number_id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to,
          type: 'template',
          template: { name: template_name, language: { code: template_language }, components: components || [] },
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: data.error?.message || 'Failed to send message' });
      const msgId = data.messages?.[0]?.id;
      await Message.create({ user_id: userId, direction: 'outbound', message_type: 'template', template_name, phone_number: to, whatsapp_message_id: msgId, status: 'sent' }).catch(() => {});
      return res.json({ success: true, message_id: msgId });
    }

    if (action === 'get_contacts') {
      const contacts = await Contact.find({ user_id: userId }).sort({ createdAt: -1 });
      return res.json({ contacts });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('WhatsApp API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Campaigns ─────────────────────────────────────────────────────────────────
router.get('/campaigns', requireAuth, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ user_id: req.user.id }).sort({ createdAt: -1 });
    res.json({ campaigns });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/campaigns/:id', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, user_id: req.user.id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ campaign });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns', requireAuth, async (req, res) => {
  try {
    const { name, template_name, audience_type = 'existing', schedule_type = 'now', scheduled_at, contacts = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name required' });

    const waAccount = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!waAccount) return res.status(400).json({ error: 'WhatsApp not configured' });

    let finalContacts = contacts;
    if (audience_type === 'existing') {
      const allContacts = await Contact.find({ user_id: req.user.id });
      finalContacts = allContacts.map(c => c.phone_number);
    }

    if (!finalContacts.length) return res.status(400).json({ error: 'No contacts found for this audience' });

    const campaign = await Campaign.create({
      user_id: req.user.id, name, template_name,
      audience_type, schedule_type, scheduled_at: scheduled_at || null,
      total_recipients: finalContacts.length, status: 'running',
    });

    // Send messages and log
    let sent = 0, failed = 0;
    for (const phone of finalContacts) {
      try {
        const r = await fetch(`${META_API}/${waAccount.phone_number_id}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${waAccount.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: template_name, language: { code: 'en' } } }),
        });
        const data = await r.json();
        const msgId = data.messages?.[0]?.id;
        campaign.logs.push({ phone_number: phone, status: r.ok ? 'sent' : 'failed', whatsapp_message_id: msgId });
        if (r.ok) sent++; else failed++;
      } catch (_) {
        campaign.logs.push({ phone_number: phone, status: 'failed' });
        failed++;
      }
    }
    campaign.sent_count = sent;
    campaign.failed_count = failed;
    campaign.status = 'completed';
    await campaign.save();

    // Increment user messages_used
    await User.findByIdAndUpdate(req.user.id, { $inc: { 'subscription.messages_used': sent } });

    res.json({ success: true, campaign_id: campaign._id, sent, failed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
