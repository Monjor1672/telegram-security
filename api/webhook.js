const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

// নির্দিষ্ট দুটি গ্রুপ আইডি
const ALLOWED_GROUPS = [-1001651594619, -1002497459008];
const userMessages = {};

function containsQRCode(msg) {
    if (msg.caption && /qr|scan|code/i.test(msg.caption)) {
        return true;
    }
    return false;
}

// ওয়ার্নিং মেসেজ পাঠিয়ে ৫ মিনিট (৩০০ সেকেন্ড) পর ডিলিট করার ফাংশন
async function sendAutoDeleteMessage(chatId, text) {
    try {
        const sentMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        
        // ৫ মিনিট পর ডিলিট করার ব্যাকগ্রাউন্ড টাস্ক
        setTimeout(async () => {
            try {
                await bot.deleteMessage(chatId, sentMsg.message_id);
            } catch (e) {
                console.error('Auto delete error:', e);
            }
        }, 300000);
    } catch (e) {
        console.error('Send message error:', e);
    }
}

module.exports = async (req, res) => {
    if (req.method === 'GET') {
        return res.status(200).send('Active');
    }

    if (req.method === 'POST') {
        try {
            const update = req.body;
            if (!update || !update.message) {
                return res.status(200).send('ok');
            }

            const msg = update.message;
            const chatId = msg.chat.id;
            const userId = msg.from ? msg.from.id : null;
            const fullName = msg.from ? `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() : 'ইউজার';

            // ১. শুধুমাত্র নির্দিষ্ট দুটি গ্রুপেই কাজ করবে
            if (!ALLOWED_GROUPS.includes(chatId)) {
                return res.status(200).send('ok');
            }

            if (msg.sender_chat || (msg.from && msg.from.is_bot)) {
                return res.status(200).send('ok');
            }

            // ২. এডমিন বা ওনারদের ফিল্টার মুক্ত রাখা
            try {
                const member = await bot.getChatMember(chatId, userId);
                if (['creator', 'administrator'].includes(member.status)) {
                    return res.status(200).send('ok');
                }
            } catch (e) {}

            const key = `${chatId}_${userId}`;
            const currentTime = Math.floor(Date.now() / 1000);

            // ৩. QR কোড পাওয়ার পর স্থায়ী ব্যান ও ৫ মিনিটের অ্যালার্ট
            if (msg.photo && containsQRCode(msg)) {
                try {
                    await bot.deleteMessage(chatId, msg.message_id);
                    await bot.banChatMember(chatId, userId);
                    
                    const alertMsg = `🚫 **সিকিউরিটি অ্যালার্ট!**\n\nপ্রিয় **${fullName}**, গ্রুপে অনাকাঙ্ক্ষিত QR কোড শেয়ার করার অপরাধে আপনাকে স্থায়ীভাবে ব্যান করা হলো।`;
                    await sendAutoDeleteMessage(chatId, alertMsg);
                } catch (e) {
                    console.error('Ban Error:', e);
                }
                return res.status(200).send('ok');
            }

            // ৪. ১ ঘণ্টার মধ্যে ডুপ্লিকেট টেক্সটের ক্ষেত্রে ৫ মিনিটের জন্য ওয়ার্নিং
            if (msg.text) {
                const text = msg.text.trim().toLowerCase();

                if (!userMessages[key]) userMessages[key] = [];
                
                // ১ ঘণ্টার পুরোনো তথ্য পরিষ্কার করা
                userMessages[key] = userMessages[key].filter(
                    item => currentTime - item.time <= 3600
                );

                const isDuplicate = userMessages[key].some(item => item.text === text);

                if (isDuplicate) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                        
                        const warningMsg = `প্রিয় **${fullName}**, একই মেসেজ পুনরায় দিয়ে গ্রুপের পরিবেশ নষ্ট করবেন না।`;
                        await sendAutoDeleteMessage(chatId, warningMsg);
                    } catch (e) {
                        console.error('Duplicate Warning Error:', e);
                    }
                } else {
                    userMessages[key].push({ text, time: currentTime });
                }
            }

            return res.status(200).send('ok');
        } catch (error) {
            console.error('Webhook Error:', error);
            return res.status(200).send('ok');
        }
    }

    return res.status(200).send('ok');
};
