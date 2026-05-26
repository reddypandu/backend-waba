import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleMiddleware.js';
import { TeamController } from '../controllers/teamController.js';

const router = Router();

// Only admin/manager can manage teams
router.get('/', requireAuth, requireRole(['admin', 'manager']), TeamController.getTeamMembers);
router.post('/invite', requireAuth, requireRole(['admin', 'manager']), TeamController.inviteAgent);
router.put('/:id/role', requireAuth, requireRole(['admin', 'manager']), TeamController.updateRole);

export default router;
