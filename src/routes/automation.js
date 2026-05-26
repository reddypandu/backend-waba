import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { AutomationController } from '../controllers/automationController.js';

const router = Router();

// AutoReplies
router.get('/auto-replies', requireAuth, AutomationController.getAutoReplies);
router.post('/auto-replies', requireAuth, AutomationController.createAutoReply);
router.put('/auto-replies/:id', requireAuth, AutomationController.updateAutoReply);
router.delete('/auto-replies/:id', requireAuth, AutomationController.deleteAutoReply);

// Workflows
router.get('/workflows', requireAuth, AutomationController.getWorkflows);
router.post('/workflows', requireAuth, AutomationController.createWorkflow);
router.put('/workflows/:id', requireAuth, AutomationController.updateWorkflow);
router.delete('/workflows/:id', requireAuth, AutomationController.deleteWorkflow);

export default router;
