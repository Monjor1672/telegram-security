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
        return code !== null;
    } catch (e) {
        console.error('QR Scan Error:', e);
        return false;
    }
}

// ৫ মিনিট পর বার্তা ডিলিট করার হেল্পার
async function sendAutoDeleteMessage(chatId, text) {
    try {
        const sentMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        
        // Vercel এসিংক্রোনাস ডিলিট
        const deleteUrl = `https://api.telegram.org/bot${token}/deleteMessage`;
        
        setTimeout(() => {
            axios.post(deleteUrl, {
                chat_id: chatId,
                message_id: sentMsg.message_id
            }).catch(() => {});
        }, 300000); // ৩০০,০০০ মি.সে. = ৫ মিনিট
    } catch (e) {
        console.error('Send Auto Delete Error:', e);
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

            // ১. নির্দিষ্ট দুটি গ্রুপেই ফিল্টার সীমাবদ্ধ রাখা
            if (!ALLOWED_GROUPS.includes(chatId)) {
                return res.status(200).send('ok');
            }

            if (msg.sender_chat || (msg.from && msg.from.is_bot)) {
                return res.status(200).send('ok');
            }

            // ২. এডমিনদের স্কিপ করা
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

                        const alertMsg = `🚫 **সিকিউরিটি অ্যালার্ট!**\n\nসম্মানিত সদস্য **${fullName}**, গ্রুপে অনাকাঙ্ক্ষিত QR কোড শেয়ার করার অপরাধে আপনাকে স্থায়ীভাবে ব্যান করা হলো।`;
                        await sendAutoDeleteMessage(chatId, alertMsg);
                    } catch (e) {
                        console.error('Ban Error:', e);
                    }
                }
                return res.status(200).send('ok');
            }

            // ৪. ১ ঘণ্টার মধ্যে ডুপ্লিকেট টেক্সট রিপিট ফিল্টার
            if (msg.text) {
                const text = msg.text.trim().toLowerCase();

                if (!userMessages[key]) userMessages[key] = [];

                // ১ ঘণ্টার পুরোনো মেসেজ মেমোরি থেকে বাদ দেওয়া
                userMessages[key] = userMessages[key].filter(
                    item => currentTime - item.time <= 3600
                );

                const isDuplicate = userMessages[key].some(item => item.text === text);

                if (isDuplicate) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);

                        const warningMsg = `সম্মানিত সদস্য **${fullName}** একই বার্তা পুনরায় দিয়ে গ্রুপের পরিবেশ নষ্ট করবেন না। তৃতীয়বার দেওয়া হলে আপনার বিরুদ্ধে যথাযথ ব্যবস্থা নেওয়ার জন্য আমি আছি।`;
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
