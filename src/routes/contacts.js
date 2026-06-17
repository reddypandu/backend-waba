import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth.js';
import { ContactController } from '../controllers/contactController.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/', requireAuth, ContactController.getContacts);
router.post('/', requireAuth, ContactController.createContact);
router.put('/:id', requireAuth, ContactController.updateContact);
router.delete('/:id', requireAuth, ContactController.deleteContact);
router.post('/import', requireAuth, upload.single('file'), ContactController.importCsv);
router.post('/batch', requireAuth, ContactController.batchCreate);

export default router;
