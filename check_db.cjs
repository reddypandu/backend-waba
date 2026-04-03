const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });

const TemplateSchema = new mongoose.Schema({
  name: String,
  local_url: String,
  components: Array
});

const Template = mongoose.model('Template', TemplateSchema);

async function run() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('DB Connected');
    
    const t = await Template.findOne({ name: 'service_temp' });
    if (!t) {
      console.log('service_temp not found');
    } else {
      console.log('service_temp Details:');
      console.log(' - ID:', t._id);
      console.log(' - local_url:', t.local_url);
      console.log(' - components:', JSON.stringify(t.components, null, 2));
    }
  } catch (e) {
    console.error(e);
  } finally {
    mongoose.connection.close();
  }
}

run();
