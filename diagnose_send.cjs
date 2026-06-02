require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const WA = mongoose.model('WA', new mongoose.Schema({}, {strict: false}), 'whatsappaccounts');
  
  // Get the account used for the latest campaign
  const Campaign = mongoose.model('Campaign', new mongoose.Schema({}, {strict: false}));
  const campaign = await Campaign.findOne().sort({createdAt: -1});
  console.log('=== Latest Campaign ===');
  console.log('  user_id:', campaign.user_id);
  console.log('  template:', campaign.template_name);
  console.log('  status:', campaign.status);
  
  const account = await WA.findOne({user_id: campaign.user_id});
  console.log('\n=== WhatsApp Account for Campaign User ===');
  console.log('  phone_number:', account.phone_number);
  console.log('  phone_number_id:', account.phone_number_id);
  console.log('  waba_id:', account.waba_id);
  console.log('  meta_wa_status:', account.meta_wa_status);
  console.log('  was_messaging:', account.was_messaging);
  console.log('  is_meta_test_number:', account.is_meta_test_number);
  
  // Check phone number status on Meta
  console.log('\n=== Checking Phone Number on Meta ===');
  const phoneRes = await fetch(
    `https://graph.facebook.com/v22.0/${account.phone_number_id}?fields=id,display_phone_number,verified_name,quality_rating,is_official_business_account,code_verification_status,name_status,messaging_limit_tier`,
    { headers: { Authorization: `Bearer ${account.access_token}` } }
  );
  const phoneData = await phoneRes.json();
  console.log('  Meta Phone Data:', JSON.stringify(phoneData, null, 2));

  // Check templates on THIS WABA
  console.log('\n=== Templates on WABA', account.waba_id, '===');
  const tplRes = await fetch(
    `https://graph.facebook.com/v22.0/${account.waba_id}/message_templates?limit=100`,
    { headers: { Authorization: `Bearer ${account.access_token}` } }
  );
  const tplData = await tplRes.json();
  if (tplData.data) {
    tplData.data.forEach(t => {
      console.log(`  - ${t.name} (${t.language}, ${t.status})`);
    });
  } else {
    console.log('  Error:', JSON.stringify(tplData));
  }

  // Try sending a test message
  console.log('\n=== Test Send to 918008457750 ===');
  const testRes = await fetch(
    `https://graph.facebook.com/v22.0/${account.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: '918008457750',
        type: 'template',
        template: {
          name: campaign.template_name,
          language: { code: 'en' },
          components: campaign.components || []
        }
      })
    }
  );
  const testData = await testRes.json();
  console.log('  Status:', testRes.status);
  console.log('  Response:', JSON.stringify(testData, null, 2));

  process.exit(0);
});
