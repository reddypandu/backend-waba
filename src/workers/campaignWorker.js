import Campaign from '../models/Campaign.js';
import { sendCampaign } from '../utils/campaign.js';

/**
 * Background worker to check for scheduled campaigns and start them
 */
export async function startCampaignWorker() {
  console.log('🕒 Campaign Worker initialized (running every 60s)');
  
  // Every 60 seconds
  setInterval(async () => {
    try {
      const now = new Date();
      // Find campaigns with a past scheduled time that haven't been processed yet
      const pendingCampaigns = await Campaign.find({
        status: { $in: ['scheduled', 'draft', 'launch_queued'] },
        schedule_type: 'later',
        scheduled_at: { $lte: now }
      });
      
      if (pendingCampaigns.length > 0) {
        console.log(`[Worker] Found ${pendingCampaigns.length} campaigns due for launch.`);
        for (const camp of pendingCampaigns) {
          console.log(`[Worker] Auto-launching campaign: ${camp.name} (ID: ${camp._id})`);
          await sendCampaign(camp._id);
        }
      }
    } catch (err) {
      console.error('[Worker Error] Unhandled error in campaign worker:', err);
    }
  }, 60000); 
}
