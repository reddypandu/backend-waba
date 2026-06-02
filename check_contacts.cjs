const mongoose = require('mongoose');
const fs = require('fs');

const envRaw = fs.readFileSync('.env', 'utf8');
const mongoUri = envRaw.split('\n').find(l => l.startsWith('MONGODB_URI=')).split('=').slice(1).join('=');

mongoose.connect(mongoUri, { family: 4 })
  .then(async function() {
    var collections = await mongoose.connection.db.listCollections().toArray();
    console.log('Collections:', collections.map(function(c) { return c.name; }));

    var contactCount = await mongoose.connection.db.collection('contacts').countDocuments();
    console.log('Total contacts:', contactCount);

    var sampleContacts = await mongoose.connection.db.collection('contacts').find({}).limit(3).toArray();
    console.log('Sample contacts:', JSON.stringify(sampleContacts.map(function(c) {
      return { id: c._id.toString(), phone: c.phone_number, opt_in: c.opt_in_status };
    }), null, 2));

    var campaign = await mongoose.connection.db.collection('campaigns').findOne({ _id: new mongoose.Types.ObjectId('6a1d772b7331f8534941c080') });
    if (campaign && campaign.contact_ids) {
      console.log('Campaign contact_ids count:', campaign.contact_ids.length);
      var ids = campaign.contact_ids.map(function(id) { return typeof id === 'object' ? id.toString() : String(id); });
      console.log('First 3 contact IDs:', ids.slice(0, 3));
      var matches = await mongoose.connection.db.collection('contacts').find({ _id: { $in: ids.map(function(id) { return new mongoose.Types.ObjectId(id); }) } }).toArray();
      console.log('Matching contacts for campaign:', matches.length);
    }

    mongoose.connection.close();
  })
  .catch(function(e) { console.error(e); process.exit(1); });
