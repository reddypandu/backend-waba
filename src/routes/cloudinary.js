import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) throw new Error('No file provided');
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP' });
    }

    const { CLOUDINARY_CLOUD_NAME: CLOUD_NAME, CLOUDINARY_API_KEY: API_KEY, CLOUDINARY_API_SECRET: API_SECRET } = process.env;
    if (!CLOUD_NAME || !API_KEY || !API_SECRET) throw new Error('Cloudinary not configured');

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = 'whatsapp-templates';
    const signature = crypto
      .createHash('sha1')
      .update(`folder=${folder}&timestamp=${timestamp}${API_SECRET}`)
      .digest('hex');

    const base64 = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
    const resourceType = req.body.resource_type || 'auto';

    const uploadForm = new FormData();
    uploadForm.append('file', base64);
    uploadForm.append('api_key', API_KEY);
    uploadForm.append('timestamp', timestamp);
    uploadForm.append('signature', signature);
    uploadForm.append('folder', folder);

    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`, {
      method: 'POST',
      body: uploadForm,
    });
    const result = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(result?.error?.message || 'Cloudinary upload failed');

    res.json({ url: result.secure_url, public_id: result.public_id, resource_type: result.resource_type });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
