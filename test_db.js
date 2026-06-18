import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;

const WhatsAppAccountSchema = new mongoose.Schema({}, { strict: false });
const WhatsAppAccount = mongoose.model('WhatsAppAccount', WhatsAppAccountSchema);

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected');
  
  const acc = await WhatsAppAccount.findOne({ user_id: new mongoose.Types.ObjectId('6a1ea13122922c38d0a9254d') });
  if (!acc) {
    console.log('Account not found');
  } else {
    console.log('Phone Number ID:', acc.phone_number_id);
    console.log('Access Token exists:', !!acc.access_token);
    
    // Let's try to send a test message with 22-char button
    const endpoint = `https://graph.facebook.com/v22.0/${acc.phone_number_id}/messages`;
    
    const requestBody = {
      messaging_product: "whatsapp",
      to: "919989075666", // User's number from the screenshot
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Test button length" },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "btn1",
                title: "Mobile App Development" // 22 chars
              }
            }
          ]
        }
      }
    };
    
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${acc.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    const data = await r.json();
    console.log('Response Status:', r.status);
    console.log('Response Data:', JSON.stringify(data, null, 2));
  }
  
  await mongoose.disconnect();
}

run();
