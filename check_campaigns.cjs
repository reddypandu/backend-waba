const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });

const CampaignSchema = new mongoose.Schema({
  name: String,
  status: String,
  schedule_type: String,
  scheduled_at: Date
});

const Campaign = mongoose.model('Campaign', CampaignSchema);

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('DB Connected');
    
    const campaigns = await Campaign.find({ status: { $in: ['scheduled', 'draft', 'launch_queued'] } });
    console.log(`Found ${campaigns.length} potential campaigns:`);
    campaigns.forEach(c => {
      console.log(` - Name: ${c.name}, Status: ${c.status}, Type: ${c.schedule_type}, Scheduled At: ${c.scheduled_at} (Raw: ${c.scheduled_at?.toISOString()})`);
    });
    
    console.log('Current Server Time (UTC):', new Date().toISOString());
  } catch (e) {
    console.error(e);
  } finally {
    mongoose.connection.close();
  }
}

run();
