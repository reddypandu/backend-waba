import { Router } from 'express';
import Design from '../models/Design.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Get all designs (User's private designs + Public templates)
router.get('/', requireAuth, async (req, res) => {
    try {
        const designs = await Design.find({
            $or: [
                { user_id: req.user.id },
                { type: 'template', is_public: true }
            ]
        }).sort({ updatedAt: -1 });
        res.json(designs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get a single design
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const design = await Design.findOne({
            _id: req.params.id,
            $or: [
                { user_id: req.user.id },
                { is_public: true }
            ]
        });
        if (!design) return res.status(404).json({ error: 'Design not found' });
        res.json(design);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new design
router.post('/', requireAuth, async (req, res) => {
    try {
        const { name, data, type, is_public, category, thumbnail_url } = req.body;
        const isAdmin = req.user.role === 'admin';

        const design = await Design.create({
            user_id: req.user.id,
            name,
            data,
            type: isAdmin && type === 'template' ? 'template' : 'user',
            is_public: isAdmin ? !!is_public : false,
            category,
            thumbnail_url
        });
        res.status(201).json(design);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update a design
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { name, data, type, is_public, category, thumbnail_url } = req.body;
        const isAdmin = req.user.role === 'admin';

        const updateData = { name, data, category, thumbnail_url };
        if (isAdmin) {
            if (type !== undefined) updateData.type = type;
            if (is_public !== undefined) updateData.is_public = is_public;
        }

        const design = await Design.findOneAndUpdate(
            { _id: req.params.id, user_id: req.user.id },
            updateData,
            { new: true }
        );
        if (!design) return res.status(404).json({ error: 'Design not found or unauthorized' });
        res.json(design);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a design
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const design = await Design.findOneAndDelete({ _id: req.params.id, user_id: req.user.id });
        if (!design) return res.status(404).json({ error: 'Design not found or unauthorized' });
        res.json({ message: 'Design deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Alias endpoints to match specific requirements (Point 13)
router.post('/save-design', requireAuth, async (req, res) => {
    try {
        const { name, data, thumbnail_url } = req.body;
        const design = await Design.create({
            user_id: req.user.id,
            name: name || "Untitled Design",
            data,
            thumbnail_url
        });
        res.status(201).json(design);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/get-design/:id', requireAuth, async (req, res) => {
    try {
        const design = await Design.findOne({ _id: req.params.id, user_id: req.user.id });
        if (!design) return res.status(404).json({ error: 'Design not found' });
        res.json(design);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
