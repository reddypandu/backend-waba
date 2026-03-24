import { Router } from 'express';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

// Create Razorpay order — both /order and /create-order are supported
router.post('/order', requireAuth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (typeof amount !== 'number' || amount < 100 || amount > 50000) {
      return res.status(400).json({ error: 'Invalid amount. Must be between ₹100 and ₹50,000.' });
    }
    const amountInPaise = Math.round(amount * 100);
    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
      body: JSON.stringify({
        amount: amountInPaise, currency: 'INR',
        receipt: `wallet_${Date.now()}`.slice(0, 40),
        notes: { user_id: req.user.id, purpose: 'wallet_recharge' },
      }),
    });
    const rzpOrder = await rzpRes.json();
    if (!rzpRes.ok) throw new Error(rzpOrder.error?.description || 'Failed to create order');
    res.json({ order_id: rzpOrder.id, amount: amountInPaise, currency: 'INR', key_id: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify payment and recharge wallet
router.post('/verify', requireAuth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount, base_amount } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment verification fields' });
    }

    // Verify signature
    const signatureData = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(signatureData)
      .digest('hex');
    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const creditAmount = Math.round((base_amount || amount) * 100) / 100;
    
    // MySQL Transaction for safe wallet update
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      
      const [wallets] = await connection.execute('SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE', [req.user.id]);
      const wallet = wallets[0];
      if (!wallet) throw new Error('Wallet not found');

      const newBalance = Number(wallet.balance) + creditAmount;
      await connection.execute('UPDATE wallets SET balance = ? WHERE id = ?', [newBalance, wallet.id]);
      
      await connection.execute(
        'INSERT INTO wallet_transactions (user_id, wallet_id, type, amount, balance_after, description, reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.user.id, wallet.id, 'recharge', creditAmount, newBalance, `Wallet recharge of ₹${creditAmount}`, razorpay_payment_id]
      );

      await connection.commit();
      res.json({ success: true, balance: newBalance });
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aliases for frontend compatibility
router.post('/create-order', (req, res, next) => { req.url = '/order'; next(); });
router.post('/verify-payment', (req, res, next) => { req.url = '/verify'; next(); });

export default router;
