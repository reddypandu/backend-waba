import express from 'express';
import { poolPromise } from '../config/db.js';

const router = express.Router();

// Mock sync-mongodb
router.post('/sync_mongodb', async (req, res) => {
    console.log("Syncing MongoDB (Mocked):", req.body);
    res.json({ success: true, message: "User synced to mock MongoDB" });
});

// Mock admin-users
router.get('/admin_users', async (req, res) => {
    const pool = await poolPromise;
    try {
        const [rows] = await pool.query('SELECT * FROM Profiles');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mock whatsapp-otp
router.post('/whatsapp_otp', async (req, res) => {
    console.log("Sending OTP (Mocked):", req.body);
    res.json({ success: true, message: "OTP sent (Mocked)" });
});

export default router;
