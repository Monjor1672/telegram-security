const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const Jimp = require('jimp');
const jsQR = require('jsqr');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

const ALLOWED_GROUPS = [-1001651594619, -1002497459008];

// ইন-মেমোরি ক্যাশ (১ ঘণ্টার জন্য)
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

// টেলিগ্রাম মেসেজ ডিলিট করার সেফ ফাংশন
async function deleteTelegramMessage(chatId, messageId) {
    try {
        await axios.post(`https://api.telegram.org/bot${token}/deleteMessage`, {
            chat_id: chatId,
            message_id: messageId
        });
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

            // ১. নির্দিষ্ট দুটি গ্রুপ চেক
            if (!ALLOWED_GROUPS.includes(chatId)) {
                return res.status(200).send('ok');
            }

            if (msg.sender_chat || (msg.from && msg.from.is_bot)) {
                return res.status(200).send('ok');
            }

            // ২. এডমিন চেক
            let isAdmin = false;
            try {
                const member = await bot.getChatMember(chatId, userId);
                if (['creator', 'administrator'].includes(member.status)) {
                    isAdmin = true;
                }
            } catch (e) {}

            // এডমিন হলে কোনো ফিল্টারিং হবে না
            if (isAdmin) {
                return res.status(200).send('ok');
            }

            const key = `${chatId}_${userId}`;
            const currentTime = Math.floor(Date.now() / 1000);

            // ৩. QR কোড প্রসেসিং ও ব্যান
            if (msg.photo && msg.photo.length > 0) {
                const largestPhoto = msg.photo[msg.photo.length - 1];
                const hasQR = await isQRCodeImage(largestPhoto.file_id);

                if (hasQR) {
                    try {
                        await deleteTelegramMessage(chatId, msg.message_id);
                        await bot.banChatMember(chatId, userId);

                        const alertMsg = `🚨 **সিকিউরিটি অ্যালার্ট!** 🚨\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n❌ **অপরাধ:** গ্রুপে অনাকাঙ্ক্ষিত QR কোড শেয়ার করার কারণে আপনাকে স্থায়ীভাবে ব্যান করা হলো।`;
                        const sentMsg = await bot.sendMessage(chatId, alertMsg, { parse_mode: 'Markdown' });
                        
                        // ৩০ সেকেন্ড পর ডিলিট (ফোর্সেড ওয়েটিং)
                        setTimeout(() => deleteTelegramMessage(chatId, sentMsg.message_id), 30000);
                    } catch (e) {
                        console.error('Ban Error:', e);
                    }
                }
                return res.status(200).send('ok');
            }

            // ৪. ১ ঘণ্টার মধ্যে একই মেসেজ রিপিট ফিল্টার
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
                    // একই মেসেজ ১ ঘণ্টার মধ্যে দেওয়া হয়েছে
                    try {
                        await deleteTelegramMessage(chatId, msg.message_id);

                        if (!existingItem.warned) {
                            // প্রথমবার ওয়ার্নিং
                            existingItem.warned = true;
                            const warningText = `⚠️ **সতর্কবার্তা!** ⚠️\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n📌 ১ ঘণ্টার মধ্যে একই বার্তা পুনরায় দিয়ে গ্রুপের পরিবেশ নষ্ট করবেন না। পুনরায় এই কাজ করলে আপনাকে ৩০ মিনিটের জন্য মিউট করা হবে। 🛑`;
                            const sentMsg = await bot.sendMessage(chatId, warningText, { parse_mode: 'Markdown' });
                            
                            // ৩০ সেকেন্ড পর নোটিফিকেশন অটো-ডিলিট
                            setTimeout(() => deleteTelegramMessage(chatId, sentMsg.message_id), 30000);
                        } else {
                            // দ্বিতীয়বার ৩০ মিনিটের জন্য মিউট (১৮০০ সেকেন্ড)
                            const untilDate = currentTime + 1800;
                            await bot.restrictChatMember(chatId, userId, {
                                permissions: {
                                    can_send_messages: false
                                },
                                until_date: untilDate
                            });

                            const muteText = `🔇 **অ্যাকশন নেওয়া হয়েছে!** 🔇\n\n👤 **সম্মানিত সদস্য:** **${fullName}**\n🛑 বারবার একই বার্তা পুনরায় দেওয়ায় আপনাকে **৩০ মিনিটের জন্য মিউট** করা হলো!`;
                            const sentMsg = await bot.sendMessage(chatId, muteText, { parse_mode: 'Markdown' });

                            // ৩০ সেকেন্ড পর নোটিফিকেশন অটো-ডিলিট
                            setTimeout(() => deleteTelegramMessage(chatId, sentMsg.message_id), 30000);
                        }
                    } catch (e) {
                        console.error('Duplicate Error:', e);
                    }
                } else {
                    // নতুন মেসেজ সেভ করে রাখা
                    global.userMessagesStore[key].push({ text, time: currentTime, warned: false });
                }
            }

            // ৩০ সেকেন্ড ওয়েট করার সুযোগ দেওয়া যাতে ডিলিট প্রসেস কিল না হয়
            await new Promise(resolve => setTimeout(resolve, 1000));
            return res.status(200).send('ok');
        } catch (error) {
            console.error('Webhook Error:', error);
            return res.status(200).send('ok');
        }
    }

    return res.status(200).send('ok');
};
