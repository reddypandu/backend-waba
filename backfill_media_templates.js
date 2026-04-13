import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { uploadToCloudinary } from './src/services/cloudinary.js';
import Template from './src/models/Template.js';

dotenv.config();

async function backfill() {
  let count = 0;
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB for media backfill.');

    const templates = await Template.find({ 
      local_url: { $eq: null } 
    });

    console.log(`Found ${templates.length} templates with missing local_url.`);

    for (const t of templates) {
      if (!t.components) continue;
      
      const header = t.components.find(c => c.type === 'HEADER');
      if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(header.format)) {
        const exampleUrl = header.example?.header_handle?.[0] || header.example?.header_url?.[0];
        
        if (exampleUrl) {
          console.log(`Uploading missing ${header.format} for template "${t.name}" (User ID: ${t.user_id})...`);
          try {
            const cloudinaryUrl = await uploadToCloudinary(exampleUrl);
            t.local_url = cloudinaryUrl;
            await t.save();
            console.log(`✅ Success: ${cloudinaryUrl}`);
            count++;
          } catch (err) {
            console.error(`❌ Failed to upload for "${t.name}":`, err.message);
          }
        } else {
           console.log(`⚠️ Template "${t.name}" has media header but no example URL to extract from.`);
        }
      }
    }
  } catch (e) {
    console.error('Error during backfill:', e);
  } finally {
    console.log(`Finished processing. Backfilled ${count} templates.`);
    mongoose.connection.close();
  }
}

backfill();
