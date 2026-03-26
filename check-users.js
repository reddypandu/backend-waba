import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const UserSchema = new mongoose.Schema({ email: String });
const User = mongoose.models.User || mongoose.model('User', UserSchema);

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find({});
  console.log('All Users:', JSON.stringify(users, null, 2));
  process.exit(0);
}
check();
