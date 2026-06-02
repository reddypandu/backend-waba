require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Message = mongoose.model('Message', new mongoose.Schema({}, {strict: false}));
  
  const lastWebhookUpdate = await Message.findOne({status: {$in: ['delivered', 'read', 'failed']}}).sort({updatedAt: -1});
  console.log('Last message updated by webhook:', JSON.stringify(lastWebhookUpdate, null, 2));
  
  process.exit(0);
});
