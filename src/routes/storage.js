import express from 'express';
import multer from 'multer';
import { uploadToCloudinary } from '../services/cloudinary.js';
import fs from 'fs';

const router = express.Router();
const upload = multer({ dest: '/tmp/' }); // Using temp directory

router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    
    try {
        const url = await uploadToCloudinary(req.file.path);
        // Clean up local file
        fs.unlinkSync(req.file.path);
        res.json({ url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
