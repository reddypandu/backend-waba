import mongoose from 'mongoose';
import dotenv from 'dotenv';
import WhatsAppAccount from '../models/WhatsAppAccount.js';

dotenv.config();

const cleanup = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // The ID the user just set up manually
    const targetAccountId = '69ce0f853bec951ddebcd53a';
    const targetAccount = await WhatsAppAccount.findById(targetAccountId);
    
    if (!targetAccount) {
      console.error('Target account not found!');
      process.exit(1);
    }
    
    const pnid = targetAccount.phone_number_id;
    console.log(`Cleaning up duplicates for Phone Number ID: ${pnid}`);
    
    // Delete all other accounts with the same phone_number_id
    const result = await WhatsAppAccount.deleteMany({
      phone_number_id: pnid,
      _id: { $ne: new mongoose.Types.ObjectId(targetAccountId) }
    });
    
    console.log('Deleted duplicates count:', result.deletedCount);
    
    // Also remove the trailing space from the target account's access token if it's there
    if (targetAccount.access_token && targetAccount.access_token.endsWith(' ')) {
      console.log('Trimming trailing space from access_token...');
      targetAccount.access_token = targetAccount.access_token.trim();
      await targetAccount.save();
    }
    
    console.log('Cleanup complete.');
    process.exit(0);
  } catch (err) {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  }
};

cleanup();
