import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/waba_tool").then(async () => {
  const Contact = mongoose.model('Contact', new mongoose.Schema({}, { strict: false }));
  const contacts = await Contact.find({ phone_number: { $regex: '8008457750' } });
  console.log(contacts);
  process.exit();
});
