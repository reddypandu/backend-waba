import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requirePlan } from '../middleware/planMiddleware.js';
import { AutomationController } from '../controllers/automationController.js';

const router = Router();

// AutoReplies
router.get('/auto-replies', requireAuth, requirePlan(['growth', 'professional']), AutomationController.getAutoReplies);
router.post('/auto-replies', requireAuth, requirePlan(['growth', 'professional']), AutomationController.createAutoReply);
router.put('/auto-replies/:id', requireAuth, requirePlan(['growth', 'professional']), AutomationController.updateAutoReply);
router.delete('/auto-replies/:id', requireAuth, requirePlan(['growth', 'professional']), AutomationController.deleteAutoReply);

// Workflows
router.get('/workflows', requireAuth, requirePlan(['professional']), AutomationController.getWorkflows);
router.post('/workflows', requireAuth, requirePlan(['professional']), AutomationController.createWorkflow);
router.put('/workflows/:id', requireAuth, requirePlan(['professional']), AutomationController.updateWorkflow);
router.delete('/workflows/:id', requireAuth, requirePlan(['professional']), AutomationController.deleteWorkflow);

export default router;
