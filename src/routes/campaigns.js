import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { CampaignController } from '../controllers/campaignController.js';

const router = Router();

router.get('/', requireAuth, CampaignController.getCampaigns);
router.post('/', requireAuth, CampaignController.createCampaign);
router.get('/:id', requireAuth, CampaignController.getCampaignById);
router.delete('/:id', requireAuth, CampaignController.deleteCampaign);
router.post('/:id/send', requireAuth, CampaignController.sendCampaign);
router.post('/:id/status', requireAuth, CampaignController.updateCampaignStatus);
router.get('/:id/stats', requireAuth, CampaignController.getCampaignStats);
router.post('/:id/retarget', requireAuth, CampaignController.retargetFailed);

export default router;
