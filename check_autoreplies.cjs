const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });

const AutoReplySchema = new mongoose.Schema({
  keyword: String,
  match_type: String,
  response: String,
  is_active: Boolean
});

const AutoReply = mongoose.model('AutoReply', AutoReplySchema);

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('DB Connected');
    
    const rules = await AutoReply.find({});
    console.log(`Found ${rules.length} Auto-Reply rules:`);
    rules.forEach(r => {
      console.log(` - Keyword/s: "${r.keyword}", Type: ${r.match_type}, Active: ${r.is_active}, Response: ${r.response}`);
    });
  } catch (e) {
    console.error(e);
  } finally {
    mongoose.connection.close();
  }
}

run();
