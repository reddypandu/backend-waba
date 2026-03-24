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

    if (action === 'send_message') {
      const { to, content } = params;
      const r = await fetch(`${META_API}/${phone_number_id}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to,
          type: 'text', text: { body: content }
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: data.error?.message || 'Failed to send' });
      
      const msgId = data.messages?.[0]?.id;
      // Find or create conversation
      // Ensure contact exists for the conversation to group correctly
      const contact = await Contact.findOneAndUpdate(
        { user_id: userId, phone_number: to },
        { $setOnInsert: { user_id: userId, phone_number: to, name: to } },
        { upsert: true, new: true }
      );
      
      const conv = await Conversation.findOneAndUpdate(
        { user_id: userId, contact_id: contact._id, phone_number: to },
        { $set: { last_message: content, last_message_at: new Date() } },
        { upsert: true, new: true }
      );

      await Message.create({
        user_id: userId, conversation_id: conv._id, contact_id: contact?._id,
        direction: 'outbound', message_type: 'text', content, phone_number: to,
        whatsapp_message_id: msgId, status: 'sent'
      });
      return res.json({ success: true, message_id: msgId, conversation_id: conv._id });
    }

    if (action === 'edit_template') {
      const { id, category, components } = params;
      const r = await fetch(`${META_API}/${waba_id}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: params.name, category, components }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: data.error?.message || 'Meta API error' });
      
      await Template.findOneAndUpdate(
        { user_id: userId, name: params.name },
        { category, components, status: 'PENDING' }
      );
      return res.json({ success: true });
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('WhatsApp API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Inbox (Conversations & Messages) ──────────────────────────────────────────
router.get('/conversations', requireAuth, async (req, res) => {
  try {
    const convs = await Conversation.find({ user_id: req.user.id })
      .populate('contact_id')
      .sort({ last_message_at: -1 });
    res.json({ conversations: convs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/messages/:convId', requireAuth, async (req, res) => {
  try {
    const messages = await Message.find({ 
      user_id: req.user.id, 
      conversation_id: req.params.convId 
    }).sort({ createdAt: 1 });
    
    // Mark as read
    await Conversation.findByIdAndUpdate(req.params.convId, { unread_count: 0 });
    
    res.json({ messages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/templates/:id', requireAuth, async (req, res) => {
  try {
    const template = await Template.findOne({ _id: req.params.id, user_id: req.user.id });
    if (!template) return res.status(404).json({ error: 'Template not found locally' });
    res.json({ template });
  } catch (err) { res.status(500).json({ error: err.message }); }
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

    let campaignContactIds = [];
    if (audience_type === 'existing' && contacts?.length > 0) {
      campaignContactIds = contacts;
    } else if (audience_type === 'existing') {
      const allContacts = await Contact.find({ user_id: req.user.id });
      campaignContactIds = allContacts.map(c => c._id);
    }

    const campaign = await Campaign.create({
      user_id: req.user.id,
      name,
      template_name,
      audience_type,
      schedule_type,
      scheduled_at: scheduled_at || null,
      total_contacts: campaignContactIds.length,
      contact_ids: campaignContactIds, // Assuming we added this to model if not already exists
      status: schedule_type === 'scheduled' ? 'scheduled' : 'draft',
    });

    res.json({ success: true, campaign_id: campaign._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/:id/send', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, user_id: req.user.id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'running') return res.status(400).json({ error: 'Campaign already running' });

    const waAccount = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!waAccount) return res.status(400).json({ error: 'WhatsApp not configured' });

    campaign.status = 'running';
    campaign.started_at = new Date();
    await campaign.save();

    // Fire and forget (or use a background worker if available)
    (async () => {
      const { template_name, contact_ids } = campaign;
      const contacts = await Contact.find({ _id: { $in: contact_ids } });
      
      let sent = 0, failed = 0;
      for (const contact of contacts) {
        try {
          const r = await fetch(`${META_API}/${waAccount.phone_number_id}/messages`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${waAccount.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: contact.phone_number,
              type: 'template',
              template: { name: template_name, language: { code: 'en' } } 
            }),
          });
          const data = await r.json();
          const msgId = data.messages?.[0]?.id;
          
          if (r.ok) {
            sent++;
            // Create outgoing message link to campaign
            await Message.create({
              user_id: req.user.id,
              contact_id: contact._id,
              campaign_id: campaign._id,
              direction: 'outbound',
              message_type: 'template',
              template_name,
              phone_number: contact.phone_number,
              whatsapp_message_id: msgId,
              status: 'sent'
            });
          } else {
            failed++;
            await Message.create({
               user_id: req.user.id,
               contact_id: contact._id,
               campaign_id: campaign._id,
               direction: 'outbound',
               message_type: 'template',
               template_name,
               phone_number: contact.phone_number,
               status: 'failed',
               error_details: data.error?.message
            });
          }
        } catch (err) {
          failed++;
          console.error(`Send error for ${contact.phone_number}:`, err.message);
        }
      }
      campaign.status = 'completed';
      campaign.completed_at = new Date();
      await campaign.save();
      await User.findByIdAndUpdate(req.user.id, { $inc: { 'subscription.messages_used': sent } });
    })().catch(e => console.error('Campaign background loop error:', e));

    res.json({ success: true, message: 'Campaign started successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/campaigns/:id/stats', requireAuth, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const stats = await Message.aggregate([
      { $match: { campaign_id: new mongoose.Types.ObjectId(campaignId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const result = {
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      replied: 0
    };

    stats.forEach(s => {
      if (s._id === 'sent') result.sent = s.count;
      else if (s._id === 'delivered') result.delivered = s.count;
      else if (s._id === 'read') result.read = s.count;
      else if (s._id === 'failed') result.failed = s.count;
      else if (s._id === 'replied') result.replied = s.count;
    });

    // Special case: 'sent' includes everything that got out
    // In many UIs, 'Sent' is treated as total attempted successfully
    // We'll return them raw and let frontend decide
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/:id/retarget', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, user_id: req.user.id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Find messages that failed for this campaign
    const failedMessages = await Message.find({ campaign_id: campaign._id, status: 'failed' });
    if (failedMessages.length === 0) return res.json({ success: true, sent: 0, message: 'No failed messages to retarget' });

    const waAccount = await WhatsAppAccount.findOne({ user_id: req.user.id });
    
    let sent = 0;
    for (const msg of failedMessages) {
      try {
        const r = await fetch(`${META_API}/${waAccount.phone_number_id}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${waAccount.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: msg.phone_number,
            type: 'template',
            template: { name: campaign.template_name, language: { code: 'en' } }
          }),
        });
        const data = await r.json();
        if (r.ok) {
          sent++;
          await Message.findByIdAndUpdate(msg._id, { 
            status: 'sent', 
            whatsapp_message_id: data.messages?.[0]?.id,
            error_details: null 
          });
        }
      } catch (_) {}
    }
    res.json({ success: true, sent });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/messages-by-campaign/:id', requireAuth, async (req, res) => {
  try {
    const messages = await Message.find({ 
      user_id: req.user.id, 
      campaign_id: req.params.id 
    }).sort({ createdAt: 1 });
    res.json({ messages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/templates/all', requireAuth, async (req, res) => {
  try {
    const templates = await Template.find({ user_id: req.user.id }).sort({ createdAt: -1 });
    res.json({ templates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/contacts/batch', requireAuth, async (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts)) return res.status(400).json({ error: 'Contacts array required' });

    const createdIds = [];
    for (const c of contacts) {
      const contact = await Contact.findOneAndUpdate(
        { user_id: req.user.id, phone_number: c.phone },
        { $set: { name: c.name || c.phone } },
        { upsert: true, new: true }
      );
      createdIds.push(contact._id);
    }
    res.json({ success: true, ids: createdIds });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
