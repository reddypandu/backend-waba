import fs from 'fs';
import csv from 'csv-parser';
import Contact from '../models/Contact.js';
import User from '../models/User.js';
import { normalizePhone } from '../utils/phoneUtils.js';

export class ContactController {
  
  static async getContacts(req, res) {
    try {
      const contacts = await Contact.find({ user_id: req.user.id }).sort({ createdAt: -1 });
      res.json({ contacts });
    } catch (err) {
      console.error('getContacts error:', err);
      res.status(500).json({ error: err.message });
    }
  }

  static async createContact(req, res) {
    try {
      const user = await User.findById(req.user.id);
      if ((user?.subscription?.plan || 'paid') === 'free') { // Existing users without a plan are 'paid'
        const count = await Contact.countDocuments({ user_id: req.user.id });
        if (count >= 10) {
          return res.status(403).json({ 
            error: "Free plan limit reached (10 contacts). Please upgrade to add more." 
          });
        }
      }

      const { name, phone_number, email, tags, opt_in_status, custom_attributes } = req.body;

      // Enforce limits for custom fields and tags
      if (tags && Array.isArray(tags) && tags.length > 15) {
        return res.status(400).json({ error: "Maximum 15 tags allowed per contact." });
      }
      if (custom_attributes && Object.keys(custom_attributes).length > 15) {
        return res.status(400).json({ error: "Maximum Auto Replies allowed per contact." });
      }

      if (!phone_number) return res.status(400).json({ error: 'Phone number is required' });

      // Normalize phone number (handle country codes, convert 10-digit to 91+10-digit)
      const cleanedPhone = normalizePhone(phone_number);

      const contact = await Contact.findOneAndUpdate(
        { user_id: req.user.id, phone_number: cleanedPhone },
        { 
          $set: { 
            name, 
            email, 
            tags: tags || [], 
            opt_in_status: opt_in_status || 'opted_in',
            custom_attributes: custom_attributes || {}
          } 
        },
        { upsert: true, new: true }
      );
      res.json({ success: true, contact });
    } catch (err) {
      console.error('createContact error:', err);
      res.status(500).json({ error: err.message });
    }
  }

  static async importCsv(req, res) {
    if (!req.file) return res.status(400).json({ error: 'CSV file required' });
    
    const user = await User.findById(req.user.id);
    const isFree = (user?.subscription?.plan || 'paid') === 'free'; // Existing users without a plan are 'paid'
    let currentCount = isFree ? await Contact.countDocuments({ user_id: req.user.id }) : 0;

    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Use a stream if we have the file on disk (req.file.path from multer)
    // Assuming multer is configured to save to disk or memory. 
    // If memoryStorage is used (like in whatsapp.js), we can use stream-ifier or just string split.
    
    const bufferString = req.file.buffer.toString('utf8');
    const lines = bufferString.split('\n');
    const headers = lines[0]?.split(',').map(h => h.trim().toLowerCase());

    if (!headers || !headers.includes('phone')) {
        return res.status(400).json({ error: 'CSV must contain a "phone" column header' });
    }

    const phoneIdx = headers.indexOf('phone');
    const nameIdx = headers.indexOf('name');
    const emailIdx = headers.indexOf('email');
    const tagsIdx = headers.indexOf('tags'); // comma separated

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const columns = lines[i].split(',');
        
        let phone = columns[phoneIdx]?.trim();
        if (!phone) {
            failCount++;
            continue;
        }

        if (isFree && currentCount >= 10) {
            console.log("Import stopped: Free plan limit reached");
            failCount++;
            continue;
        }
        phone = normalizePhone(phone); // normalize phone number with country code handling

        const name = nameIdx !== -1 ? columns[nameIdx]?.trim() : '';
        const email = emailIdx !== -1 ? columns[emailIdx]?.trim() : '';
        let tags = [];
        if (tagsIdx !== -1 && columns[tagsIdx]) {
            tags = columns[tagsIdx].split(';').map(t => t.trim()).filter(Boolean); // assume semicolons for array
            if (tags.length > 15) tags = tags.slice(0, 15); // Enforce 15 tags limit during import
        }

        try {
            await Contact.findOneAndUpdate(
                { user_id: req.user.id, phone_number: phone },
                { 
                  $set: { 
                      name: name || phone,
                      email: email || undefined
                  },
                  $addToSet: { tags: { $each: tags } } // Merge tags
                },
                { upsert: true }
            );
            successCount++;
            currentCount++;
        } catch(err) {
            console.error('Import row error:', err);
            failCount++;
        }
    }

    res.json({ success: true, imported: successCount, failed: failCount });
  }

  static async updateContact(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      if (updateData.tags && Array.isArray(updateData.tags) && updateData.tags.length > 15) {
        return res.status(400).json({ error: "Maximum 15 tags allowed." });
      }
      if (updateData.custom_attributes && Object.keys(updateData.custom_attributes).length > 15) {
        return res.status(400).json({ error: "Maximum Auto Replies allowed." });
      }

      const contact = await Contact.findOneAndUpdate(
        { _id: id, user_id: req.user.id },
        { $set: updateData },
        { new: true }
      );
      if (!contact) return res.status(404).json({ error: 'Contact not found' });
      res.json({ success: true, contact });
    } catch (err) {
      console.error('updateContact error:', err);
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteContact(req, res) {
    try {
      const { id } = req.params;
      await Contact.findOneAndDelete({ _id: id, user_id: req.user.id });
      res.json({ success: true });
    } catch (err) {
      console.error('deleteContact error:', err);
      res.status(500).json({ error: err.message });
    }
  }
}
