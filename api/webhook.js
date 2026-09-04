const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token);

const ALLOWED_GROUPS = [-1001651594619, -1002497459008];
const userMessages = {};
const userWarnings = {};

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

            if (!ALLOWED_GROUPS.includes(chatId)) {
                return res.status(200).send('ok');
            }

            if (msg.sender_chat || (msg.from && msg.from.is_bot)) {
                return res.status(200).send('ok');
            }

            // Check if user is admin/creator
            try {
                const member = await bot.getChatMember(chatId, userId);
                if (['creator', 'administrator'].includes(member.status)) {
                    return res.status(200).send('ok');
                }
            } catch (e) {}

            const key = `${chatId}_${userId}`;
            const currentTime = Math.floor(Date.now() / 1000);

            // 1. QR / Image Check -> Ban User
            if (msg.photo) {
                try {
                    await bot.deleteMessage(chatId, msg.message_id);
                    await bot.banChatMember(chatId, userId);
                } catch (e) {
                    console.error('Ban Error:', e);
                }
                return res.status(200).send('ok');
            }

            // 2. Duplicate Text Check (1 Hour Window)
            if (msg.text) {
                const text = msg.text.trim().toLowerCase();

                if (!userMessages[key]) userMessages[key] = [];
                
                // Keep only messages sent in the last 1 hour (3600s)
                userMessages[key] = userMessages[key].filter(
                    item => currentTime - item.time <= 3600
                );

                const isDuplicate = userMessages[key].some(item => item.text === text);

                if (isDuplicate) {
                    const warnings = (userWarnings[key] || 0) + 1;
                    userWarnings[key] = warnings;

                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                    } catch (e) {}

                    if (warnings >= 2) {
                        try {
                            await bot.restrictChatMember(chatId, userId, {
                                can_send_messages: false,
                                until_date: currentTime + 1800 // Mute for 30 mins
                            });
                            userWarnings[key] = 0;
                        } catch (e) {
                            console.error('Mute Error:', e);
                        }
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
