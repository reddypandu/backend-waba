/**
 * Central phone number normalization utility.
 * All phone numbers should go through this before saving to DB or querying.
 *
 * Rules:
 *   1. Strip all non-digit characters (+, spaces, dashes, brackets, etc.)
 *   2. If the result is a 10-digit Indian number (no country code), prepend "91"
 *   3. Return the cleaned digits-only string
 *
 * This ensures every phone number in the database is stored in a consistent
 * format like "918008457750" — never "+918008457750" or "8008457750".
 */
export function normalizePhone(raw = "") {
  let digits = String(raw).replace(/\D/g, "");

  // Indian 10-digit numbers without country code → prepend 91
  if (digits.length === 10) {
    digits = "91" + digits;
  }

  return digits;
}

/**
 * Find a contact by phone number, trying normalized match first,
 * then falling back to a suffix-based regex search.
 * This prevents duplicate contacts when the same number is stored
 * in different formats (e.g. "8008457750" vs "918008457750").
 *
 * If no contact is found, one is created with the normalized number.
 *
 * @param {string} userId - The user's ObjectId
 * @param {string} rawPhone - The raw phone number (from webhook, UI, etc.)
 * @param {string} [name] - Optional name for new contacts
 * @returns {Promise<Document>} The contact document
 */
export async function findOrCreateContact(Contact, userId, rawPhone, name) {
  const normalized = normalizePhone(rawPhone);
  const last10 = normalized.slice(-10);

  // 1. Try exact match on normalized number
  let contact = await Contact.findOne({ user_id: userId, phone_number: normalized });

  // 2. Try suffix match (catches "8008457750" when we're looking for "918008457750")
  if (!contact && last10.length === 10) {
    contact = await Contact.findOne({
      user_id: userId,
      phone_number: { $regex: new RegExp(last10 + "$") },
    });

    // If found with old format, update its phone_number to the normalized version
    if (contact && contact.phone_number !== normalized) {
      console.log(`[PhoneUtils] Normalizing contact phone: ${contact.phone_number} → ${normalized}`);
      contact.phone_number = normalized;
      await contact.save();
    }
  }

  // 3. Create new contact if not found
  if (!contact) {
    contact = await Contact.create({
      user_id: userId,
      phone_number: normalized,
      name: name || normalized,
      opt_in_status: "opted_in",
    });
  }

  return contact;
}
