import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePlan } from '../middleware/planMiddleware.js';
import { AutomationController } from '../controllers/automationController.js';

const router = Router();

// AutoReplies
router.get('/auto-replies', requireAuth, requirePlan(['paid']), AutomationController.getAutoReplies);
router.post('/auto-replies', requireAuth, requirePlan(['paid']), AutomationController.createAutoReply);
router.put('/auto-replies/:id', requireAuth, requirePlan(['paid']), AutomationController.updateAutoReply);
router.delete('/auto-replies/:id', requireAuth, requirePlan(['paid']), AutomationController.deleteAutoReply);

// Workflows
router.get('/workflows', requireAuth, requirePlan(['paid']), AutomationController.getWorkflows);
router.post('/workflows', requireAuth, requirePlan(['paid']), AutomationController.createWorkflow);
router.put('/workflows/:id', requireAuth, requirePlan(['paid']), AutomationController.updateWorkflow);
router.delete('/workflows/:id', requireAuth, requirePlan(['paid']), AutomationController.deleteWorkflow);

export default router;
