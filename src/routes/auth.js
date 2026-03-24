import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

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
