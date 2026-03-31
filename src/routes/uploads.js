import { Router } from 'express';
import Upload from '../models/Upload.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Get all uploads for the user
router.get('/', requireAuth, async (req, res) => {
    try {
        const uploads = await Upload.find({ user_id: req.user.id }).sort({ createdAt: -1 });
        res.json(uploads);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save a new upload record
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, url, format, size } = req.body;
        const upload = await Upload.create({
            user_id: req.user.id,
            name,
            url,
            format,
            size
        });
        res.status(201).json(upload);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete an upload
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const upload = await Upload.findOneAndDelete({ _id: req.params.id, user_id: req.user.id });
        if (!upload) return res.status(404).json({ error: 'Upload not found or unauthorized' });
        res.json({ message: 'Upload deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
