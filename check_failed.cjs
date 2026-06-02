require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const Message = mongoose.model('Message', new mongoose.Schema({}, {strict: false}));
  const msgs = await Message.find({status: 'failed'}).sort({createdAt: -1}).limit(5);
  console.log('Failed messages:', JSON.stringify(msgs, null, 2));

  const templates = await mongoose.model('Template', new mongoose.Schema({}, {strict: false})).find({name: 'test_tg'}).limit(1);
  console.log('Template test_tg:', JSON.stringify(templates, null, 2));
  process.exit(0);
});
