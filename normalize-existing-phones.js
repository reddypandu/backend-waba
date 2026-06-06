/**
 * Migration script to normalize all existing phone numbers in Contact and Conversation collections
 * Fixes inconsistent phone number formats (+91 vs 91 vs 10-digit) so they all show in the same chat
 *
 * Run with: node normalize-existing-phones.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Contact from './src/models/Contact.js';
import Conversation from './src/models/Conversation.js';
import { normalizePhone } from './src/utils/phoneUtils.js';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waba');
    console.log('✓ Connected to MongoDB');
  } catch (err) {
    console.error('✗ MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

const normalizeContacts = async () => {
  console.log('\n📋 Normalizing Contacts...');
  const contacts = await Contact.find({});
  console.log(`Found ${contacts.length} contacts`);

  let updated = 0;
  let duplicates = 0;

  for (const contact of contacts) {
    const normalized = normalizePhone(contact.phone_number);
    
    if (normalized !== contact.phone_number) {
      // Check if a contact with normalized number already exists
      const existing = await Contact.findOne({
        user_id: contact.user_id,
        phone_number: normalized,
        _id: { $ne: contact._id }
      });

      if (existing) {
        console.log(`  ⚠️  Duplicate found for ${contact.phone_number} → ${normalized}`);
        console.log(`     Merging into existing contact: ${existing._id}`);
        
        // Merge data: update all conversations and messages to point to existing contact
        await Conversation.updateMany(
          { contact_id: contact._id },
          { contact_id: existing._id }
        );
        
        // Delete the duplicate contact
        await Contact.deleteOne({ _id: contact._id });
        duplicates++;
      } else {
        // Just normalize the phone number
        contact.phone_number = normalized;
        await contact.save();
        console.log(`  ✓ Normalized: ${contact.phone_number} → ${normalized}`);
        updated++;
      }
    }
  }

  console.log(`\n✓ Contacts: ${updated} updated, ${duplicates} duplicates merged`);
  return { updated, duplicates };
};

const normalizeConversations = async () => {
  console.log('\n💬 Normalizing Conversations...');
  const conversations = await Conversation.find({});
  console.log(`Found ${conversations.length} conversations`);

  let updated = 0;

  for (const conv of conversations) {
    if (conv.phone_number) {
      const normalized = normalizePhone(conv.phone_number);
      
      if (normalized !== conv.phone_number) {
        conv.phone_number = normalized;
        await conv.save();
        console.log(`  ✓ Normalized: ${conv.phone_number} → ${normalized}`);
        updated++;
      }
    }
  }

  console.log(`\n✓ Conversations: ${updated} updated`);
  return updated;
};

const main = async () => {
  console.log('🔧 Phone Number Normalization Migration');
  console.log('='.repeat(50));

  await connectDB();

  const contactStats = await normalizeContacts();
  const convStats = await normalizeConversations();

  console.log('\n' + '='.repeat(50));
  console.log('✅ Migration Complete!');
  console.log(`   - Contacts updated: ${contactStats.updated}`);
  console.log(`   - Duplicates merged: ${contactStats.duplicates}`);
  console.log(`   - Conversations updated: ${convStats}`);
  console.log('\n💡 Tip: All phone numbers are now normalized to: 91XXXXXXXXXX format');
  console.log('   Same contacts will now appear in the same chat!\n');

  await mongoose.connection.close();
};

main().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
