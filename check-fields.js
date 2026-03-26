import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const ms = await mongoose.connection.db.collection('messages').find({}).toArray();
  console.log('--- ALL MESSAGES FIELDS ---');
  ms.forEach(m => {
    console.log(`Msg ID: ${m._id}, Fields: ${Object.keys(m).join(', ')}, Phone: ${m.phone_number}`);
  });
  process.exit(0);
}
check();
