import { Router } from 'express';
import pool from '../config/db.js';
import { MongoClient } from 'mongodb';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/sync', requireAuth, async (req, res) => {
  let mongoClient = null;
  try {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not configured');
    mongoClient = new MongoClient(process.env.MONGODB_URI);
    await mongoClient.connect();

    const uriMatch = process.env.MONGODB_URI.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?]*)/);
    const dbName = uriMatch?.[1] || 'wazzup';
    const db = mongoClient.db(dbName);
    const userId = req.user.id;

    // Fetch data from MySQL
    const [profiles] = await pool.execute('SELECT * FROM profiles WHERE user_id = ?', [userId]);
    const [businesses] = await pool.execute('SELECT * FROM businesses WHERE user_id = ?', [userId]);
    const [waAccounts] = await pool.execute('SELECT * FROM whatsapp_accounts WHERE user_id = ?', [userId]);
    const [subscriptions] = await pool.execute('SELECT * FROM subscriptions WHERE user_id = ?', [userId]);

    const profile = profiles[0];
    const business = businesses[0];
    const waAccount = waAccounts[0];
    const subscription = subscriptions[0];

    const userData = {
      sql_user_id: userId,
      email: req.user.email,
      full_name: profile?.full_name || '',
      business: business ? { name: business.name, website: business.website, industry: business.industry } : null,
      whatsapp: waAccount ? { phone_number: waAccount.phone_number, verification_status: waAccount.verification_status } : null,
      subscription: subscription ? { plan: subscription.plan, status: subscription.status } : null,
      last_synced_at: new Date().toISOString(),
    };

    const result = await db.collection('users').updateOne(
      { sql_user_id: userId },
      { $set: userData },
      { upsert: true }
    );

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (mongoClient) await mongoClient.close().catch(() => {});
  }
});

export default router;
