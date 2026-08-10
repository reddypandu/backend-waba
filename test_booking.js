import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { WebhookService } from './src/services/webhookService.js';

dotenv.config();

async function runTest() {
    await mongoose.connect(process.env.MONGODB_URI);
    const Workflow = (await import('./src/models/Automation.js')).Workflow;
    const Conversation = (await import('./src/models/Conversation.js')).Conversation;
    const Contact = (await import('./src/models/Contact.js')).default;

    const wf = await Workflow.findById("6a7995138b75876446537a0e");
    const bookAction = wf.actions.find(a => a.type === 'book_meeting');
    console.log("Book Meeting Action ID:", bookAction.id);
    console.log("Book Meeting Next Step:", bookAction.next_step);

    let contact = await Contact.findOne({ user_id: wf.user_id });
    let conv = await Conversation.findOne({ user_id: wf.user_id });
    conv.workflow_id = wf._id;
    conv.workflow_step_id = bookAction.id;
    await conv.save();

    console.log("\n--- Simulating Date Selection (date_2026-08-11_" + bookAction.id + ") ---");
    const handledDate = await WebhookService.checkWorkflow(
        wf.user_id,
        conv,
        "Tue, Aug 11",
        `date_2026-08-11_${bookAction.id}`,
        "1098909889979963",
        process.env.WA_TOKEN,
        conv._id,
        contact._id
    );
    console.log("Handled date selection?", handledDate);

    console.log("\n--- Simulating Time Selection (time_2026-08-11_09:00_" + bookAction.id + ") ---");
    conv = await Conversation.findById(conv._id);
    const handledTime = await WebhookService.checkWorkflow(
        wf.user_id,
        conv,
        "09:00",
        `time_2026-08-11_09:00_${bookAction.id}`,
        "1098909889979963",
        process.env.WA_TOKEN,
        conv._id,
        contact._id
    );
    console.log("Handled time selection?", handledTime);

    conv = await Conversation.findById(conv._id);
    console.log("New Conversation Step ID after time selection:", conv.workflow_step_id);

    process.exit(0);
}

runTest().catch(console.error);
