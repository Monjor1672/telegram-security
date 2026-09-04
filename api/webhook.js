const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Jimp = require('jimp');
const jsQR = require('jsqr');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

const ALLOWED_GROUPS = [-1001651594619, -1002497459008];

// গ্লোবাল মেসেজ স্টোর
global.userMessagesStore = global.userMessagesStore || {};
global.lastBotMessageId = global.lastBotMessageId || {};

// ছবি থেকে QR কোড স্ক্যান করার ফাংশন
async function isQRCodeImage(fileId) {
    try {
        const fileLink = await bot.getFileLink(fileId);
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        const image = await Jimp.read(Buffer.from(response.data));
        
        const imageData = {
            data: new Uint8ClampedArray(image.bitmap.data),
            width: image.bitmap.width,
            height: image.bitmap.height
        };

        const code = jsQR(imageData.data, imageData.width, imageData.height);
        return code !== null;
    } catch (e) {
        console.error('QR Scan Error:', e);
        return false;
    }
}

// আগের নোটিফিকেশন ডিলিট করে নতুন নোটিফিকেশন পাঠানোর ফাংশন
async function sendSingleNotification(chatId, text) {
    try {
        // ১. মেমোরিতে যদি আগের মেসেজ আইডি থাকে, তবে তা ডিলিট করা
        if (global.lastBotMessageId[chatId]) {
            try {
                await bot.deleteMessage(chatId, global.lastBotMessageId[chatId]);
            } catch (e) {}
        }

        // ২. নতুন নোটিফিকেশন পাঠানো
        const sentMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

        if (sentMsg && sentMsg.message_id) {
            const currentId = sentMsg.message_id;
            global.lastBotMessageId[chatId] = currentId;

            // ৩. সার্ভার রিসেট হলেও যেন আগের বটের দেওয়া নোটিফিকেশনগুলো মুছে ফেলা যায় (ব্লাইন্ড ক্লিনআপ)
            // নতুন মেসেজের পেছনের ১০টি আইডি চেক করে বটের মেসেজ ডিলিট করবে
            for (let i = 1; i <= 10; i++) {
                const targetId = currentId - i;
                if (targetId > 0) {
                    bot.deleteMessage(chatId, targetId).catch(() => {});
                }
            }
        }
    } catch (e) {
        console.error('Notification Error:', e);
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

            // ১. শুধুমাত্র নির্ধারিত গ্রুপে কাজ করবে
            if (!ALLOWED_GROUPS.includes(chatId)) {
                return res.status(200).send('ok');
            }

            if (msg.sender_chat || (msg.from && msg.from.is_bot)) {
                return res.status(200).send('ok');
            }

            // ২. এডমিন বাইপাস
            try {
                const member = await bot.getChatMember(chatId, userId);
                if (['creator', 'administrator'].includes(member.status)) {
                    return res.status(200).send('ok');
                }
            } catch (e) {}

            const key = `${chatId}_${userId}`;
            const currentTime = Math.floor(Date.now() / 1000);

            // ৩. QR কোড স্ক্যান ও ব্যান
            if (msg.photo && msg.photo.length > 0) {
                const largestPhoto = msg.photo[msg.photo.length - 1];
                const hasQR = await isQRCodeImage(largestPhoto.file_id);

                if (hasQR) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                        await bot.banChatMember(chatId, userId);

                        const alertMsg = `🚨 **সিকিউরিটি অ্যালার্ট!** 🚨\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n❌ **অপরাধ:** গ্রুপে অনাকাঙ্ক্ষিত QR কোড শেয়ার করার কারণে আপনাকে স্থায়ীভাবে ব্যান করা হলো।`;
                        await sendSingleNotification(chatId, alertMsg);
                    } catch (e) {
                        console.error('Ban Error:', e);
                    }
                }
                return res.status(200).send('ok');
            }

            // ৪. ১ ঘণ্টার ডুপ্লিকেট টেক্সট ফিল্টার, ওয়ার্নিং ও ৩০ মিনিটের মিউট
            if (msg.text) {
                const text = msg.text.trim().toLowerCase();

                if (!global.userMessagesStore[key]) {
                    global.userMessagesStore[key] = [];
                }

                // ১ ঘণ্টার (৩৬০০ সেকেন্ড) পুরোনো মেসেজ হিস্ট্রি পরিষ্কার করা
                global.userMessagesStore[key] = global.userMessagesStore[key].filter(
                    item => currentTime - item.time <= 3600
                );

                const existingItem = global.userMessagesStore[key].find(item => item.text === text);

                if (existingItem) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);

                        if (!existingItem.warned) {
                            existingItem.warned = true;
                            const warningText = `⚠️ **সতর্কবার্তা!** ⚠️\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n📌 ১ ঘণ্টার মধ্যে একই বার্তা পুনরায় দিয়ে গ্রুপের পরিবেশ নষ্ট করবেন না। পুনরায় এই কাজ করলে আপনাকে ৩০ মিনিটের জন্য মিউট করা হবে। 🛑`;
                            await sendSingleNotification(chatId, warningText);
                        } else {
                            const untilDate = currentTime + 1800; // ৩০ মিনিট (১৮০০ সেকেন্ড)
                            await bot.restrictChatMember(chatId, userId, {
                                permissions: { can_send_messages: false },
                                until_date: untilDate
                            });

                            const muteText = `🔇 **অ্যাকশন নেওয়া হয়েছে!** 🔇\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n🛑 বারবার একই বার্তা পুনরায় দেওয়ায় আপনাকে **৩০ মিনিটের জন্য মিউট** করা হলো!`;
                            await sendSingleNotification(chatId, muteText);
                        }
                    } catch (e) {
                        console.error('Duplicate Action Error:', e);
                    }
                } else {
                    global.userMessagesStore[key].push({ text, time: currentTime, warned: false });
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
