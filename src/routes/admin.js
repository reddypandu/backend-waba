import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Get current user's full dashboard data
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [profiles] = await pool.execute('SELECT * FROM profiles WHERE user_id = ?', [userId]);
    const [wallets] = await pool.execute('SELECT * FROM wallets WHERE user_id = ?', [userId]);
    const [waAccounts] = await pool.execute('SELECT * FROM whatsapp_accounts WHERE user_id = ?', [userId]);
    const [businesses] = await pool.execute('SELECT * FROM businesses WHERE user_id = ?', [userId]);
    const [subscriptions] = await pool.execute('SELECT * FROM subscriptions WHERE user_id = ?', [userId]);

    res.json({
      user: req.user,
      profile: profiles[0] || null,
      wallet: wallets[0] || { balance: 0 },
      waAccount: waAccounts[0] || null,
      business: businesses[0] || null,
      subscription: subscriptions[0] || { plan: 'free', status: 'active' }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all users (Admin only)
router.get('/users', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: admin access required' });
    }

    const [users] = await pool.execute(`
      SELECT u.id, u.email, u.full_name, u.role, u.created_at,
             w.balance as wallet_balance,
             wa.phone_number as whatsapp_number,
             s.plan as subscription_plan
      FROM users u
      LEFT JOIN wallets w ON u.id = w.user_id
      LEFT JOIN whatsapp_accounts wa ON u.id = wa.user_id
      LEFT JOIN subscriptions s ON u.id = s.user_id
      ORDER BY u.created_at DESC
    `);

    res.json({ users, stats: { total_users: users.length } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upsert Business
router.post('/businesses', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, website, industry, country, timezone, meta_business_id } = req.body;
    
    const [result] = await pool.execute(
      `INSERT INTO businesses (user_id, name, website, industry, country, timezone, meta_business_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE name=VALUES(name), website=VALUES(website), industry=VALUES(industry), 
       country=VALUES(country), timezone=VALUES(timezone), meta_business_id=VALUES(meta_business_id)`,
      [userId, name, website, industry, country, timezone, meta_business_id]
    );
    
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upsert WhatsApp Account
router.post('/whatsapp-accounts', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { phone_number, phone_number_id, waba_id, access_token, verification_status } = req.body;
    
    // Check if business exists
    const [businesses] = await pool.execute('SELECT id FROM businesses WHERE user_id = ? LIMIT 1', [userId]);
    const businessId = businesses[0]?.id;
    if (!businessId) throw new Error('Business details not found');

    const [result] = await pool.execute(
      `INSERT INTO whatsapp_accounts (user_id, business_id, phone_number, phone_number_id, waba_id, access_token, verification_status) 
       VALUES (?, ?, ?, ?, ?, ?, ?) 
       ON DUPLICATE KEY UPDATE 
       phone_number=VALUES(phone_number), phone_number_id=VALUES(phone_number_id), 
       waba_id=VALUES(waba_id), access_token=VALUES(access_token), 
       verification_status=VALUES(verification_status)`,
      [userId, businessId, phone_number, phone_number_id, waba_id, access_token, verification_status || 'pending']
    );
    
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Design Templates (Admin Only) ---

router.get('/designs', requireAuth, async (req, res) => {
  try {
    const [designs] = await pool.execute('SELECT * FROM design_templates ORDER BY created_at DESC');
    res.json(designs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/designs', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { name, category, image_url, default_heading, default_subheading, default_footer, text_color, accent_color } = req.body;
    
    const [result] = await pool.execute(
      `INSERT INTO design_templates (name, category, image_url, default_heading, default_subheading, default_footer, text_color, accent_color, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, category, image_url, default_heading, default_subheading, default_footer, text_color, accent_color, req.user.id]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/designs/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { enabled } = req.body;
    await pool.execute('UPDATE design_templates SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/designs/:id', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    await pool.execute('DELETE FROM design_templates WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-Replies CRUD ────────────────────────────────────────────────────────
router.get('/auto-replies', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM auto_replies WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/auto-replies', requireAuth, async (req, res) => {
  try {
    const { keyword, match_type = 'contains', response } = req.body;
    if (!keyword || !response) return res.status(400).json({ error: 'keyword and response required' });
    const [r] = await pool.execute(
      'INSERT INTO auto_replies (user_id, keyword, match_type, response) VALUES (?, ?, ?, ?)',
      [req.user.id, keyword.trim(), match_type, response.trim()]
    );
    res.json({ id: r.insertId, keyword, match_type, response, is_active: 1 });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Keyword already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/auto-replies/:id', requireAuth, async (req, res) => {
  try {
    const { keyword, match_type, response, is_active } = req.body;
    await pool.execute(
      'UPDATE auto_replies SET keyword = COALESCE(?, keyword), match_type = COALESCE(?, match_type), response = COALESCE(?, response), is_active = COALESCE(?, is_active) WHERE id = ? AND user_id = ?',
      [keyword, match_type, response, is_active, req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/auto-replies/:id', requireAuth, async (req, res) => {
  try {
    await pool.execute('DELETE FROM auto_replies WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Workflows CRUD ───────────────────────────────────────────────────────────
router.get('/workflows', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM workflows WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/workflows', requireAuth, async (req, res) => {
  try {
    const { name, trigger_type = 'keyword_match', trigger_value, actions = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const [r] = await pool.execute(
      'INSERT INTO workflows (user_id, name, trigger_type, trigger_value, actions) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, name, trigger_type, trigger_value || null, JSON.stringify(actions)]
    );
    res.json({ id: r.insertId, name, trigger_type, trigger_value, actions, is_active: 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/workflows/:id', requireAuth, async (req, res) => {
  try {
    const { name, trigger_type, trigger_value, actions, is_active } = req.body;
    const actionsJson = actions ? JSON.stringify(actions) : null;
    await pool.execute(
      'UPDATE workflows SET name = COALESCE(?, name), trigger_type = COALESCE(?, trigger_type), trigger_value = COALESCE(?, trigger_value), actions = COALESCE(?, actions), is_active = COALESCE(?, is_active) WHERE id = ? AND user_id = ?',
      [name, trigger_type, trigger_value, actionsJson, is_active, req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/workflows/:id', requireAuth, async (req, res) => {
  try {
    await pool.execute('DELETE FROM workflows WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Businesses ───────────────────────────────────────────────────────────────
router.post('/businesses', requireAuth, async (req, res) => {
  try {
    const { name } = req.body;
    const [existing] = await pool.execute('SELECT id FROM businesses WHERE user_id = ? LIMIT 1', [req.user.id]);
    if (existing.length) return res.json({ id: existing[0].id });
    const [r] = await pool.execute('INSERT INTO businesses (user_id, name) VALUES (?, ?)', [req.user.id, name || 'My Business']);
    res.json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WhatsApp Accounts ────────────────────────────────────────────────────────
router.post('/whatsapp-accounts', requireAuth, async (req, res) => {
  try {
    const { phone_number_id, waba_id, access_token, phone_number } = req.body;
    if (!phone_number_id || !waba_id || !access_token) {
      return res.status(400).json({ error: 'phone_number_id, waba_id, and access_token are required' });
    }
    // Ensure business exists
    const [existing] = await pool.execute('SELECT id FROM businesses WHERE user_id = ? LIMIT 1', [req.user.id]);
    let businessId;
    if (existing.length) {
      businessId = existing[0].id;
    } else {
      const [r] = await pool.execute('INSERT INTO businesses (user_id, name) VALUES (?, ?)', [req.user.id, 'My Business']);
      businessId = r.insertId;
    }
    await pool.execute(
      `INSERT INTO whatsapp_accounts (user_id, business_id, phone_number_id, waba_id, access_token, phone_number, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE phone_number_id=VALUES(phone_number_id), waba_id=VALUES(waba_id), access_token=VALUES(access_token), phone_number=VALUES(phone_number)`,
      [req.user.id, businessId, phone_number_id, waba_id, access_token, phone_number || null]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
