import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function repair() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find the first user (usually the one being used in this tool)
    const User = mongoose.model('User', new mongoose.Schema({ email: String }));
    const activeUser = await User.findOne();
    if (!activeUser) {
       console.log('No user found to attribute to');
       process.exit(0);
    }
    console.log('Attributing to user:', activeUser.email);

    const Conversation = mongoose.model('Conversation', new mongoose.Schema({ user_id: mongoose.Schema.Types.ObjectId, contact_id: mongoose.Schema.Types.ObjectId }));
    const result = await Conversation.updateMany(
      { user_id: { $exists: false } },
      { $set: { user_id: activeUser._id } }
    );
    console.log(`Updated ${result.modifiedCount} conversations with user_id.`);

    const msgResult = await mongoose.model('Message', new mongoose.Schema({ user_id: mongoose.Schema.Types.ObjectId })).updateMany(
      { user_id: { $exists: false } },
      { $set: { user_id: activeUser._id } }
    );
    console.log(`Updated ${msgResult.modifiedCount} messages with user_id.`);

    process.exit(0);
  } catch (err) {
    console.error('Repair failed:', err);
    process.exit(1);
  }
}
repair();
