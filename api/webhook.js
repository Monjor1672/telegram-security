const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Jimp = require('jimp');
const jsQR = require('jsqr');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

const ALLOWED_GROUPS = [-1001651594619, -1002497459008];

// গ্লোবাল স্টোর (আগের নোটিফিকেশন আইডি এবং ইউজার মেসেজ হিস্ট্রি রাখার জন্য)
global.lastWarningMessageId = global.lastWarningMessageId || {};
global.userMessagesStore = global.userMessagesStore || {};

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

// আগের নোটিফিকেশন থাকলে ডিলিট করে নতুন নোটিফিকেশন পাঠানোর ফাংশন
async function sendNewAndDeletePreviousNotification(chatId, text) {
    try {
        // ১. আগের কোনো নোটিফিকেশন থাকলে তা সাথে সাথে ডিলিট করা
        if (global.lastWarningMessageId[chatId]) {
            try {
                await bot.deleteMessage(chatId, global.lastWarningMessageId[chatId]);
            } catch (e) {
                // পুরোনো মেসেজ অলরেডি ডিলিট হয়ে থাকলে বা পাওয়া না গেলে ইগনোর করবে
            }
        }

        // ২. নতুন নোটিফিকেশন পাঠানো
        const sentMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

        // ৩. নতুন নোটিফিকেশনের ID সেভ করে রাখা
        if (sentMsg && sentMsg.message_id) {
            global.lastWarningMessageId[chatId] = sentMsg.message_id;
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

            // ১. নির্দিষ্ট দুটি গ্রুপ চেক করা
            if (!ALLOWED_GROUPS.includes(chatId)) {
                return res.status(200).send('ok');
            }

            if (msg.sender_chat || (msg.from && msg.from.is_bot)) {
                return res.status(200).send('ok');
            }

            // ২. এডমিন চেক (এডমিনদের ছাড় দেওয়া)
            try {
                const member = await bot.getChatMember(chatId, userId);
                if (['creator', 'administrator'].includes(member.status)) {
                    return res.status(200).send('ok');
                }
            } catch (e) {}

            const key = `${chatId}_${userId}`;
            const currentTime = Math.floor(Date.now() / 1000);

            // ৩. QR কোড স্ক্যান ও স্থায়ী ব্যান
            if (msg.photo && msg.photo.length > 0) {
                const largestPhoto = msg.photo[msg.photo.length - 1];
                const hasQR = await isQRCodeImage(largestPhoto.file_id);

                if (hasQR) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                        await bot.banChatMember(chatId, userId);

                        const alertMsg = `🚨 **সিকিউরিটি অ্যালার্ট!** 🚨\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n❌ **অপরাধ:** গ্রুপে অনাকাঙ্ক্ষিত QR কোড শেয়ার করার কারণে আপনাকে স্থায়ীভাবে ব্যান করা হলো।`;
                        await sendNewAndDeletePreviousNotification(chatId, alertMsg);
                    } catch (e) {
                        console.error('Ban Error:', e);
                    }
                }
                return res.status(200).send('ok');
            }

            // ৪. ১ ঘণ্টার ডুপ্লিকেট টেক্সট ফিল্টার ও মিউট
            if (msg.text) {
                const text = msg.text.trim().toLowerCase();

                if (!global.userMessagesStore[key]) {
                    global.userMessagesStore[key] = [];
                }

                // ১ ঘণ্টার (৩৬০০ সেকেন্ড) পুরোনো ইতিহাস মুছে ফেলা
                global.userMessagesStore[key] = global.userMessagesStore[key].filter(
                    item => currentTime - item.time <= 3600
                );

                const existingItem = global.userMessagesStore[key].find(item => item.text === text);

                if (existingItem) {
                    try {
                        // ইউজার যে ডুপ্লিকেট মেসেজ পাঠিয়েছে তা সাথে সাথে ডিলিট হবে
                        await bot.deleteMessage(chatId, msg.message_id);

                        if (!existingItem.warned) {
                            // প্রথমবার রিপিট করলে ওয়ার্নিং
                            existingItem.warned = true;
                            const warningText = `⚠️ **সতর্কবার্তা!** ⚠️\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n📌 ১ ঘণ্টার মধ্যে একই বার্তা পুনরায় দিয়ে গ্রুপের পরিবেশ নষ্ট করবেন না। পুনরায় এই কাজ করলে আপনাকে ৩০ মিনিটের জন্য মিউট করা হবে। 🛑`;
                            await sendNewAndDeletePreviousNotification(chatId, warningText);
                        } else {
                            // দ্বিতীয়বার রিপিট করলে ৩০ মিনিটের জন্য মিউট
                            const untilDate = currentTime + 1800; // ৩০ মিনিট
                            await bot.restrictChatMember(chatId, userId, {
                                permissions: { can_send_messages: false },
                                until_date: untilDate
                            });

                            const muteText = `🔇 **অ্যাকশন নেওয়া হয়েছে!** 🔇\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n🛑 বারবার একই বার্তা পুনরায় দেওয়ায় আপনাকে **৩০ মিনিটের জন্য মিউট** করা হলো!`;
                            await sendNewAndDeletePreviousNotification(chatId, muteText);
                        }
                    } catch (e) {
                        console.error('Duplicate Error:', e);
                    }
                } else {
                    // নতুন মেসেজ সেভ করা
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
