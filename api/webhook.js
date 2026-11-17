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

// ছবি থেকে সঠিক QR কোড স্ক্যান করার উন্নত ও নির্ভুল ফাংশন (False Positive এড়ানোর জন্য)
async function isQRCodeImage(fileId) {
    try {
        const fileLink = await bot.getFileLink(fileId);
        const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
        
        const image = await Jimp.read(Buffer.from(response.data));
        
        // বড় ছবি হলে সাইজ রিসাইজ করা
        if (image.bitmap.width > 800) {
            image.resize(800, Jimp.AUTO);
        }

        // কালার ইমব্যালেন্স বা সাধারণ UI বক্সকে QR ধরা এড়াতে গ্রে-স্কেল ও কন্ট্রাস্ট
        image.grayscale().contrast(0.2);

        const imageData = {
            data: new Uint8ClampedArray(image.bitmap.data),
            width: image.bitmap.width,
            height: image.bitmap.height
        };

        // inversionAttempts বন্ধ রেখে নিখুঁত স্ক্যান নিশ্চিত করা
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert"
        });

        return code !== null;
    } catch (e) {
        console.error('QR Scan Error:', e);
        return false;
    }
}

// আগের নোটিফিকেশন ডিলিট করে নতুন নোটিফিকেশন পাঠানোর ফাংশন
async function sendSingleNotification(chatId, text) {
    try {
        if (global.lastBotMessageId[chatId]) {
            try {
                await bot.deleteMessage(chatId, global.lastBotMessageId[chatId]);
            } catch (e) {}
        }

        const sentMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

        if (sentMsg && sentMsg.message_id) {
            const currentId = sentMsg.message_id;
            global.lastBotMessageId[chatId] = currentId;

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

            if (!ALLOWED_GROUPS.includes(chatId)) {
                return res.status(200).send('ok');
            }

            if (msg.sender_chat || (msg.from && msg.from.is_bot)) {
                return res.status(200).send('ok');
            }

            try {
                const member = await bot.getChatMember(chatId, userId);
                if (['creator', 'administrator'].includes(member.status)) {
                    return res.status(200).send('ok');
                }
            } catch (e) {}

            const key = `${chatId}_${userId}`;
            const currentTime = Math.floor(Date.now() / 1000);

            // QR কোড স্ক্যান ও ব্যান
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

            // ১ ঘণ্টার ডুপ্লিকেট টেক্সট ফিল্টার ও মিউট
            if (msg.text) {
                const text = msg.text.trim().toLowerCase();

                if (!global.userMessagesStore[key]) {
                    global.userMessagesStore[key] = [];
                }

                global.userMessagesStore[key] = global.userMessagesStore[key].filter(
                    item => currentTime - item.time <= 3600
                );

                const existingItem = global.userMessagesStore[key].find(item => item.text === text);

                if (existingItem) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);

                        if (!existingItem.warned) {
                            existingItem.warned = true;
                            const warningText = `⚠️​ গ্রুপ সিকিউরিটি অ্যালার্ট ⚠️\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n📌 নির্দেশনা: গ্রুপে বারবার একই মেসেজ বা স্প্যামিং করা নিষিদ্ধ। অনুগ্রহ করে একই বার্তা বারবার পাঠানো থেকে বিরত থাকুন। অন্যথায় গ্রুপের নিয়ম অনুযায়ী ৩০ মিনিটের মিউট পলিসি কার্যকর করা হবে। 🛑`;
                            await sendSingleNotification(chatId, warningText);
                        } else {
                            const untilDate = currentTime + 1800;
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
