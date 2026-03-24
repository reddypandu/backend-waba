import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import connectDB from './config/db.js';
import whatsappRoutes from './routes/whatsapp.js';
import webhookRoutes from './routes/webhook.js';
import razorpayRoutes from './routes/razorpay.js';
import subscriptionRoutes from './routes/subscription.js';
import cloudinaryRoutes from './routes/cloudinary.js';
import otpRoutes from './routes/otp.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';

// Connect to MongoDB
connectDB();

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], credentials: true }));
app.options('*', cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ── Request Logging ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// ── Rate Limiting ────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Please try again after an hour.' },
  skip: (req) => req.method === 'OPTIONS',
});
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 100,
  skip: (req) => req.method === 'OPTIONS',
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/otp', apiLimiter, otpRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/razorpay', razorpayRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/upload', cloudinaryRoutes);
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => res.json({ message: 'Backend API is running', version: '2.0.0', db: 'MongoDB' }));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5005;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
