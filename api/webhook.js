const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Jimp = require('jimp');
const jsQR = require('jsqr');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

const ALLOWED_GROUPS = [-1001651594619, -1002497459008];
const userMessages = {};

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

// ৫ মিনিট পর স্বয়ংক্রিয়ভাবে মেসেজ ডিলিট করার ফাংশন
function sendAutoDeleteMessage(chatId, text) {
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }).then((sentMsg) => {
        setTimeout(async () => {
            try {
                await bot.deleteMessage(chatId, sentMsg.message_id);
            } catch (e) {}
        }, 300000); // ৩০০,০০০ মি.সে. = ৫ মিনিট
    }).catch((e) => console.error('Send Auto Delete Error:', e));
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

            // ২. এডমিনদের ফিল্টার মুক্ত রাখা
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
                        sendAutoDeleteMessage(chatId, alertMsg);
                    } catch (e) {
                        console.error('Ban Error:', e);
                    }
                }
                return res.status(200).send('ok');
            }

            // ৪. ১ ঘণ্টার ডুপ্লিকেট টেক্সট ফিল্টার, ওয়ার্নিং এবং ৩০ মিনিটের মিউট
            if (msg.text) {
                const text = msg.text.trim().toLowerCase();

                if (!userMessages[key]) userMessages[key] = [];

                // ১ ঘণ্টার পুরোনো তথ্য পরিষ্কার করা
                userMessages[key] = userMessages[key].filter(
                    item => currentTime - item.time <= 3600
                );

                // একই মেসেজ কতবার দেওয়া হয়েছে তা গণনা
                const duplicateCount = userMessages[key].filter(item => item.text === text).length;

                if (duplicateCount >= 1) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);

                        if (duplicateCount === 1) {
                            // ১ম বার রিপিট করলে সতর্কবার্তা
                            const warningMsg = `⚠️ **সতর্কবার্তা!** ⚠️\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n📌 একই বার্তা পুনরায় দিয়ে গ্রুপের পরিবেশ নষ্ট করবেন না। পুনরায় এই কাজ করলে আপনাকে ৩০ মিনিটের জন্য মিউট করা হবে। 🛑`;
                            sendAutoDeleteMessage(chatId, warningMsg);
                        } else {
                            // ২য় বা ৩য় বার রিপিট করলে ৩০ মিনিটের জন্য মিউট
                            const untilDate = currentTime + 1800; // ৩০ মিনিট (১৮০০ সেকেন্ড)
                            
                            await bot.restrictChatMember(chatId, userId, {
                                can_send_messages: false,
                                until_date: untilDate
                            });

                            const muteMsg = `🔇 **অ্যাকশন নেওয়া হয়েছে!** 🔇\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n🛑 বারবার একই বার্তা পুনরায় দেওয়ায় আপনাকে **৩০ মিনিটের জন্য মিউট** করা হলো!`;
                            sendAutoDeleteMessage(chatId, muteMsg);
                        }
                    } catch (e) {
                        console.error('Duplicate Action Error:', e);
                    }
                }

                userMessages[key].push({ text, time: currentTime });
            }

            return res.status(200).send('ok');
        } catch (error) {
            console.error('Webhook Error:', error);
            return res.status(200).send('ok');
        }
    }

    return res.status(200).send('ok');
};
