const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });

const Message = mongoose.model('Message', new mongoose.Schema({ 
  status: String, 
  campaign_id: mongoose.Schema.Types.ObjectId,
  user_id: mongoose.Schema.Types.ObjectId
}));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const msgs = await Message.find({ status: 'failed' });
  console.log(`Found ${msgs.length} failed messages total.`);
  msgs.forEach(m => {
    console.log(` - MsgID: ${m._id}, CampaignID: ${m.campaign_id}, UserID: ${m.user_id}`);
  });
  mongoose.connection.close();
}
run();
