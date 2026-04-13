const mongoose = require('mongoose');
require('dotenv').config({ path: 'e:/downloads/whatsapp tool/wazpp-sai/waba-tool/backend-waba/.env' });
const Template = require('./src/models/Template.js').default || require('./src/models/Template.js');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const t = await mongoose.model('Template').findOne({ 'components.type': 'HEADER', 'components.format': { $in: ['IMAGE', 'VIDEO', 'DOCUMENT'] } });
  if (t) {
    const header = t.components.find(c => c.type === 'HEADER');
    console.log(JSON.stringify({ name: t.name, header_format: header.format, example: header.example }, null, 2));
  } else {
    console.log('No media templates found.');
  }
  mongoose.connection.close();
}
run();
