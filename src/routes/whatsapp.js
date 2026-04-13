import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import Contact from '../models/Contact.js';
import Campaign from '../models/Campaign.js';
import Template from '../models/Template.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import Conversation from '../models/Conversation.js';
import { sendCampaign } from '../utils/campaign.js';
import { uploadToCloudinary } from '../services/cloudinary.js';
import { fileURLToPath } from 'url';

const router = Router();
const META_API = 'https://graph.facebook.com/v22.0';

const upload = multer({ storage: multer.memoryStorage() });

// ── Media Upload (Local + Meta Handle) ────────────────────────────────────────
router.post('/upload_media', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file provided' });
    
    // 1. Save locally as backup
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const assetPath = path.join(__dirname, '..', 'public', 'uploads', 'templates');
    if (!fs.existsSync(assetPath)) fs.mkdirSync(assetPath, { recursive: true });
    
    const filename = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    const localFilePath = path.join(assetPath, filename);
    fs.writeFileSync(localFilePath, file.buffer);

    // 2. Upload to Cloudinary for reliable public HTTPS URL
    let cloudUrl = null;
    try {
      cloudUrl = await uploadToCloudinary(localFilePath);
    } catch (cErr) {
      console.error('Cloudinary upload failed, falling back to local:', cErr);
    }

    // Build accessible URL
    const host = req.get('host');
    const isLocal = host.includes('localhost') || host.includes('127.0.0.1');
    const protocol = isLocal ? (req.headers['x-forwarded-proto'] || req.protocol) : 'https';
    const localUrl = cloudUrl || `${protocol}://${host}/uploads/templates/${filename}`;

    // 3. Get Meta Handle (Required for template creation)
    const waAccount = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!waAccount) return res.status(400).json({ error: 'WhatsApp account not linked' });
    
    const appId = process.env.META_APP_ID;
    const sessRes = await fetch(`${META_API}/${appId}/uploads?file_length=${file.size}&file_type=${file.mimetype}&access_token=${waAccount.access_token}`, {
      method: 'POST'
    });
    const sessData = await sessRes.json();
    if (sessData.error) throw new Error(sessData.error.message);

    const upRes = await fetch(`${META_API}/${sessData.id}`, {
      method: 'POST',
      headers: { 'Authorization': `OAuth ${waAccount.access_token}`, 'file_offset': '0' },
      body: file.buffer
    });
    const upData = await upRes.json();
    if (upData.error) throw new Error(upData.error.message);

    res.json({ success: true, handle: upData.h, localPath: localUrl });
  } catch (err) {
    console.error('Upload media error:', err);
    res.status(500).json({ error: err.message });
  }
});



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
          
          let cloudinaryUrl = undefined;
          const header = mt.components?.find(c => c.type === 'HEADER');
          if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format)) {
             const existing = await Template.findOne({ user_id: userId, name: mt.name });
             // We only upload if it has NO local_url!
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
      // Mark account as verified on successful sync/fetch
      await WhatsAppAccount.findOneAndUpdate({ user_id: userId }, { verification_status: 'verified' });
      
      const allTemplates = await Template.find({ user_id: userId });
      console.log(`[Sync] Found ${allTemplates.length} templates. ${allTemplates.filter(t => t.local_url).length} have local_url.`);
      return res.json({ templates: allTemplates });
    }

    if (action === 'create_template') {
      const { name, category, language, components, local_url } = params;
      const r = await fetch(`${META_API}/${waba_id}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, language, components }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: data.error?.message || 'Meta API error' });
      
      const newTemplate = await Template.create({
        user_id: userId, name, category, language, components, status: 'PENDING', meta_template_id: data.id, local_url: local_url
      });
      return res.json({ success: true, template: newTemplate });
    }

    if (action === 'send_template') {
      const { to, template_name, template_language = 'en', components, requires_follow_up = false } = params;
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
      
      // Ensure contact & conversation exist
      const contact = await Contact.findOneAndUpdate(
        { user_id: userId, phone_number: to },
        { $setOnInsert: { user_id: userId, phone_number: to, name: to } },
        { upsert: true, new: true }
      );
      
      const conv = await Conversation.findOneAndUpdate(
        { user_id: userId, contact_id: contact._id, phone_number: to },
        { $set: { last_message: `[Template: ${template_name}]`, last_message_at: new Date() } },
        { upsert: true, new: true }
      );

      // Build a preview text for the Inbox list
      const bodyComp = (components || []).find(c => c.type === 'body');
      let previewContent = `[Template: ${template_name}]`;
      if (bodyComp && bodyComp.parameters) {
        // Simple preview of body variables
        const varText = bodyComp.parameters.map(p => p.text).join(', ');
        previewContent = `${template_name}: ${varText}`;
      }

      // Extract media URL if present
      const headerComp = (components || []).find(c => c.type === 'header');
      const mediaUrl = headerComp?.parameters?.[0]?.image?.link || 
                        headerComp?.parameters?.[0]?.video?.link || 
                        headerComp?.parameters?.[0]?.document?.link;

      await Message.create({ 
        user_id: userId, 
        conversation_id: conv._id,
        contact_id: contact._id,
        direction: 'outbound', 
        message_type: 'template', 
        template_name, 
        content: previewContent,
        media_url: mediaUrl,
        phone_number: to, 
        whatsapp_message_id: msgId, 
        status: 'sent', 
        requires_follow_up 
      });

      await WhatsAppAccount.findOneAndUpdate({ user_id: userId }, { verification_status: 'verified' });
      return res.json({ success: true, message_id: msgId, conversation_id: conv._id });
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
      const { name, category, components } = params;
      const r = await fetch(`${META_API}/${waba_id}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, components }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(400).json({ error: data.error?.message || 'Meta API error' });
      
      await Template.findOneAndUpdate(
        { user_id: userId, name: name },
        { category, components, status: 'PENDING' }
      );
      return res.json({ success: true });
    }

    if (action === 'delete_campaign') {
      const { id } = params;
      if (!id) return res.status(400).json({ error: 'Campaign ID required' });
      await Campaign.findOneAndDelete({ _id: id, user_id: userId });
      await Message.deleteMany({ campaign_id: id, user_id: userId });
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

router.get('/templates/all', requireAuth, async (req, res) => {
  try {
    const templates = await Template.find({ user_id: req.user.id }).sort({ createdAt: -1 });
    res.json({ templates });
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
    const campaigns = await Campaign.aggregate([
      { $match: { user_id: new mongoose.Types.ObjectId(req.user.id) } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'messages',
          localField: '_id',
          foreignField: 'campaign_id',
          as: 'msgs'
        }
      },
      {
        $addFields: {
          stats: {
            sent: { $size: { $filter: { input: '$msgs', as: 'm', cond: { $in: ['$$m.status', ['sent', 'delivered', 'read', 'replied']] } } } },
            delivered: { $size: { $filter: { input: '$msgs', as: 'm', cond: { $in: ['$$m.status', ['delivered', 'read', 'replied']] } } } },
            read: { $size: { $filter: { input: '$msgs', as: 'm', cond: { $in: ['$$m.status', ['read', 'replied']] } } } },
            failed: { $size: { $filter: { input: '$msgs', as: 'm', cond: { $eq: ['$$m.status', 'failed'] } } } }
          }
        }
      },
      { $project: { msgs: 0 } }
    ]);
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
    const { name, template_name, audience_type = 'existing', schedule_type = 'now', scheduled_at, contacts = [], requires_follow_up = false, interactive_params = null } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name required' });

    let campaignContactIds = [];
    if (contacts && contacts.length > 0) {
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
        contact_ids: campaignContactIds,
        status: schedule_type === 'later' ? 'scheduled' : 'draft',
        requires_follow_up,
        interactive_params,
        components: req.body.components || [], // Save template variables
      });

    res.json({ success: true, campaign_id: campaign._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/:id/send', requireAuth, async (req, res) => {
  try {
    const result = await sendCampaign(req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
 

router.get('/campaigns/:id/stats', requireAuth, async (req, res) => {
  try {
    const campaignId = req.params.id;
    const stats = await Message.aggregate([
      { 
        $match: { 
          campaign_id: new mongoose.Types.ObjectId(campaignId),
          user_id: new mongoose.Types.ObjectId(req.user.id)
        } 
      },
      {
        $group: {
          _id: null,
          sent: { $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered', 'read', 'replied']] }, 1, 0] } },
          delivered: { $sum: { $cond: [{ $in: ['$status', ['delivered', 'read', 'replied']] }, 1, 0] } },
          read: { $sum: { $cond: [{ $in: ['$status', ['read', 'replied']] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          replied: { $sum: { $cond: [{ $eq: ['$status', 'replied'] }, 1, 0] } }
        }
      }
    ]);

    const result = stats[0] || {
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      replied: 0
    };

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
    const failedMessages = await Message.find({ 
      campaign_id: new mongoose.Types.ObjectId(campaign._id), 
      user_id: new mongoose.Types.ObjectId(req.user.id),
      status: 'failed' 
    });
    if (failedMessages.length === 0) return res.json({ success: true, sent: 0, message: 'No failed messages to retarget' });

    const waAccount = await WhatsAppAccount.findOne({ user_id: req.user.id });
    
    let sent = 0;
    for (const msg of failedMessages) {
      try {
        const components = campaign.components || [];
        const r = await fetch(`${META_API}/${waAccount.phone_number_id}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${waAccount.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: msg.phone_number,
            type: 'template',
            template: { 
              name: campaign.template_name, 
              language: { code: 'en' },
              ...(components.length > 0 && { components })
            }
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
      user_id: new mongoose.Types.ObjectId(req.user.id), 
      campaign_id: new mongoose.Types.ObjectId(req.params.id) 
    }).sort({ createdAt: -1 });
    res.json({ messages });
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
