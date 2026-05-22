import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import User from "../models/User.js";
import Business from "../models/Business.js";
import WhatsAppAccount from "../models/WhatsAppAccount.js";
import Contact from "../models/Contact.js";
import Campaign from "../models/Campaign.js";
import Template from "../models/Template.js";
import Message from "../models/Message.js";
import Upload from "../models/Upload.js";
import Conversation from "../models/Conversation.js";
import { AutoReply, Workflow } from "../models/Automation.js";
import WalletTransaction from "../models/WalletTransaction.js";
import Design from "../models/Design.js";
import {
  syncAccountStatusFromMeta,
  updateAccountWithMetaStatus,
  getDashboardStatus,
  syncAllAccounts,
} from "../utils/meta_status_sync.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ── /me — Full dashboard data ─────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("-password");
    let waAccount = await WhatsAppAccount.findOne({ user_id: userId });
    const business = await Business.findOne({ user_id: userId });
    const [contactCount, campaignCount, templateCount] = await Promise.all([
      Contact.countDocuments({ user_id: userId }),
      Campaign.countDocuments({ user_id: userId }),
      Template.countDocuments({ user_id: userId }),
    ]);
    const transactions = await WalletTransaction.find({ user_id: userId })
      .sort({ createdAt: -1 })
      .limit(20);

    // ENHANCEMENT: Auto-detect messaging activity for existing accounts
    let dashboardStatus = null;
    if (waAccount) {
      let was_messaging = waAccount.was_messaging;
      if (!was_messaging) {
        // Check if account has any messaging activity
        const msgCount = await Message.countDocuments({
          user_id: userId,
          direction: "outbound",
        });
        was_messaging = msgCount > 0;

        // Update the account if we detected messaging (for future calls)
        if (was_messaging && !waAccount.was_messaging) {
          waAccount = await WhatsAppAccount.findByIdAndUpdate(
            waAccount._id,
            {
              was_messaging: true,
            },
            { new: true },
          );
        }
      }

      // Compute dashboard status with auto-detected messaging
      const accountWithMessaging = {
        ...waAccount.toObject(),
        was_messaging,
      };
      dashboardStatus = getDashboardStatus(accountWithMessaging);
    }

    res.json({
      user: {
        id: user._id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      subscription: user.subscription,
      wallet: user.wallet,
      waAccount,
      dashboardStatus,
      business,
      stats: {
        contacts: contactCount,
        campaigns: campaignCount,
        templates: templateCount,
      },
      transactions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Global Users ──────────────────────────────────────────────────
router.get("/users", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Access denied: Requires admin privileges" });
    }
    const users = await User.find().select("-password").sort({ createdAt: -1 });

    const usersWithWA = await Promise.all(
      users.map(async (u) => {
        const wa = await WhatsAppAccount.findOne({ user_id: u._id });
        return {
          ...u.toObject(),
          wa_connected: !!wa?.phone_number_id,
          wa_phone: wa?.phone_number || "",
        };
      }),
    );

    const stats = {
      total_users: users.length,
      total_free: users.filter((u) => u.subscription?.plan === "free").length,
      total_starter: users.filter((u) => u.subscription?.plan === "starter")
        .length,
      total_pro: users.filter((u) => u.subscription?.plan === "pro").length,
    };

    res.json({ users: usersWithWA, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Single User Detail ────────────────────────────────────────────
router.get("/users/:id", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "admin")
      return res.status(403).json({ error: "Access denied" });
    const targetUserId = req.params.id;
    const user = await User.findById(targetUserId).select("-password");
    if (!user) return res.status(404).json({ error: "User not found" });

    const waAccount = await WhatsAppAccount.findOne({ user_id: targetUserId });
    const business = await Business.findOne({ user_id: targetUserId });
    const [
      contactCount,
      campaignCount,
      templateCount,
      messageCount,
      inboundCount,
      outboundCount,
    ] = await Promise.all([
      Contact.countDocuments({ user_id: targetUserId }),
      Campaign.countDocuments({ user_id: targetUserId }),
      Template.countDocuments({ user_id: targetUserId }),
      Message.countDocuments({ user_id: targetUserId }),
      Message.countDocuments({ user_id: targetUserId, direction: "inbound" }),
      Message.countDocuments({ user_id: targetUserId, direction: "outbound" }),
    ]);
    const transactions = await WalletTransaction.find({ user_id: targetUserId })
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      user,
      waAccount,
      business,
      stats: {
        contacts: contactCount,
        campaigns: campaignCount,
        templates: templateCount,
        messages: messageCount,
        inboundMessages: inboundCount,
        outboundMessages: outboundCount,
      },
      transactions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Delete User (Cascade Delete All Data) ──────────────────────────
/**
 * DELETE /api/admin/users/:id
 *
 * ADMIN ONLY: Permanently delete a user and ALL their associated data
 *
 * Deletes:
 * - User account
 * - WhatsApp account
 * - Business profile
 * - Contacts
 * - Conversations
 * - Messages
 * - Campaigns
 * - Templates
 * - Auto-replies
 * - Workflows
 * - Wallet & transactions
 * - Profiles
 *
 * WARNING: This is irreversible!
 */
router.delete("/users/:id", requireAuth, async (req, res) => {
  try {
    // Admin check
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Prevent self-deletion
    if (req.user.id === req.params.id) {
      return res
        .status(400)
        .json({ error: "Cannot delete your own admin account" });
    }

    const userId = req.params.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Log deletion for audit trail
    console.log(
      `[Admin] Deleting user ${userId} (${user.email}) and all associated data`,
    );

    try {
      // Delete in order of dependencies (children first)

      // 1. Delete messages (child of conversations)
      const deletedMessages = await Message.deleteMany({ user_id: userId });
      console.log(`  [Delete] ${deletedMessages.deletedCount} messages`);

      // 2. Delete conversations
      const deletedConversations = await Conversation.deleteMany({
        user_id: userId,
      });
      console.log(
        `  [Delete] ${deletedConversations.deletedCount} conversations`,
      );

      // 3. Delete contacts (child of user)
      const deletedContacts = await Contact.deleteMany({ user_id: userId });
      console.log(`  [Delete] ${deletedContacts.deletedCount} contacts`);

      // 4. Delete campaigns
      const deletedCampaigns = await Campaign.deleteMany({ user_id: userId });
      console.log(`  [Delete] ${deletedCampaigns.deletedCount} campaigns`);

      // 5. Delete templates
      const deletedTemplates = await Template.deleteMany({ user_id: userId });
      console.log(`  [Delete] ${deletedTemplates.deletedCount} templates`);

      // 6. Delete auto-replies
      const deletedAutoReplies = await AutoReply.deleteMany({
        user_id: userId,
      });
      console.log(`  [Delete] ${deletedAutoReplies.deletedCount} auto-replies`);

      // 7. Delete workflows
      const deletedWorkflows = await Workflow.deleteMany({ user_id: userId });
      console.log(`  [Delete] ${deletedWorkflows.deletedCount} workflows`);

      // 8. Delete wallet transactions
      const deletedTransactions = await WalletTransaction.deleteMany({
        user_id: userId,
      });
      console.log(
        `  [Delete] ${deletedTransactions.deletedCount} wallet transactions`,
      );

      // 8.5. Delete user designs
      const deletedDesigns = await Design.deleteMany({ user_id: userId });
      console.log(`  [Delete] ${deletedDesigns.deletedCount} designs`);

      // 9. Delete WhatsApp account
      const deletedWaAccount = await WhatsAppAccount.deleteMany({
        user_id: userId,
      });
      console.log(
        `  [Delete] ${deletedWaAccount.deletedCount} WhatsApp account(s)`,
      );

      // 10. Delete business profile
      const deletedBusiness = await Business.deleteMany({ user_id: userId });
      console.log(
        `  [Delete] ${deletedBusiness.deletedCount} business profile(s)`,
      );

      // 11. Delete user uploads
      const deletedUploads = await Upload.deleteMany({ user_id: userId });
      console.log(`  [Delete] ${deletedUploads.deletedCount} upload records`);

      // 12. Delete user account (last - this is the main entity)
      const deletedUser = await User.findByIdAndDelete(userId);
      console.log(`  [Delete] User account: ${user?.email || userId}`);

      res.json({
        success: true,
        message: `User ${user?.email || userId} and all associated data have been permanently deleted`,
        deleted: {
          messages: deletedMessages.deletedCount,
          conversations: deletedConversations.deletedCount,
          contacts: deletedContacts.deletedCount,
          campaigns: deletedCampaigns.deletedCount,
          templates: deletedTemplates.deletedCount,
          autoReplies: deletedAutoReplies.deletedCount,
          workflows: deletedWorkflows.deletedCount,
          transactions: deletedTransactions.deletedCount,
          designs: deletedDesigns.deletedCount,
          whatsappAccounts: deletedWaAccount.deletedCount,
          uploads: deletedUploads.deletedCount,
          businesses: deletedBusiness.deletedCount,
          user: 1,
        },
        totalItemsDeleted:
          deletedMessages.deletedCount +
          deletedConversations.deletedCount +
          deletedContacts.deletedCount +
          deletedCampaigns.deletedCount +
          deletedTemplates.deletedCount +
          deletedAutoReplies.deletedCount +
          deletedWorkflows.deletedCount +
          deletedTransactions.deletedCount +
          deletedDesigns.deletedCount +
          deletedWaAccount.deletedCount +
          deletedUploads.deletedCount +
          deletedBusiness.deletedCount +
          1,
      });
    } catch (deleteErr) {
      console.error(
        "[Admin Delete User] Cascade delete failed:",
        deleteErr.message,
      );

      // Try to at least delete the user if cascade fails
      try {
        await User.findByIdAndDelete(userId);
        res.status(500).json({
          error:
            "Partial deletion - user account deleted but some associated data could not be removed",
          details: deleteErr.message,
        });
      } catch (userDeleteErr) {
        throw new Error(`Failed to delete user: ${userDeleteErr.message}`);
      }
    }
  } catch (err) {
    console.error("[Admin Delete User] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin: Global Designs ────────────────────────────────────────────────
router.get("/designs", requireAuth, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Access denied: Requires admin privileges" });
    }
    const designs = await Design.find()
      .sort({ createdAt: -1 })
      .populate("user_id", "full_name email");
    res.json(designs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Contacts CRUD ─────────────────────────────────────────────────────────────
router.get("/contacts", requireAuth, async (req, res) => {
  try {
    const contacts = await Contact.find({ user_id: req.user.id }).sort({
      createdAt: -1,
    });
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/contacts", requireAuth, async (req, res) => {
  try {
    const { name, phone_number, email, tags, notes } = req.body;
    const contact = await Contact.findOneAndUpdate(
      { user_id: req.user.id, phone_number },
      {
        $set: { name, email, tags, notes, user_id: req.user.id, phone_number },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/contacts/:id", requireAuth, async (req, res) => {
  try {
    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id },
      req.body,
      { new: true },
    );
    res.json(contact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/contacts/:id", requireAuth, async (req, res) => {
  try {
    await Contact.findOneAndDelete({
      _id: req.params.id,
      user_id: req.user.id,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Templates CRUD ────────────────────────────────────────────────────────────
router.get("/templates", requireAuth, async (req, res) => {
  try {
    const templates = await Template.find({ user_id: req.user.id }).sort({
      createdAt: -1,
    });
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/templates", requireAuth, async (req, res) => {
  try {
    const template = await Template.create({
      ...req.body,
      user_id: req.user.id,
    });
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/templates/:id", requireAuth, async (req, res) => {
  try {
    const template = await Template.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id },
      req.body,
      { new: true },
    );
    res.json(template);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/templates/:id", requireAuth, async (req, res) => {
  try {
    await Template.findOneAndDelete({
      _id: req.params.id,
      user_id: req.user.id,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-Replies CRUD ────────────────────────────────────────────────────────
router.get("/auto-replies", requireAuth, async (req, res) => {
  try {
    res.json(
      await AutoReply.find({ user_id: req.user.id }).sort({ createdAt: -1 }),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/auto-replies", requireAuth, async (req, res) => {
  try {
    const { keyword, match_type = "contains", response } = req.body;
    if (!keyword || !response)
      return res.status(400).json({ error: "keyword and response required" });
    const rule = await AutoReply.create({
      user_id: req.user.id,
      keyword: keyword.trim(),
      match_type,
      response: response.trim(),
    });
    res.json(rule);
  } catch (err) {
    if (err.code === 11000)
      return res.status(400).json({ error: "Keyword already exists" });
    res.status(500).json({ error: err.message });
  }
});

router.put("/auto-replies/:id", requireAuth, async (req, res) => {
  try {
    const rule = await AutoReply.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id },
      req.body,
      { new: true },
    );
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/auto-replies/:id", requireAuth, async (req, res) => {
  try {
    await AutoReply.findOneAndDelete({
      _id: req.params.id,
      user_id: req.user.id,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Workflows CRUD ───────────────────────────────────────────────────────────
router.get("/workflows", requireAuth, async (req, res) => {
  try {
    res.json(
      await Workflow.find({ user_id: req.user.id }).sort({ createdAt: -1 }),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/workflows", requireAuth, async (req, res) => {
  try {
    const wf = await Workflow.create({
      ...req.body,
      user_id: req.user.id,
      actions: req.body.actions || [],
    });
    res.json(wf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/workflows/:id", requireAuth, async (req, res) => {
  try {
    const wf = await Workflow.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user.id },
      req.body,
      { new: true },
    );
    res.json(wf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/workflows/:id", requireAuth, async (req, res) => {
  try {
    await Workflow.findOneAndDelete({
      _id: req.params.id,
      user_id: req.user.id,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Businesses ───────────────────────────────────────────────────────────────
router.post("/businesses", requireAuth, async (req, res) => {
  try {
    const biz = await Business.findOneAndUpdate(
      { user_id: req.user.id },
      {
        $setOnInsert: {
          user_id: req.user.id,
          name: req.body.name || "My Business",
        },
      },
      { upsert: true, new: true },
    );
    res.json({ id: biz._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WhatsApp Accounts ────────────────────────────────────────────────────────
router.post("/whatsapp-accounts", requireAuth, async (req, res) => {
  try {
    const { phone_number_id, waba_id, access_token, phone_number } = req.body;
    if (!phone_number_id || !waba_id || !access_token) {
      return res.status(400).json({
        error: "phone_number_id, waba_id, and access_token are required",
      });
    }
    let biz = await Business.findOne({ user_id: req.user.id });
    if (!biz)
      biz = await Business.create({
        user_id: req.user.id,
        name: "My Business",
      });

    const wa = await WhatsAppAccount.findOneAndUpdate(
      { user_id: req.user.id },
      {
        phone_number_id,
        waba_id,
        access_token,
        phone_number,
        business_id: biz._id,
        verification_status: "pending",
      },
      { upsert: true, new: true },
    );
    res.json({ success: true, id: wa._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Meta Business Profile ──────────────────────────────────────────────────
router.get("/whatsapp-profile", requireAuth, async (req, res) => {
  try {
    const forceSync = req.query.sync === "true";
    if (!forceSync) {
      const biz = await Business.findOne({ user_id: req.user.id });
      if (biz && (biz.about || biz.description || biz.email || biz.address)) {
        // Return cached from local DB
        return res.json({
          about: biz.about,
          address: biz.address,
          description: biz.description,
          email: biz.email,
          websites: biz.websites,
          vertical: biz.vertical,
          profile_picture_url: biz.profile_picture_url,
          name: biz.name,
        });
      }
    }

    const wa = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!wa || !wa.phone_number_id) return res.json({}); // Default empty if not set up

    // Fetch profile from Meta
    const r = await fetch(
      `https://graph.facebook.com/v24.0/${wa.phone_number_id}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
      {
        headers: { Authorization: `Bearer ${wa.access_token}` },
      },
    );
    const data = await r.json();
    console.log(
      "[Meta Profile Fetch] Status:",
      r.status,
      "Payload:",
      JSON.stringify(data),
    );

    if (!r.ok) {
      console.error("Meta Profile Sync Error:", data.error);
      if (forceSync) {
        return res
          .status(400)
          .json({ error: data.error?.message || "Meta API error" });
      }
      return res.json({});
    }

    // Resilience: Meta sometimes returns { data: [...] } and sometimes the object directly
    const metaData = Array.isArray(data.data)
      ? data.data[0]
      : data.about || data.email || data.websites
        ? data
        : {};

    if (Object.keys(metaData).length > 0) {
      // Save to DB
      await Business.findOneAndUpdate(
        { user_id: req.user.id },
        {
          about: metaData.about || "",
          address: metaData.address || "",
          description: metaData.description || "",
          email: metaData.email || "",
          websites: metaData.websites || [],
          vertical: metaData.vertical || "",
          profile_picture_url: metaData.profile_picture_url || "",
        },
        { upsert: true },
      );

      // Mark account as verified
      await WhatsAppAccount.findOneAndUpdate(
        { user_id: req.user.id },
        { verification_status: "verified" },
      );
      console.log(
        `[Meta Profile Fetch] Account ${wa.phone_number_id} marked as verified.`,
      );
    }

    const biz = await Business.findOne({ user_id: req.user.id });
    if (biz) {
      metaData.name = biz.name;
    }

    res.json(metaData);
  } catch (err) {
    console.error("[Meta Profile Fetch] Critical Error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/whatsapp-profile", requireAuth, async (req, res) => {
  try {
    const wa = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!wa || !wa.phone_number_id)
      return res.status(404).json({ error: "WhatsApp not configured" });

    const { about, address, description, email, websites, vertical } = req.body;

    // Update Meta Profile
    const r = await fetch(
      `https://graph.facebook.com/v24.0/${wa.phone_number_id}/whatsapp_business_profile`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${wa.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          about,
          address,
          description,
          email,
          websites,
          vertical,
        }),
      },
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || "Meta API error");

    // Save to DB locally
    await Business.findOneAndUpdate(
      { user_id: req.user.id },
      { about, address, description, email, websites, vertical },
      { upsert: true },
    );

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/whatsapp-profile-picture",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file provided" });

      const wa = await WhatsAppAccount.findOne({ user_id: req.user.id });
      if (!wa || !wa.phone_number_id)
        return res.status(404).json({ error: "WhatsApp not configured" });

      const appId = process.env.META_APP_ID;

      const sessRes = await fetch(
        `https://graph.facebook.com/v24.0/${appId}/uploads?file_length=${file.size}&file_type=${file.mimetype}&access_token=${wa.access_token}`,
        {
          method: "POST",
        },
      );
      const sessData = await sessRes.json();
      if (sessData.error) throw new Error(sessData.error.message);

      const upRes = await fetch(
        `https://graph.facebook.com/v24.0/${sessData.id}`,
        {
          method: "POST",
          headers: {
            Authorization: `OAuth ${wa.access_token}`,
            file_offset: "0",
          },
          body: file.buffer,
        },
      );
      const upData = await upRes.json();
      if (upData.error) throw new Error(upData.error.message);

      const setRes = await fetch(
        `https://graph.facebook.com/v24.0/${wa.phone_number_id}/whatsapp_business_profile`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${wa.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            profile_picture_handle: upData.h,
          }),
        },
      );

      const setData = await setRes.json();
      if (!setRes.ok)
        throw new Error(
          setData.error?.message || "Meta API error setting profile picture",
        );

      // Save locally for UI to display (since Meta often omits it on sync)
      const fs = await import("fs");
      const path = await import("path");
      const assetPath = path.resolve(
        "..",
        "frontend-waba",
        "public",
        "uploads",
      );
      if (!fs.existsSync(assetPath))
        fs.mkdirSync(assetPath, { recursive: true });

      const ext = file.mimetype === "image/jpeg" ? ".jpg" : ".png";
      const filename = `profile_${wa.phone_number_id}_${Date.now()}${ext}`;
      fs.writeFileSync(path.join(assetPath, filename), file.buffer);

      const localUrl = `/uploads/${filename}`;

      // Update local DB instantly
      await Business.findOneAndUpdate(
        { user_id: req.user.id },
        { profile_picture_url: localUrl },
        { upsert: true },
      );

      // Return the new data or a success flag
      res.json({
        success: true,
        message: "Profile picture updated successfully",
        profile_picture_url: localUrl,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
);

// ── SAFE Meta Status Sync (NEW) ──────────────────────────────────────────────
/**
 * GET /api/admin/whatsapp-status/sync
 *
 * SAFE: Syncs WhatsApp account status from Meta without re-registering
 *
 * Returns:
 * - meta_wa_status: actual status from Meta
 * - is_meta_test_number: true if Meta temporary test number
 * - was_messaging: true if account already has sent messages
 * - dashboard_status: user-friendly status for frontend
 * - should_register: true ONLY if safe to register (rare case)
 *
 * SAFETY: Never re-registers already working numbers or test numbers
 */
router.get("/whatsapp-status/sync", requireAuth, async (req, res) => {
  try {
    const waAccount = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!waAccount) {
      return res.status(400).json({ error: "WhatsApp account not connected" });
    }

    // Safely sync status from Meta API
    const syncResult = await syncAccountStatusFromMeta(waAccount);

    // Update local DB with synced status
    const updated = await updateAccountWithMetaStatus(waAccount, syncResult);

    // Get dashboard-friendly status
    const dashboardStatus = getDashboardStatus(updated);

    res.json({
      success: true,
      phone_number: waAccount.phone_number,
      phone_number_id: waAccount.phone_number_id,
      meta_wa_status: syncResult.metaStatus,
      is_meta_test_number: syncResult.isTestNumber,
      was_messaging: syncResult.isMessaging,
      dashboard_status: dashboardStatus,
      should_register: syncResult.shouldRegister,
      last_synced: syncResult.timestamp,
      message: syncResult.shouldRegister
        ? "Phone number needs registration. Call /register API to complete setup."
        : syncResult.isTestNumber
          ? "This is a Meta test number for development/testing only."
          : "Account status synced from Meta. " +
            (syncResult.isMessaging
              ? "Messaging is working."
              : "Waiting for first message."),
    });
  } catch (err) {
    console.error("[Whatsapp Status] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/whatsapp-status
 *
 * Get current WhatsApp account status (from local DB)
 * SAFE: Read-only, no API calls or updates
 */
router.get("/whatsapp-status", requireAuth, async (req, res) => {
  try {
    const waAccount = await WhatsAppAccount.findOne({ user_id: req.user.id });
    if (!waAccount) {
      return res.status(400).json({ error: "WhatsApp account not connected" });
    }

    // IMPORTANT: Auto-detect messaging activity for existing accounts
    // (Old accounts created before this fix won't have was_messaging set)
    let was_messaging = waAccount.was_messaging;
    if (!was_messaging) {
      // Check if account has any messaging activity
      const msgCount = await Message.countDocuments({
        user_id: req.user.id,
        direction: "outbound",
      });
      was_messaging = msgCount > 0;

      // Update the account if we detected messaging (for future calls)
      if (was_messaging && !waAccount.was_messaging) {
        await WhatsAppAccount.findByIdAndUpdate(waAccount._id, {
          was_messaging: true,
        });
      }
    }

    // Get dashboard-friendly status
    // Create a temporary object with the auto-detected messaging flag
    const accountWithMessaging = {
      ...waAccount.toObject(),
      was_messaging,
    };
    const dashboardStatus = getDashboardStatus(accountWithMessaging);

    res.json({
      success: true,
      phone_number: waAccount.phone_number,
      phone_number_id: waAccount.phone_number_id,
      waba_id: waAccount.waba_id,
      webhook_verified: waAccount.webhook_verified,
      meta_wa_status: waAccount.meta_wa_status || waAccount.verification_status,
      is_meta_test_number: waAccount.is_meta_test_number || false,
      was_messaging: was_messaging,
      dashboard_status: dashboardStatus,
      meta_status_last_synced: waAccount.meta_status_last_synced,
      created_at: waAccount.createdAt,
      updated_at: waAccount.updatedAt,
    });
  } catch (err) {
    console.error("[Whatsapp Status] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/whatsapp-register
 *
 * SAFE: Only registers if actually needed
 *
 * Checks:
 * 1. Not a Meta test number
 * 2. Not already messaging
 * 3. Status is pending/action_required
 * 4. Has valid access token
 *
 * Request body: { force?: boolean }
 * - force=true: Attempt registration even if checks fail (admin override)
 */
router.post("/whatsapp-register", requireAuth, async (req, res) => {
  try {
    const { force } = req.body;
    const waAccount = await WhatsAppAccount.findOne({ user_id: req.user.id });

    if (!waAccount) {
      return res.status(400).json({ error: "WhatsApp account not connected" });
    }

    if (!waAccount.access_token) {
      return res
        .status(400)
        .json({ error: "Access token missing. Please reconnect." });
    }

    // Sync latest status from Meta
    const syncResult = await syncAccountStatusFromMeta(waAccount);
    const updated = await updateAccountWithMetaStatus(waAccount, syncResult);

    // SAFETY CHECKS
    if (!force) {
      if (syncResult.isTestNumber) {
        return res.json({
          success: false,
          reason: "test_number",
          message: "This is a Meta test number. No registration needed.",
          is_meta_test_number: true,
        });
      }

      if (syncResult.isMessaging) {
        return res.json({
          success: false,
          reason: "already_messaging",
          message:
            "Account already has messaging activity. No re-registration needed.",
          was_messaging: true,
        });
      }

      if (syncResult.metaStatus === "connected") {
        return res.json({
          success: false,
          reason: "already_connected",
          message: "Account is already connected to Meta WhatsApp.",
          meta_wa_status: "connected",
        });
      }

      if (!syncResult.shouldRegister) {
        return res.json({
          success: false,
          reason: "cannot_register",
          message: `Cannot register: current status is "${syncResult.metaStatus}". Contact Meta support.`,
          meta_wa_status: syncResult.metaStatus,
        });
      }
    }

    // Attempt registration via Meta API
    try {
      const META_API = "https://graph.facebook.com/v24.0";
      const registerRes = await fetch(
        `${META_API}/${waAccount.phone_number_id}/register`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${waAccount.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            pin: process.env.WHATSAPP_PHONE_PIN || "123456",
          }),
        },
      );

      const data = await registerRes.json();

      if (!registerRes.ok) {
        throw new Error(data.error?.message || "Meta registration API error");
      }

      // Mark as verified after successful registration
      await WhatsAppAccount.findByIdAndUpdate(waAccount._id, {
        $set: {
          verification_status: "verified",
          meta_wa_status: "connected",
        },
      });

      res.json({
        success: true,
        message: "Phone number registration initiated with Meta.",
        meta_response: data,
      });
    } catch (metaErr) {
      console.error("[Register] Meta API error:", metaErr.message);
      res.status(400).json({
        success: false,
        error: metaErr.message,
        hint: "Please contact your Meta partner or check the phone number status in Meta WhatsApp Manager.",
      });
    }
  } catch (err) {
    console.error("[Register] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/whatsapp-status/sync-all (ADMIN ONLY)
 *
 * Batch sync all user accounts from Meta
 * Use for maintenance/diagnostics
 */
router.post("/whatsapp-status/sync-all", requireAuth, async (req, res) => {
  try {
    // Admin check (optional - add your admin check here)
    const user = await User.findById(req.user.id);
    if (user?.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const results = await syncAllAccounts();
    res.json({
      success: true,
      message: "Batch sync complete",
      total: results.length,
      results,
    });
  } catch (err) {
    console.error("[Sync All] Error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
