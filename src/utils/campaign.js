import Campaign from '../models/Campaign.js';
import Contact from '../models/Contact.js';
import WhatsAppAccount from '../models/WhatsAppAccount.js';
import Message from '../models/Message.js';

const META_API = 'https://graph.facebook.com/v21.0';

/**
 * Sends a campaign based on its current configuration
 * @param {string} campaignId 
 */
export async function sendCampaign(campaignId) {
  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return { error: 'Campaign not found' };
    if (campaign.status === 'running') return { error: 'Campaign already running' };

    const waAccount = await WhatsAppAccount.findOne({ user_id: campaign.user_id });
    if (!waAccount) return { error: 'WhatsApp not configured' };

    campaign.status = 'running';
    campaign.started_at = new Date();
    await campaign.save();

    // Start sending in background...
    processCampaignInBackground(campaign, waAccount);

    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

async function processCampaignInBackground(campaign, waAccount) {
  try {
    const { template_name, contact_ids, requires_follow_up, interactive_params, components: templateComponents = [] } = campaign;
    const contacts = await Contact.find({ _id: { $in: contact_ids } });
    
    const componentsMap = new Map();
    if (templateComponents && Array.isArray(templateComponents)) {
      templateComponents.forEach(comp => { if (comp.type) componentsMap.set(comp.type, comp); });
    }
    
    if (interactive_params) {
      if (interactive_params.header_image_url && !componentsMap.has('header')) {
        const url = interactive_params.header_image_url;
        const isVideo = url.match(/\.(mp4|webm|ogg)$/i) || template_name.toLowerCase().includes('video');
        const mediaType = isVideo ? "video" : "image";
        
        componentsMap.set('header', {
          type: "header",
          parameters: [{ 
            type: mediaType, 
            [mediaType]: { link: url } 
          }]
        });
      }
      if (interactive_params.offer_code) {
        const futureTime = new Date(new Date().getTime() + (48 * 60 * 60 * 1000));
        if (!componentsMap.has('button')) {
          componentsMap.set('limited_time_offer', {
            type: "limited_time_offer",
            parameters: [{ type: "limited_time_offer", limited_time_offer: { expiration_time_ms: futureTime.getTime() } }]
          });
          componentsMap.set('button', {
            type: "button",
            sub_type: "copy_code",
            index: 0,
            parameters: [{ type: "coupon_code", coupon_code: interactive_params.offer_code }]
          });
        }
      }
    }

    const finalComponents = Array.from(componentsMap.values());
    let sent = 0, failed = 0;

    for (const contact of contacts) {
      try {
        const r = await fetch(`${META_API}/${waAccount.phone_number_id}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${waAccount.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: contact.phone_number,
            type: 'template',
            template: { 
               name: template_name, 
               language: { code: 'en' },
               ...(finalComponents.length > 0 && { components: finalComponents })
            } 
          }),
        });
        const data = await r.json();
        const msgId = data.messages?.[0]?.id;
        
        if (r.ok) {
          sent++;
          await Message.create({
            user_id: campaign.user_id,
            contact_id: contact._id,
            campaign_id: campaign._id,
            direction: 'outbound',
            message_type: 'template',
            template_name,
            phone_number: contact.phone_number,
            whatsapp_message_id: msgId,
            status: 'sent',
            requires_follow_up
          });
        } else {
          failed++;
          await Message.create({
            user_id: campaign.user_id,
            contact_id: contact._id,
            campaign_id: campaign._id,
            direction: 'outbound',
            message_type: 'template',
            template_name,
            phone_number: contact.phone_number,
            status: 'failed',
            error_details: data.error?.message || 'Meta API Error'
          });
        }
      } catch (e) {
        failed++;
      }
    }

    campaign.status = 'completed';
    campaign.completed_at = new Date();
    await campaign.save();

  } catch (err) {
    console.error('Workflow error in campaign process:', err);
    campaign.status = 'failed';
    await campaign.save();
  }
}
