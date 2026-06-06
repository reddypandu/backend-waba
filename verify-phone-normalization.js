/**
 * Verification script to check if all phone numbers are properly normalized
 * after running the migration and code fixes.
 *
 * Run with: node verify-phone-normalization.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Contact from './src/models/Contact.js';
import Conversation from './src/models/Conversation.js';
import Message from './src/models/Message.js';
import { normalizePhone } from './src/utils/phoneUtils.js';

dotenv.config();

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waba');
    console.log('✓ Connected to MongoDB\n');
  } catch (err) {
    console.error('✗ MongoDB connection failed:', err.message);
    process.exit(1);
  }
};

const verifyPhoneFormat = (phone) => {
  // Valid format: 91XXXXXXXXXX (starts with 91 and is 12 digits)
  return /^91\d{10}$/.test(phone);
};

const checkContacts = async () => {
  console.log('📋 Checking Contacts...');
  const contacts = await Contact.find({});
  
  let valid = 0;
  let invalid = 0;
  const invalidPhones = [];

  for (const contact of contacts) {
    if (verifyPhoneFormat(contact.phone_number)) {
      valid++;
    } else {
      invalid++;
      invalidPhones.push({
        _id: contact._id,
        phone: contact.phone_number,
        shouldBe: normalizePhone(contact.phone_number),
      });
    }
  }

  console.log(`  ✓ Valid format (91XXXXXXXXXX): ${valid}`);
  if (invalid > 0) {
    console.log(`  ❌ Invalid format: ${invalid}`);
    console.log('     First 5 issues:');
    invalidPhones.slice(0, 5).forEach(item => {
      console.log(`     - "${item.phone}" should be "${item.shouldBe}"`);
    });
    if (invalidPhones.length > 5) {
      console.log(`     ... and ${invalidPhones.length - 5} more`);
    }
  }
  
  return { valid, invalid, invalidCount: invalidPhones.length };
};

const checkConversations = async () => {
  console.log('\n💬 Checking Conversations...');
  const conversations = await Conversation.find({});
  
  let valid = 0;
  let invalid = 0;
  const invalidPhones = [];

  for (const conv of conversations) {
    if (conv.phone_number && verifyPhoneFormat(conv.phone_number)) {
      valid++;
    } else if (conv.phone_number) {
      invalid++;
      invalidPhones.push({
        _id: conv._id,
        phone: conv.phone_number,
        shouldBe: normalizePhone(conv.phone_number),
      });
    }
  }

  console.log(`  ✓ Valid format (91XXXXXXXXXX): ${valid}`);
  if (invalid > 0) {
    console.log(`  ❌ Invalid format: ${invalid}`);
    console.log('     First 5 issues:');
    invalidPhones.slice(0, 5).forEach(item => {
      console.log(`     - "${item.phone}" should be "${item.shouldBe}"`);
    });
  }
  
  return { valid, invalid, invalidCount: invalidPhones.length };
};

const checkMessages = async () => {
  console.log('\n📝 Checking Messages...');
  const messages = await Message.find({}).limit(1000);
  
  let valid = 0;
  let invalid = 0;
  const invalidPhones = [];

  for (const msg of messages) {
    if (msg.phone_number && verifyPhoneFormat(msg.phone_number)) {
      valid++;
    } else if (msg.phone_number) {
      invalid++;
      if (invalidPhones.length < 5) {
        invalidPhones.push({
          _id: msg._id,
          phone: msg.phone_number,
          shouldBe: normalizePhone(msg.phone_number),
        });
      }
    }
  }

  console.log(`  ✓ Valid format (91XXXXXXXXXX): ${valid}`);
  if (invalid > 0) {
    console.log(`  ❌ Invalid format: ${invalid}`);
    if (invalidPhones.length > 0) {
      console.log('     First 5 issues:');
      invalidPhones.forEach(item => {
        console.log(`     - "${item.phone}" should be "${item.shouldBe}"`);
      });
    }
  }
  
  return { valid, invalid, invalidCount: invalidPhones.length };
};

const checkDuplicates = async () => {
  console.log('\n🔍 Checking for Duplicate Phone Numbers...');
  
  const duplicates = await Contact.aggregate([
    {
      $group: {
        _id: '$phone_number',
        count: { $sum: 1 },
        users: { $push: '$user_id' },
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]);

  if (duplicates.length === 0) {
    console.log('  ✓ No duplicates found! All phone numbers are unique per user.');
    return 0;
  } else {
    console.log(`  ⚠️  Found ${duplicates.length} phone numbers with duplicates:`);
    duplicates.forEach(dup => {
      console.log(`     - Phone ${dup._id}: ${dup.count} occurrences`);
    });
    return duplicates.length;
  }
};

const main = async () => {
  console.log('🔧 Phone Number Normalization Verification\n');
  console.log('='.repeat(50));

  await connectDB();

  const contactStats = await checkContacts();
  const convStats = await checkConversations();
  const msgStats = await checkMessages();
  const duplicateCount = await checkDuplicates();

  console.log('\n' + '='.repeat(50));
  console.log('📊 Summary:');
  console.log(`   Contacts: ${contactStats.valid}/${contactStats.valid + contactStats.invalid} valid`);
  console.log(`   Conversations: ${convStats.valid}/${convStats.valid + convStats.invalid} valid`);
  console.log(`   Messages: ${msgStats.valid}/${msgStats.valid + msgStats.invalid} valid (sampled)`);
  console.log(`   Duplicates: ${duplicateCount}`);

  if (contactStats.invalid === 0 && convStats.invalid === 0 && duplicateCount === 0) {
    console.log('\n✅ All phone numbers are properly normalized!');
    console.log('   Your chats should now group correctly by contact.\n');
  } else {
    console.log('\n⚠️  Some issues found. You may need to:');
    if (contactStats.invalid > 0 || convStats.invalid > 0) {
      console.log('   1. Run normalize-existing-phones.js again');
    }
    if (duplicateCount > 0) {
      console.log('   2. Check for duplicate entries in your database\n');
    }
  }

  await mongoose.connection.close();
};

main().catch(err => {
  console.error('❌ Verification failed:', err);
  process.exit(1);
});
