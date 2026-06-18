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
import { cloudinary } from "../services/cloudinary.js";
import {
  attemptRegistrationIfNeeded,
  syncAccountStatusFromMeta,
  updateAccountWithMetaStatus,
  getDashboardStatus,
  syncAllAccounts,
} from "../utils/meta_status_sync.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const STATUS_SYNC_CACHE_MS = 60 * 1000;
const statusSyncInFlight = new Set();

const secondsUntil = (date) =>
  Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 1000));

const legacyUserIdFilter = (userId) => ({
  $expr: { $eq: [{ $toString: "$user_id" }, String(userId)] },
});

const extractCloudinaryPublicId = (url) => {
  if (!url || typeof url !== "string" || !url.includes("cloudinary.com")) {
    return null;
  }

  try {
    const pathname = new URL(url).pathname;
    const uploadIndex = pathname.indexOf("/upload/");
    if (uploadIndex === -1) return null;

    let publicPath = pathname.slice(uploadIndex + "/upload/".length);
    publicPath = publicPath.replace(/^v\d+\//, "");
    publicPath = decodeURIComponent(publicPath);
    return publicPath.replace(/\.[^/.]+$/, "");
  } catch {
    return null;
  }
};

const deleteCloudinaryAssetsForUser = async (userId, urls = []) => {
  const result = {
    prefixDeleted: 0,
    urlDeleted: 0,
    failed: [],
  };

  try {
    const prefixResult = await cloudinary.api.delete_resources_by_prefix(
      `user-${userId}/`,
      { resource_type: "image" },
    );
    result.prefixDeleted = Object.keys(prefixResult?.deleted || {}).length;
  } catch (err) {
    result.failed.push(`prefix:user-${userId} (${err.message})`);
  }

  const publicIds = [
    ...new Set(urls.map(extractCloudinaryPublicId).filter(Boolean)),
  ];

  await Promise.all(
    publicIds.map(async (publicId) => {
      try {
        const destroyResult = await cloudinary.uploader.destroy(publicId, {
          resource_type: "image",
        });
        if (destroyResult?.result === "ok") result.urlDeleted += 1;
      } catch (err) {
        result.failed.push(`${publicId} (${err.message})`);
      }
    }),
  );

  return result;
};

// ── /me — Full dashboard data ─────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select("-password");
    let waAccount = await WhatsAppAccount.findOne({ user_id: userId });
    const business = await Business.findOne({ user_id: userId });
    const [contactCount, campaignCount, templateCount] = await Promise.all([
      Contact.countDocuments(legacyUserIdFilter(userId)),
      Campaign.countDocuments(legacyUserIdFilter(userId)),
      Template.countDocuments(legacyUserIdFilter(userId)),
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
          ...legacyUserIdFilter(userId),
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

    const daysRequested = [7, 30, 90].includes(parseInt(req.query.days, 10))
      ? parseInt(req.query.days, 10)
      : 30;
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - daysRequested + 1);

    const messageStatsAgg = await Message.aggregate([
      {
        $match: {
          ...legacyUserIdFilter(userId),
          direction: "outbound",
          createdAt: { $gte: sinceDate },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          sent: {
            $sum: {
              $cond: [
                { $in: ["$status", ["sent", "delivered", "read", "replied"]] },
                1,
                0,
              ],
            },
          },
          delivered: {
            $sum: {
              $cond: [
                { $in: ["$status", ["delivered", "read", "replied"]] },
                1,
                0,
              ],
            },
          },
          read: {
            $sum: {
              $cond: [
                { $in: ["$status", ["read", "replied"]] },
                1,
                0,
              ],
            },
          },
          failed: {
            $sum: {
              $cond: [{ $eq: ["$status", "failed"] }, 1, 0],
            },
          },
        },
      },
    ]);

    const messageStats = messageStatsAgg[0] || {
      total: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
    };

    const dailyMessages = await Message.aggregate([
      {
        $match: {
          ...legacyUserIdFilter(userId),
          direction: "outbound",
          createdAt: { $gte: sinceDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          sent: {
            $sum: {
              $cond: [
                { $in: ["$status", ["sent", "delivered", "read", "replied"]] },
                1,
                0,
              ],
            },
          },
          delivered: {
            $sum: {
              $cond: [
                { $in: ["$status", ["delivered", "read", "replied"]] },
                1,
                0,
              ],
            },
          },
          read: {
            $sum: {
              $cond: [
                { $in: ["$status", ["read", "replied"]] },
                1,
                0,
              ],
            },
          },
          failed: {
            $sum: {
              $cond: [{ $eq: ["$status", "failed"] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const dailyMap = Object.fromEntries(
      dailyMessages.map((item) => [
        item._id,
        {
          sent: item.sent,
          delivered: item.delivered,
          read: item.read,
          failed: item.failed,
        },
      ]),
    );

    const chartData = [];
    for (let i = 0; i < daysRequested; i += 1) {
      const currentDate = new Date(sinceDate);
      currentDate.setDate(sinceDate.getDate() + i);
      const isoDate = currentDate.toISOString().slice(0, 10);
      const dayData = dailyMap[isoDate] || { sent: 0, delivered: 0, read: 0, failed: 0 };
      chartData.push({
        name: currentDate.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
        ...dayData,
      });
    }

    const usageStartDate = user.subscription?.start_date
      ? new Date(user.subscription.start_date)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const messagesUsed = await Message.countDocuments({
      ...legacyUserIdFilter(userId),
      direction: 'outbound',
      createdAt: { $gte: usageStartDate },
    });

    const subscription = {
      plan: user.subscription?.plan || 'paid', // Default existing users to 'paid' if plan is not set
      status: user.subscription?.status || 'active',
      messages_used: messagesUsed,
      start_date: user.subscription?.start_date || new Date(),
      end_date: user.subscription?.end_date,
    };

    if (!user.subscription?.plan) {
      await User.findByIdAndUpdate(userId, { subscription }, { new: true });
    }

    res.json({
      user: {
        id: user._id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      subscription,
      wallet: user.wallet,
      waAccount,
      dashboardStatus,
      business,
      stats: {
        contacts: contactCount,
        campaigns: campaignCount,
        templates: templateCount,
      },
      messageStats,
      chartData,
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
        const userObject = u.toObject();
        if (userObject.role === "admin") {
          userObject.subscription = undefined;
        } else if (!userObject.subscription?.plan) {
          userObject.subscription = { // Default existing users to 'paid' if plan is not set
            plan: "paid",
            status: "active",
            messages_used: 0,
            start_date: userObject.subscription?.start_date || new Date(),
          };
        }
        return {
          ...userObject,
          wa_connected: !!wa?.phone_number_id,
          wa_phone: wa?.phone_number || "",
        };
      }),
    );

    const activeUsers = users.filter((u) => u.role !== "admin");
    const stats = {
      total_users: users.length,
      total_free: activeUsers.filter((u) => (u.subscription?.plan || "paid") === "free").length, // Count 'free' explicitly
      total_paid: activeUsers.filter((u) => (u.subscription?.plan || "paid") === "paid").length, // Count 'paid' explicitly
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
      Contact.countDocuments(legacyUserIdFilter(targetUserId)),
      Campaign.countDocuments(legacyUserIdFilter(targetUserId)),
      Template.countDocuments(legacyUserIdFilter(targetUserId)),
      Message.countDocuments(legacyUserIdFilter(targetUserId)),
      Message.countDocuments({
        ...legacyUserIdFilter(targetUserId),
        direction: "inbound",
      }),
      Message.countDocuments({
        ...legacyUserIdFilter(targetUserId),
        direction: "outbound",
      }),
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
      const [uploads, designs, templates, businesses] = await Promise.all([
        Upload.find({ user_id: userId }).select("url"),
        Design.find({ user_id: userId }).select("thumbnail_url"),
        Template.find({ user_id: userId }).select("local_url header_content"),
        Business.find({ user_id: userId }).select("profile_picture_url"),
      ]);

      const cloudinaryUrls = [
        ...uploads.map((item) => item.url),
        ...designs.map((item) => item.thumbnail_url),
        ...templates.flatMap((item) => [item.local_url, item.header_content]),
        ...businesses.map((item) => item.profile_picture_url),
      ].filter(Boolean);

      const cloudinaryDeleted = await deleteCloudinaryAssetsForUser(
        userId,
        cloudinaryUrls,
      );
      console.log(
        `  [Cloudinary] deleted ${cloudinaryDeleted.prefixDeleted + cloudinaryDeleted.urlDeleted} assets; failures: ${cloudinaryDeleted.failed.length}`,
      );

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
          cloudinaryAssets:
            cloudinaryDeleted.prefixDeleted + cloudinaryDeleted.urlDeleted,
          cloudinaryFailures: cloudinaryDeleted.failed,
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
          cloudinaryDeleted.prefixDeleted +
          cloudinaryDeleted.urlDeleted +
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
    const user = await User.findById(req.user.id);
    if ((user?.subscription?.plan || 'paid') === 'free') {
      const count = await Contact.countDocuments({ user_id: req.user.id });
      if (count >= 10) {
        return res.status(403).json({ 
          error: "Free plan limit reached. You can only have 10 contacts. Please upgrade to add more." 
        });
      }
    }
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
    const user = await User.findById(req.user.id);
    if ((user?.subscription?.plan || 'paid') === 'free') {
      return res.status(403).json({ 
        error: "Template creation is a premium feature. Please upgrade your plan to create custom templates." 
      });
    }
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
    const user = await User.findById(req.user.id);
    if ((user?.subscription?.plan || 'paid') === 'free') {
      return res.status(403).json({ 
        error: "Auto-replies are available on paid plans. Please upgrade to enable automation." 
      });
    }
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
    const user = await User.findById(req.user.id);
    if ((user?.subscription?.plan || 'paid') === 'free') {
      return res.status(403).json({ 
        error: "Workflows are premium features. Please upgrade to automate your business processes." 
      });
    }
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
        webhook_verified: true,
      },
      { upsert: true, new: true },
    );

    try {
      const registrationResult = await attemptRegistrationIfNeeded(wa);
      console.log("[Manual Setup] Registration evaluation result:", {
        status: registrationResult.status,
        attempted: registrationResult.attempted,
        success: registrationResult.success,
        dashboard_status: registrationResult.dashboard_status,
      });
    } catch (syncErr) {
      console.warn(
        `[Manual Setup] Status sync/register failed:`,
        syncErr.message,
      );
    }

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
    const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
    const META_API = `https://graph.facebook.com/${GRAPH_VERSION}`;
    const endpoint = `${META_API}/${wa.phone_number_id}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`;

    console.log("[Meta Profile Fetch] Request details", {
      endpoint,
      method: "GET",
      phone_number_id: wa.phone_number_id,
      graph_version: GRAPH_VERSION,
    });

    const r = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${wa.access_token}` },
    });
    const data = await r.json();

    console.log("[Meta Profile Fetch] Response received", {
      status: r.status,
      ok: r.ok,
      has_error: !!data.error,
      error_code: data.error?.code,
      error_message: data.error?.message,
    });

    if (!r.ok) {
      console.error("[Meta Profile Sync Error] Failed to fetch profile", {
        status: r.status,
        error_code: data.error?.code,
        error_message: data.error?.message,
        error_subcode: data.error?.error_subcode,
      });
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
    const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
    const META_API = `https://graph.facebook.com/${GRAPH_VERSION}`;
    const endpoint = `${META_API}/${wa.phone_number_id}/whatsapp_business_profile`;
    const requestBody = {
      messaging_product: "whatsapp",
      about,
      address,
      description,
      email,
      websites,
      vertical,
    };

    console.log("[Meta Profile Update] Request details", {
      endpoint,
      method: "POST",
      phone_number_id: wa.phone_number_id,
      graph_version: GRAPH_VERSION,
      body_keys: Object.keys(requestBody),
    });

    // Update Meta Profile
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${wa.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    const data = await r.json();

    console.log("[Meta Profile Update] Response received", {
      status: r.status,
      ok: r.ok,
      error_code: data.error?.code,
      error_message: data.error?.message,
    });

    if (!r.ok) {
      console.error("[Meta Profile Update] Failed", {
        error_message: data.error?.message,
        error_code: data.error?.code,
        error_subcode: data.error?.error_subcode,
      });
      throw new Error(data.error?.message || "Meta API error");
    }

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
      const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v22.0";
      const META_API = `https://graph.facebook.com/${GRAPH_VERSION}`;
      const uploadEndpoint = `${META_API}/${appId}/uploads?file_length=${file.size}&file_type=${file.mimetype}&access_token=${wa.access_token}`;

      console.log("[Profile Picture Upload] Request details", {
        endpoint:
          uploadEndpoint.split("&access_token")[0] + "&access_token=***",
        method: "POST",
        app_id: appId,
        file_size: file.size,
        file_type: file.mimetype,
        graph_version: GRAPH_VERSION,
      });

      const sessRes = await fetch(uploadEndpoint, {
        method: "POST",
      });
      const sessData = await sessRes.json();
      if (sessData.error) throw new Error(sessData.error.message);

      const uploadSessionId = sessData.id;
      const uploadSessionEndpoint = `${META_API}/${uploadSessionId}`;

      console.log("[Profile Picture Upload] Session created", {
        session_id: uploadSessionId,
        endpoint: uploadSessionEndpoint,
        method: "POST",
      });

      const upRes = await fetch(uploadSessionEndpoint, {
        method: "POST",
        headers: {
          Authorization: `OAuth ${wa.access_token}`,
          file_offset: "0",
        },
        body: file.buffer,
      });
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

    const forceSync = req.query.force === "true";
    const cacheAgeMs = waAccount.meta_status_last_synced
      ? Date.now() - new Date(waAccount.meta_status_last_synced).getTime()
      : Infinity;

    if (!forceSync && cacheAgeMs < STATUS_SYNC_CACHE_MS) {
      const retryAfterSeconds = Math.ceil(
        (STATUS_SYNC_CACHE_MS - cacheAgeMs) / 1000,
      );
      return res.json({
        success: true,
        cached: true,
        cooldown: true,
        retry_after_seconds: retryAfterSeconds,
        phone_number: waAccount.phone_number,
        phone_number_id: waAccount.phone_number_id,
        waba_id: waAccount.waba_id,
        meta_wa_status:
          waAccount.meta_wa_status || waAccount.verification_status,
        is_meta_test_number: waAccount.is_meta_test_number || false,
        was_messaging: waAccount.was_messaging || false,
        dashboard_status: getDashboardStatus(waAccount),
        should_register: false,
        registration_state: "cached",
        registration_error: waAccount.registration_error,
        registration_attempt_count: waAccount.registration_attempt_count || 0,
        last_synced: waAccount.meta_status_last_synced,
        message: `Using recently synced status. Please wait ${retryAfterSeconds} seconds before checking Meta again.`,
      });
    }

    const syncKey = String(waAccount._id);
    if (statusSyncInFlight.has(syncKey)) {
      return res.status(429).json({
        error: "Status sync is already in progress. Please wait a moment.",
        cooldown: true,
        retry_after_seconds: 10,
      });
    }

    statusSyncInFlight.add(syncKey);

    // Safely sync status from Meta API
    const syncResult = await syncAccountStatusFromMeta(waAccount);

    // Update local DB with synced status
    const updated = await updateAccountWithMetaStatus(waAccount, syncResult);

    // Get dashboard-friendly status
    const dashboardStatus = getDashboardStatus(updated || waAccount);

    const statusCode = syncResult.rateLimited ? 429 : 200;
    res.status(statusCode).json({
      success: true,
      cooldown: !!syncResult.rateLimited,
      rate_limited: !!syncResult.rateLimited,
      retry_after_seconds: syncResult.retryAfterSeconds,
      retry_after: syncResult.cooldownUntil,
      phone_number: updated?.phone_number || waAccount.phone_number,
      phone_number_id: updated?.phone_number_id || waAccount.phone_number_id,
      waba_id: updated?.waba_id || waAccount.waba_id,
      meta_wa_status: syncResult.metaStatus,
      is_meta_test_number: syncResult.isTestNumber,
      was_messaging: syncResult.isMessaging,
      dashboard_status: dashboardStatus,
      should_register: syncResult.shouldRegister,
      registration_state: syncResult.registrationState,
      registration_error:
        updated?.registration_error || waAccount.registration_error,
      registration_attempt_count:
        updated?.registration_attempt_count ||
        waAccount.registration_attempt_count ||
        0,
      last_synced: syncResult.timestamp,
      message: syncResult.rateLimited
        ? syncResult.error
        : syncResult.shouldRegister
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
  } finally {
    if (req.user?.id) {
      const current = await WhatsAppAccount.findOne({ user_id: req.user.id })
        .select("_id")
        .lean()
        .catch(() => null);
      if (current?._id) statusSyncInFlight.delete(String(current._id));
    }
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
      registration_error: waAccount.registration_error,
      registration_attempt_count: waAccount.registration_attempt_count || 0,
      last_registration_attempt: waAccount.last_registration_attempt,
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

    const result = await attemptRegistrationIfNeeded(waAccount, { force });
    const statusCode = result.cooldown
      ? 429
      : result.success || !result.attempted
        ? 200
        : 400;

    res.status(statusCode).json({
      success: result.success,
      attempted: result.attempted,
      status: result.status,
      dashboard_status: result.dashboard_status,
      message: result.message,
      error: result.error,
      timeout: result.timeout || false,
      cooldown: result.cooldown || false,
      rate_limited: result.rate_limited || false,
      retry_after_seconds: result.retry_after_seconds,
      retry_after: result.retry_after,
      retry_stopped: result.retry_stopped || false,
      meta_response: result.meta_response,
    });
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
