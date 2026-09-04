const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Jimp = require('jimp');
const jsQR = require('jsqr');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

const ALLOWED_GROUPS = [-1001651594619, -1002497459008];
const userMessages = {};

// ছবি ডাউনলোড করে আসল QR কোড আছে কি না তা ডিকোড করার ফাংশন
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
        return code !== null; // QR কোড পাওয়া গেলে true রিটার্ন করবে
    } catch (e) {
        console.error('QR Scan Error:', e);
        return false;
    }
}

// ৫ মিনিট পর বার্তা ডিলিট করার ফাংশন
async function sendAutoDeleteMessage(chatId, text) {
    try {
        const sentMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        setTimeout(async () => {
            try {
                await bot.deleteMessage(chatId, sentMsg.message_id);
            } catch (e) {}
        }, 300000);
    } catch (e) {}
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

            // নির্দিষ্ট দুটি গ্রুপেই ফিল্টার সীমাবদ্ধ রাখা
            if (!ALLOWED_GROUPS.includes(chatId)) {
                return res.status(200).send('ok');
            }

            if (msg.sender_chat || (msg.from && msg.from.is_bot)) {
                return res.status(200).send('ok');
            }

            // এডমিনদের স্কিপ করা
            try {
                const member = await bot.getChatMember(chatId, userId);
                if (['creator', 'administrator'].includes(member.status)) {
                    return res.status(200).send('ok');
                }
            } catch (e) {}

            const key = `${chatId}_${userId}`;
            const currentTime = Math.floor(Date.now() / 1000);

            // ১. ছবি আসলে সেটি স্ক্যান করা হবে (QR কোড থাকলে স্থায়ী ব্যান, সাধারণ ছবি হলে অনুমতি পাবে)
            if (msg.photo && msg.photo.length > 0) {
                // সবচেয়ে ভালো কোয়ালিটির ছবির ফাইল আইডি নেওয়া
                const largestPhoto = msg.photo[msg.photo.length - 1];
                const hasQR = await isQRCodeImage(largestPhoto.file_id);

                if (hasQR) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                        await bot.banChatMember(chatId, userId);

                        const alertMsg = `🚫 **সিকিউরিটি অ্যালার্ট!**\n\nপ্রিয় **${fullName}**, গ্রুপে QR কোড শেয়ার করার অপরাধে আপনাকে স্থায়ীভাবে ব্যান করা হলো।`;
                        await sendAutoDeleteMessage(chatId, alertMsg);
                    } catch (e) {
                        console.error('Ban Error:', e);
                    }
                }
                return res.status(200).send('ok');
            }

            // ২. ১ ঘণ্টার ডুপ্লিকেট টেক্সট ফিল্টার
            if (msg.text) {
                const text = msg.text.trim().toLowerCase();

                if (!userMessages[key]) userMessages[key] = [];

                userMessages[key] = userMessages[key].filter(
                    item => currentTime - item.time <= 3600
                );

                const isDuplicate = userMessages[key].some(item => item.text === text);

                if (isDuplicate) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);

                        const warningMsg = `প্রিয় **${fullName}**, একই মেসেজ পুনরায় দিয়ে গ্রুপের পরিবেশ নষ্ট করবেন না।`;
                        await sendAutoDeleteMessage(chatId, warningMsg);
                    } catch (e) {}
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
