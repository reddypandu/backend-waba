import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Otp from '../models/Otp.js';
import { sendOtpEmail } from '../utils/mailer.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// ── OTP Handlers ──────────────────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email is already registered' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.findOneAndUpdate(
      { email },
      { email, otp, createdAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const sent = await sendOtpEmail(email, otp);
    if (!sent) return res.status(500).json({ error: 'Failed to send OTP email. Please check SMTP settings.' });

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and OTP required' });

    const record = await Otp.findOne({ email, otp });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP' });

    if (!req.body.isReset) {
      await Otp.deleteOne({ _id: record._id });
    }
    
    res.json({ success: true, message: 'OTP verified successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Password Reset Handlers ──────────────────────────────────────────────────
router.post('/send-reset-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const exists = await User.findOne({ email });
    if (!exists) return res.status(400).json({ error: 'Email is not registered' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.findOneAndUpdate(
      { email },
      { email, otp, createdAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const sent = await sendOtpEmail(email, otp);
    if (!sent) return res.status(500).json({ error: 'Failed to send OTP email. Please check SMTP settings.' });

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'Email, OTP, and new password required' });
    }

    const record = await Otp.findOne({ email, otp });
    if (!record) return res.status(400).json({ error: 'Invalid or expired OTP' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findOneAndUpdate({ email }, { password: hashedPassword });
    await Otp.deleteOne({ _id: record._id });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Signup ───────────────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ error: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      email,
      password: hashedPassword,
      full_name: full_name || '',
      role: 'user',
      subscription: { plan: 'free', status: 'active', messages_used: 0, start_date: new Date() },
      wallet: { balance: 0 },
    });

    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      user: { id: user._id, email: user.email, full_name: user.full_name, role: user.role },
      token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      user: { id: user._id, email: user.email, full_name: user.full_name, role: user.role },
      token,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
