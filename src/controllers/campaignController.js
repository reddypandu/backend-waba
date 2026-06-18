import mongoose from "mongoose";
import Campaign from "../models/Campaign.js";
import User from "../models/User.js";
import Message from "../models/Message.js";
import Contact from "../models/Contact.js";
import WhatsAppAccount from "../models/WhatsAppAccount.js";
import Template from "../models/Template.js";
import { sendCampaign } from "../utils/campaign.js"; // Existing bulk sender logic

const toObjectId = (id) =>
  mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;

const legacyIdMatch = (field, id) => {
  const objectId = toObjectId(id);
  return objectId
    ? { $or: [{ [field]: objectId }, { [field]: id }] }
    : { [field]: id };
};

const legacyIdValues = (id) => {
  const objectId = toObjectId(id);
  return objectId ? [objectId, id] : [id];
};

export class CampaignController {
  static async getCampaigns(req, res) {
    try {
      const userIds = legacyIdValues(req.user.id);
      const campaigns = await Campaign.aggregate([
        { $match: { user_id: { $in: userIds } } },
        { $sort: { createdAt: -1 } },
        {
          $lookup: {
            from: "messages",
            let: {
              campaignId: "$_id",
              campaignIdString: { $toString: "$_id" },
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $or: [
                      { $eq: ["$campaign_id", "$$campaignId"] },
                      { $eq: ["$campaign_id", "$$campaignIdString"] },
                    ],
                  },
                  user_id: { $in: userIds },
                },
              },
            ],
            as: "msgs",
          },
        },
        {
          $addFields: {
            stats: {
              sent: {
                $size: {
                  $filter: {
                    input: "$msgs",
                    as: "m",
                    cond: {
                      $in: [
                        "$$m.status",
                        ["sent", "delivered", "read", "replied"],
                      ],
                    },
                  },
                },
              },
              delivered: {
                $size: {
                  $filter: {
                    input: "$msgs",
                    as: "m",
                    cond: {
                      $in: ["$$m.status", ["delivered", "read", "replied"]],
                    },
                  },
                },
              },
              read: {
                $size: {
                  $filter: {
                    input: "$msgs",
                    as: "m",
                    cond: { $in: ["$$m.status", ["read", "replied"]] },
                  },
                },
              },
              failed: {
                $size: {
                  $filter: {
                    input: "$msgs",
                    as: "m",
                    cond: { $eq: ["$$m.status", "failed"] },
                  },
                },
              },
            },
          },
        },
        { $project: { msgs: 0 } },
      ]);
      res.json({ campaigns });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getCampaignById(req, res) {
    try {
      const campaign = await Campaign.findOne({
        _id: req.params.id,
        ...legacyIdMatch("user_id", req.user.id),
      });
      if (!campaign)
        return res.status(404).json({ error: "Campaign not found" });
      res.json({ campaign });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createCampaign(req, res) {
    try {
      const user = await User.findById(req.user.id);
      if ((user?.subscription?.plan || 'paid') === 'free') { // Existing users without a plan are 'paid'
        return res.status(403).json({ 
          error: "Campaign creation is a premium feature. Please upgrade to launch broadcasts." 
        });
      }

      const {
        name,
        template_name,
        audience_type = "existing",
        schedule_type = "now",
        scheduled_at,
        contacts = [],
        requires_follow_up = false,
        interactive_params = null,
      } = req.body;
      if (!name)
        return res.status(400).json({ error: "Campaign name required" });

      let campaignContactIds = [];
      if (contacts && contacts.length > 0) {
        campaignContactIds = contacts;
      } else if (audience_type === "existing") {
        // Only target opted-in contacts
        const allContacts = await Contact.find({
          user_id: req.user.id,
          opt_in_status: { $ne: "opted_out" },
        });
        campaignContactIds = allContacts.map((c) => c._id);
      }

      const campaign = await Campaign.create({
        user_id: req.user.id,
        name,
        template_name,
        audience_type,
        schedule_type,
        scheduled_at: schedule_type === "later" ? scheduled_at : null,
        total_contacts: campaignContactIds.length,
        contact_ids: campaignContactIds,
        status: schedule_type === "later" ? "scheduled" : "draft",
        requires_follow_up,
        interactive_params,
        components: req.body.components || [],
      });

      res.json({ success: true, campaign_id: campaign._id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async sendCampaign(req, res) {
    try {
      const campaign = await Campaign.findOne({
        _id: req.params.id,
        ...legacyIdMatch("user_id", req.user.id),
      });
      if (!campaign)
        return res.status(404).json({ error: "Campaign not found" });

      const result = await sendCampaign(req.params.id);
      if (result.error) return res.status(400).json({ error: result.error });

      res.json({ success: true, message: "Campaign started" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateCampaignStatus(req, res) {
    try {
      const { status } = req.body;
      const allowedStatuses = [
        "draft",
        "scheduled",
        "running",
        "completed",
        "paused",
        "failed",
      ];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid campaign status" });
      }

      const campaign = await Campaign.findOneAndUpdate(
        { _id: req.params.id, ...legacyIdMatch("user_id", req.user.id) },
        { status },
        { new: true },
      );
      if (!campaign)
        return res.status(404).json({ error: "Campaign not found" });

      res.json({ success: true, campaign });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getCampaignStats(req, res) {
    try {
      const campaignId = req.params.id;
      const campaignIds = legacyIdValues(campaignId);
      const userIds = legacyIdValues(req.user.id);

      const campaign = await Campaign.findOne({
        _id: campaignIds[0],
        user_id: userIds[0],
      });

      const stats = await Message.aggregate([
        {
          $match: {
            $expr: { // Use $expr for robust type-agnostic matching in aggregation
              $or: [
                { $in: ["$campaign_id", campaignIds] }, // Match if campaign_id (as is) is in the array
                { $in: [{ $toString: "$campaign_id" }, campaignIds] }, // Match if campaign_id (as string) is in the array
              ],
            },
            user_id: { $in: userIds },
          },
        },
        {
          $group: {
            _id: null,
            sent: {
              $sum: {
                $cond: [
                  {
                    $in: ["$status", ["sent", "delivered", "read", "replied"]],
                  },
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
                $cond: [{ $in: ["$status", ["read", "replied"]] }, 1, 0],
              },
            },
            failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
            replied: {
              $sum: { $cond: [{ $eq: ["$status", "replied"] }, 1, 0] },
            },
          },
        },
      ]);

      const result = stats[0] || {
        sent: 0,
        delivered: 0,
        read: 0,
        failed: 0,
        replied: 0,
      };

      // If messages are sent but not delivered, check account status
      if (result.sent > 0 && result.delivered === 0) {
        const waAccount = await WhatsAppAccount.findOne({
          user_id: campaign?.user_id,
        });
        if (waAccount) {
          result.account_status = {
            meta_wa_status: waAccount.meta_wa_status,
            meta_error_message: waAccount.meta_error_message,
            verification_status: waAccount.verification_status,
          };
        }
      }

      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async deleteCampaign(req, res) {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ error: "Campaign ID required" });
      await Campaign.findOneAndDelete({
        _id: id,
        ...legacyIdMatch("user_id", req.user.id),
      });
      await Message.deleteMany({
        campaign_id: { $in: legacyIdValues(id) },
        user_id: { $in: legacyIdValues(req.user.id) },
      });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async retargetFailed(req, res) {
    // Basic implementation for retargeting failed messages (extracted from whatsapp.js)
    try {
      const campaign = await Campaign.findOne({
        _id: req.params.id,
        ...legacyIdMatch("user_id", req.user.id),
      });
      if (!campaign)
        return res.status(404).json({ error: "Campaign not found" });

      const failedMessages = await Message.find({
        campaign_id: { $in: legacyIdValues(campaign._id.toString()) },
        status: "failed",
      });
      if (failedMessages.length === 0)
        return res.json({
          success: true,
          sent: 0,
          message: "No failed messages",
        });

      const waAccount = await WhatsAppAccount.findOne({ user_id: req.user.id });
      let sent = 0;
      const META_API = "https://graph.facebook.com/v22.0";

      const templateRecord = await Template.findOne({
        user_id: req.user.id,
        name: campaign.template_name,
      });
      const templateLanguage = templateRecord?.language || "en_US";

      for (const msg of failedMessages) {
        try {
          const components = campaign.components || [];
          const r = await fetch(
            `${META_API}/${waAccount.phone_number_id}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${waAccount.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messaging_product: "whatsapp",
                to: msg.phone_number,
                type: "template",
                template: {
                  name: campaign.template_name,
                  language: { code: templateLanguage },
                  ...(components.length > 0 && { components }),
                },
              }),
            },
          );
          const data = await r.json();
          if (r.ok) {
            sent++;
            await Message.findByIdAndUpdate(msg._id, {
              status: "sent",
              whatsapp_message_id: data.messages?.[0]?.id,
              error_details: null,
            });
          } else {
            console.error("[Retarget] Meta API Error:", data);
          }
        } catch (_) {}
      }
      res.json({ success: true, sent });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getCampaignReports(req, res) {
    try {
      const campaignId = req.params.id;
      const campaignIds = legacyIdValues(campaignId);
      const userIds = legacyIdValues(req.user.id);

      // Use aggregation for robust type-agnostic matching, similar to getCampaignStats
      const messages = await Message.aggregate([
        {
          $match: {
            $expr: {
              $or: [
                { $in: ["$campaign_id", campaignIds] }, // Match if campaign_id (as is) is in the array
                { $in: [{ $toString: "$campaign_id" }, campaignIds] }, // Match if campaign_id (as string) is in the array
              ],
            },
            user_id: { $in: userIds },
          },
        },
        {
          $lookup: {
            from: "contacts", // The collection name for Contact model
            localField: "contact_id",
            foreignField: "_id",
            as: "contact_id", // This will be an array, so we need to unwind it
          },
        },
        { $unwind: { path: "$contact_id", preserveNullAndEmptyArrays: true } }, // Handle cases where contact_id might not be found
        {
          $project: {
            phone_number: 1,
            status: 1,
            error_details: 1,
            whatsapp_message_id: 1,
            createdAt: 1,
            updatedAt: 1,
            contact_id: { _id: "$contact_id._id", name: "$contact_id.name", phone_number: "$contact_id.phone_number", email: "$contact_id.email" },
            message_type: 1,
            template_name: 1,
          },
        },
        { $sort: { updatedAt: -1 } },
      ]);

      res.json({ 
        success: true, 
        count: messages.length,
        messages 
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}
