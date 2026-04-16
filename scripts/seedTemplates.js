import 'dotenv/config';
import mongoose from 'mongoose';
import Design from '../src/models/Design.js';

const templates = [
  {
    name: "Flash Sale - 50% Off",
    category: "Marketing",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#ff4757" },
        { type: "i-text", text: "FLASH SALE", left: 250, top: 150, originX: "center", fontSize: 60, fontWeight: "bold", fill: "#ffffff" },
        { type: "i-text", text: "UP TO 50% OFF", left: 250, top: 250, originX: "center", fontSize: 40, fill: "#ffffff" },
        { type: "i-text", text: "SHOP NOW", left: 250, top: 380, originX: "center", fontSize: 24, fill: "#ffffff", underline: true }
      ]
    }
  },
  {
    name: "Appointment Reminder",
    category: "Health",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1505751172107-573225a94043?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#f1f2f6" },
        { type: "i-text", text: "Appointment Reminder", left: 50, top: 50, fontSize: 32, fontWeight: "bold", fill: "#2f3542" },
        { type: "i-text", text: "Hi [Name],\nJust a reminder for your\nappointment tomorrow at 10 AM.", left: 50, top: 150, fontSize: 24, fill: "#57606f" },
        { type: "i-text", text: "Reply YES to confirm", left: 250, top: 400, originX: "center", fontSize: 20, fill: "#2f3542", italic: true }
      ]
    }
  },
  {
    name: "Luxury Property Listing",
    category: "Real Estate",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#ffffff" },
        { type: "rect", left: 0, top: 0, width: 500, height: 100, fill: "#1e272e" },
        { type: "i-text", text: "NEW LISTING", left: 250, top: 50, originX: "center", originY: "center", fontSize: 40, fill: "#ffffff", charSpacing: 200 },
        { type: "i-text", text: "4 Bedroom | 3 Bathroom | Pool", left: 50, top: 150, fontSize: 24, fill: "#1e272e" },
        { type: "i-text", text: "$850,000", left: 50, top: 200, fontSize: 36, fontWeight: "bold", fill: "#ffa801" },
        { type: "i-text", text: "Contact for viewing", left: 50, top: 400, fontSize: 18, fill: "#808e9b" }
      ]
    }
  },
  {
    name: "Welcome Onboard",
    category: "Business",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1522071823991-b99c223a7092?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#3742fa" },
        { type: "i-text", text: "WELCOME!", left: 250, top: 200, originX: "center", fontSize: 70, fontWeight: "bold", fill: "#ffffff" },
        { type: "i-text", text: "We are excited to have you with us.", left: 250, top: 300, originX: "center", fontSize: 20, fill: "#ffffff" }
      ]
    }
  },
  {
    name: "New Product Launch",
    category: "E-commerce",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#ffffff" },
        { type: "circle", left: 200, top: 50, radius: 100, fill: "#fbc531" },
        { type: "i-text", text: "NEW", left: 300, top: 150, originX: "center", fontSize: 40, fontWeight: "bold", angle: 15, fill: "#e84118" },
        { type: "i-text", text: "THE NEXT GEN HEADPHONES", left: 250, top: 300, originX: "center", fontSize: 24, fill: "#2f3640" },
        { type: "i-text", text: "Exclusive access available now", left: 250, top: 350, originX: "center", fontSize: 16, fill: "#7f8c8d" }
      ]
    }
  },
  {
    name: "Webinar Invitation",
    category: "Events",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1540317580384-e5d43616b9aa?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#130f40" },
        { type: "i-text", text: "FREE WEBINAR", left: 50, top: 50, fontSize: 32, fill: "#badc58", fontWeight: "bold" },
        { type: "i-text", text: "Mastering WhatsApp Business", left: 50, top: 120, fontSize: 40, fill: "#ffffff", fontWeight: "bold", width: 400 },
        { type: "i-text", text: "Date: Friday, Oct 25\nTime: 4 PM IST", left: 50, top: 250, fontSize: 24, fill: "#dff9fb" },
        { type: "rect", left: 50, top: 400, width: 200, height: 50, fill: "#ff7979", rx: 10, ry: 10 },
        { type: "i-text", text: "REGISTER", left: 150, top: 425, originX: "center", originY: "center", fontSize: 20, fill: "#ffffff" }
      ]
    }
  },
  {
    name: "Restaurant Reservation",
    category: "Food",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#2d3436" },
        { type: "i-text", text: "YOUR TABLE IS READY", left: 250, top: 100, originX: "center", fontSize: 36, fill: "#fdcb6e", fontWeight: "bold" },
        { type: "i-text", text: "Reservation for 2 at 8:00 PM", left: 250, top: 200, originX: "center", fontSize: 24, fill: "#ffffff" },
        { type: "i-text", text: "The Grand Bistro", left: 250, top: 300, originX: "center", fontSize: 18, italic: true, fill: "#b2bec3" }
      ]
    }
  },
  {
    name: "Yoga Session",
    category: "Wellness",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#ffffff" },
        { type: "rect", left: 0, top: 0, width: 500, height: 300, fill: "#7bed9f" },
        { type: "i-text", text: "MORNING YOGA", left: 250, top: 150, originX: "center", fontSize: 48, fill: "#ffffff", fontWeight: "bold" },
        { type: "i-text", text: "Join us tomorrow at 6 AM", left: 250, top: 350, originX: "center", fontSize: 24, fill: "#2f3542" },
        { type: "i-text", text: "Mindfulness and Peace", left: 250, top: 420, originX: "center", fontSize: 18, fill: "#57606f" }
      ]
    }
  },
  {
    name: "Workshop Announcement",
    category: "Education",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#a29bfe" },
        { type: "i-text", text: "AI WORKSHOP", left: 250, top: 50, originX: "center", fontSize: 40, fill: "#ffffff", fontWeight: "bold" },
        { type: "i-text", text: "Learn to build\nintelligent agents.", left: 50, top: 150, fontSize: 32, fill: "#ffffff", width: 400 },
        { type: "i-text", text: "Limited slots available!", left: 50, top: 350, fontSize: 20, fill: "#dfe6e9" }
      ]
    }
  },
  {
    name: "Feedback Request",
    category: "Service",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#f1f2f6" },
        { type: "i-text", text: "Help us improve", left: 250, top: 100, originX: "center", fontSize: 36, fill: "#2f3542", fontWeight: "bold" },
        { type: "i-text", text: "How was your experience with us?", left: 250, top: 200, originX: "center", fontSize: 24, fill: "#747d8c", width: 400 },
        { type: "i-text", text: "⭐⭐⭐⭐⭐", left: 250, top: 300, originX: "center", fontSize: 50 }
      ]
    }
  },
  {
    name: "Abandoned Cart",
    category: "Marketing",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1557821552-17105176677c?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#ffeaa7" },
        { type: "i-text", text: "Wait!", left: 250, top: 100, originX: "center", fontSize: 60, fontWeight: "bold", fill: "#d63031" },
        { type: "i-text", text: "You left something in your cart.", left: 250, top: 200, originX: "center", fontSize: 24, fill: "#2d3436" },
        { type: "i-text", text: "Get 10% off if you order now!", left: 250, top: 300, originX: "center", fontSize: 20, fill: "#2d3436" },
        { type: "i-text", text: "Use code: RECOVER10", left: 250, top: 400, originX: "center", fontSize: 28, fontWeight: "bold", fill: "#e17055" }
      ]
    }
  },
  {
    name: "Order Confirmation",
    category: "E-commerce",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1534452203294-49c831bb6738?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#ffffff" },
        { type: "rect", left: 0, top: 0, width: 500, height: 120, fill: "#00b894" },
        { type: "i-text", text: "ORDER CONFIRMED", left: 250, top: 60, originX: "center", originY: "center", fontSize: 32, fill: "#ffffff", fontWeight: "bold" },
        { type: "i-text", text: "Hi [Name], your order #1234\nhas been successfully placed.", left: 50, top: 180, fontSize: 22, fill: "#2d3436" },
        { type: "i-text", text: "View Order Status", left: 250, top: 400, originX: "center", fontSize: 18, underline: true, fill: "#0984e3" }
      ]
    }
  },
  {
    name: "Holiday Greeting",
    category: "Greeting",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1543507320-f559288f3469?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#d63031" },
        { type: "i-text", text: "HAPPY HOLIDAYS", left: 250, top: 150, originX: "center", fontSize: 50, fontWeight: "bold", fill: "#ffffff" },
        { type: "i-text", text: "Wishing you a season full of light and laughter.", left: 250, top: 250, originX: "center", fontSize: 18, fill: "#ffffff", width: 350 },
        { type: "i-text", text: "❄️ 🎄 🎁", left: 250, top: 350, originX: "center", fontSize: 60 }
      ]
    }
  },
  {
    name: "Special Deal - BOGO",
    category: "Marketing",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#6c5ce7" },
        { type: "i-text", text: "B O G O", left: 250, top: 150, originX: "center", fontSize: 80, fontWeight: "bold", fill: "#ffffff" },
        { type: "i-text", text: "BUY ONE GET ONE FREE", left: 250, top: 250, originX: "center", fontSize: 30, fill: "#a29bfe" },
        { type: "i-text", text: "Valid on all accessories", left: 250, top: 350, originX: "center", fontSize: 18, fill: "#ffffff" }
      ]
    }
  },
  {
    name: "Customer Support Info",
    category: "Service",
    type: "template",
    is_public: true,
    thumbnail_url: "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=400",
    data: {
      version: "6.5.4",
      objects: [
        { type: "rect", left: 0, top: 0, width: 500, height: 500, fill: "#f1f2f6" },
        { type: "i-text", text: "WE ARE HERE TO HELP", left: 50, top: 100, fontSize: 32, fontWeight: "bold", fill: "#3742fa" },
        { type: "i-text", text: "Support Hours:\nMon - Fri: 9 AM - 6 PM\nSat: 10 AM - 2 PM", left: 50, top: 200, fontSize: 24, fill: "#2f3542" },
        { type: "i-text", text: "Call us: +1 (800) 123-4567", left: 50, top: 400, fontSize: 20, fill: "#747d8c" }
      ]
    }
  }
];

async function seed() {
  try {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/connectly';
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Remove existing templates to avoid duplicates (optional, based on preference)
    // await Design.deleteMany({ type: 'template' });
    
    let count = 0;
    for (const t of templates) {
      const exists = await Design.findOne({ name: t.name, type: 'template' });
      if (!exists) {
        await Design.create(t);
        count++;
      }
    }

    console.log(`✅ Successfully seeded ${count} new templates!`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    process.exit(1);
  }
}

seed();
