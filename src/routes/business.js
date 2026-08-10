import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { BusinessWorkflowController } from '../controllers/businessWorkflowController.js';

const router = Router();

// Public routes for mini-webapp (No requireAuth)
router.get('/slots/:workflowId', BusinessWorkflowController.getAvailableSlots);
router.post('/book/:workflowId/:conversationId', BusinessWorkflowController.bookSlot);
router.get('/transaction/:transactionId', BusinessWorkflowController.getTransaction);
router.post('/pay/:transactionId', BusinessWorkflowController.confirmPayment);

// Admin routes
router.get('/transactions', requireAuth, BusinessWorkflowController.getAdminTransactions);

export default router;
