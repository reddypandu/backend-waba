import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import Business from '../models/Business.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import Contact from '../models/Contact.js';
import Campaign from '../models/Campaign.js';
import Template from '../models/Template.js';
import { AutoReply, Workflow } from '../models/Automation.js';
import WalletTransaction from '../models/WalletTransaction.js';

const router = Router();

// ── /me — Full dashboard data ─────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select('-password');
    const waAccount = await WhatsAppAccount.findOne({ user_id: userId });
    const business = await Business.findOne({ user_id: userId });
    const [contactCount, campaignCount, templateCount] = await Promise.all([
      Contact.countDocuments({ user_id: userId }),
      Campaign.countDocuments({ user_id: userId }),
      Template.countDocuments({ user_id: userId }),
    ]);
    const transactions = await WalletTransaction.find({ user_id: userId }).sort({ createdAt: -1 }).limit(20);

    res.json({
      user: { id: user._id, email: user.email, full_name: user.full_name, role: user.role },
      subscription: user.subscription,
      wallet: user.wallet,
      waAccount,
      business,
      stats: { contacts: contactCount, campaigns: campaignCount, templates: templateCount },
      transactions,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Contacts CRUD ─────────────────────────────────────────────────────────────
router.get('/contacts', requireAuth, async (req, res) => {
  try {
    const contacts = await Contact.find({ user_id: req.user.id }).sort({ createdAt: -1 });
    res.json(contacts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/contacts', requireAuth, async (req, res) => {
  try {
    const { name, phone_number, email, tags, notes } = req.body;
    const contact = await Contact.findOneAndUpdate(
      { user_id: req.user.id, phone_number },
      { $set: { name, email, tags, notes, user_id: req.user.id, phone_number } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(contact);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/contacts/:id', requireAuth, async (req, res) => {
  try {
    const contact = await Contact.findOneAndUpdate({ _id: req.params.id, user_id: req.user.id }, req.body, { new: true });
    res.json(contact);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/contacts/:id', requireAuth, async (req, res) => {
  try {
    await Contact.findOneAndDelete({ _id: req.params.id, user_id: req.user.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Templates CRUD ────────────────────────────────────────────────────────────
router.get('/templates', requireAuth, async (req, res) => {
  try {
    const templates = await Template.find({ user_id: req.user.id }).sort({ createdAt: -1 });
    res.json(templates);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/templates', requireAuth, async (req, res) => {
  try {
    const template = await Template.create({ ...req.body, user_id: req.user.id });
    res.json(template);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/templates/:id', requireAuth, async (req, res) => {
  try {
    const template = await Template.findOneAndUpdate({ _id: req.params.id, user_id: req.user.id }, req.body, { new: true });
    res.json(template);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/templates/:id', requireAuth, async (req, res) => {
  try {
    await Template.findOneAndDelete({ _id: req.params.id, user_id: req.user.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auto-Replies CRUD ────────────────────────────────────────────────────────
router.get('/auto-replies', requireAuth, async (req, res) => {
  try {
    res.json(await AutoReply.find({ user_id: req.user.id }).sort({ createdAt: -1 }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auto-replies', requireAuth, async (req, res) => {
  try {
    const { keyword, match_type = 'contains', response } = req.body;
    if (!keyword || !response) return res.status(400).json({ error: 'keyword and response required' });
    const rule = await AutoReply.create({ user_id: req.user.id, keyword: keyword.trim(), match_type, response: response.trim() });
    res.json(rule);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Keyword already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/auto-replies/:id', requireAuth, async (req, res) => {
  try {
    const rule = await AutoReply.findOneAndUpdate({ _id: req.params.id, user_id: req.user.id }, req.body, { new: true });
    res.json(rule);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/auto-replies/:id', requireAuth, async (req, res) => {
  try {
    await AutoReply.findOneAndDelete({ _id: req.params.id, user_id: req.user.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Workflows CRUD ───────────────────────────────────────────────────────────
router.get('/workflows', requireAuth, async (req, res) => {
  try {
    res.json(await Workflow.find({ user_id: req.user.id }).sort({ createdAt: -1 }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/workflows', requireAuth, async (req, res) => {
  try {
    const wf = await Workflow.create({ ...req.body, user_id: req.user.id, actions: req.body.actions || [] });
    res.json(wf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/workflows/:id', requireAuth, async (req, res) => {
  try {
    const wf = await Workflow.findOneAndUpdate({ _id: req.params.id, user_id: req.user.id }, req.body, { new: true });
    res.json(wf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/workflows/:id', requireAuth, async (req, res) => {
  try {
    await Workflow.findOneAndDelete({ _id: req.params.id, user_id: req.user.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Businesses ───────────────────────────────────────────────────────────────
router.post('/businesses', requireAuth, async (req, res) => {
  try {
    const biz = await Business.findOneAndUpdate(
      { user_id: req.user.id },
      { $setOnInsert: { user_id: req.user.id, name: req.body.name || 'My Business' } },
      { upsert: true, new: true }
    );
    res.json({ id: biz._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WhatsApp Accounts ────────────────────────────────────────────────────────
router.post('/whatsapp-accounts', requireAuth, async (req, res) => {
  try {
    const { phone_number_id, waba_id, access_token, phone_number } = req.body;
    if (!phone_number_id || !waba_id || !access_token) {
      return res.status(400).json({ error: 'phone_number_id, waba_id, and access_token are required' });
    }
    let biz = await Business.findOne({ user_id: req.user.id });
    if (!biz) biz = await Business.create({ user_id: req.user.id, name: 'My Business' });

    const wa = await WhatsAppAccount.findOneAndUpdate(
      { user_id: req.user.id },
      { phone_number_id, waba_id, access_token, phone_number, business_id: biz._id, verification_status: 'pending' },
      { upsert: true, new: true }
    );
    res.json({ success: true, id: wa._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Meta Business Profile ──────────────────────────────────────────────────
router.get('/whatsapp-profile', requireAuth, async (req, res) => {
  try {
    const forceSync = req.query.sync === 'true';
    if (!forceSync) {
      const biz = await Business.findOne({ user_id: req.user.id });
      if (biz && (biz.about || biz.description || biz.email || biz.address)) {
        // Return cached from local DB
        return res.json({ 
          about: biz.about, address: biz.address, description: biz.description, 
          email: biz.email, websites: biz.websites, vertical: biz.vertical, 
          profile_picture_url: biz.profile_picture_url,
          name: biz.name
        });
      }
    }

    const wa = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!wa || !wa.phone_number_id) return res.json({}); // Default empty if not set up
    
    // Fetch profile from Meta
    const r = await fetch(`https://graph.facebook.com/v24.0/${wa.phone_number_id}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`, {
      headers: { Authorization: `Bearer ${wa.access_token}` }
    });
    const data = await r.json();
    if (!r.ok) return res.json({}); // Default empty if Meta errors
    
    // Save to DB for next time
    const metaData = data.data?.[0] || {};
    await Business.findOneAndUpdate({ user_id: userId }, {
      about: metaData.about || "", 
      address: metaData.address || "", 
      description: metaData.description || "",
      email: metaData.email || "", 
      websites: metaData.websites || [], 
      vertical: metaData.vertical || "",
      profile_picture_url: metaData.profile_picture_url || ""
    }, { upsert: true });

    res.json(metaData);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/whatsapp-profile', requireAuth, async (req, res) => {
  try {
    const wa = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!wa || !wa.phone_number_id) return res.status(404).json({ error: 'WhatsApp not configured' });

    const { about, address, description, email, websites, vertical } = req.body;
    
    // Update Meta Profile
    const r = await fetch(`https://graph.facebook.com/v24.0/${wa.phone_number_id}/whatsapp_business_profile`, {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${wa.access_token}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', about, address, description, email, websites, vertical })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Meta API error');

    // Save to DB locally
    await Business.findOneAndUpdate(
      { user_id: req.user.id },
      { about, address, description, email, websites, vertical },
      { upsert: true }
    );

    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/whatsapp-profile-picture', requireAuth, async (req, res) => {
  try {
    const wa = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!wa || !wa.phone_number_id) return res.status(404).json({ error: 'WhatsApp not configured' });
    
    // To implement real upload, we need multer in express.
    res.status(501).json({ error: 'Logo upload is currently managed via Meta Dashboard. Direct upload coming soon.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
