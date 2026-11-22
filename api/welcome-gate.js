// api/welcome-gate.js

// যে গ্রুপগুলোতে এই সিস্টেম চলবে
const TARGET_GROUPS = [-1001651594619, -1002497459008];

// যে দুটি চ্যানেলে ইউজারকে অবশ্যই জয়েন থাকতে হবে
const REQUIRED_CHANNELS = [-1001941953227, -1002545410106];

function buildWelcomeMessage(fullName) {
    return (
        `🎉 স্বাগতম, ${fullName || 'Member'}! ✨\n\n` +
        `আমাদের কমিউনিটিতে যুক্ত হওয়ার জন্য অসংখ্য ধন্যবাদ। 🤝\n\n` +
        `📌 গ্রুপের নিয়মাবলি:\n` +
        `🚫 অপ্রয়োজনীয় লিংক বা স্প্যাম মেসেজ থেকে বিরত থাকুন।\n` +
        `💬 সবার সাথে সম্মানজনক আচরণ ও গ্রুপের শৃঙ্খলা বজায় রাখুন।\n\n` +
        `🌟 Hope you have an amazing time with us!`
    );
}

// ইউজারনেম না থাকলে বা শর্ত পূরণ না করলে বিনা নোটিফিকেশনে বের করে দেওয়া
async function kickWithoutNotification(bot, chatId, userId) {
    try {
        await bot.banChatMember(chatId, userId);
        await bot.unbanChatMember(chatId, userId);
    } catch (e) {
        console.error('Kick Error:', e.message);
    }
}

// নির্ধারিত সব চ্যানেলে ইউজার জয়েন আছে কি না যাচাই
async function isChannelMember(bot, userId) {
    if (!REQUIRED_CHANNELS || REQUIRED_CHANNELS.length === 0) {
        return true;
    }

    for (const channelId of REQUIRED_CHANNELS) {
        try {
            const member = await bot.getChatMember(channelId, userId);
            const isJoined = ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
            if (!isJoined) {
                return false;
            }
        } catch (e) {
            return false;
        }
    }

    return true;
}

async function handleWelcomeAndGate(bot, update) {
    if (!update) return false;

    // ১. জয়েন রিকুয়েস্ট আসলে (Join Request চালু থাকলে)
    if (update.chat_join_request) {
        const reqData = update.chat_join_request;
        const chatId = reqData.chat.id;
        const user = reqData.from;

        if (!TARGET_GROUPS.includes(chatId) || !user || user.is_bot) {
            return true;
        }

        // ইউজারনেম না থাকলে বিনা নোটিফিকেশনে রিকুয়েস্ট বাতিল
        if (!user.username) {
            try {
                await bot.declineChatJoinRequest(chatId, user.id);
            } catch (e) {}
            return true;
        }

        // উভয় চ্যানেলে মেম্বারশিপ চেক
        const inChannel = await isChannelMember(bot, user.id);
        if (!inChannel) {
            try {
                await bot.declineChatJoinRequest(chatId, user.id);
            } catch (e) {}
            return true;
        }

        // শর্ত পূরণ করলে অ্যাপ্রুভ ও ওয়েলকাম মেসেজ
        try {
            await bot.approveChatJoinRequest(chatId, user.id);
            const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;
            await bot.sendMessage(chatId, buildWelcomeMessage(fullName));
        } catch (e) {
            console.error('Approve/Welcome Error:', e.message);
        }

        return true;
    }

    // ২. সরাসরি গ্রুপে নতুন মেম্বার জয়েন করলে
    if (update.message && update.message.new_chat_members) {
        const msg = update.message;
        const chatId = msg.chat.id;

        if (!TARGET_GROUPS.includes(chatId)) {
            return true;
        }

        for (const member of msg.new_chat_members) {
            if (!member || member.is_bot) continue;

            // ইউজারনেম না থাকলে জয়েন মেসেজ মুছে বিনা নোটিফিকেশনে বের করা
            if (!member.username) {
                await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                await kickWithoutNotification(bot, chatId, member.id);
                continue;
            }

            // উভয় চ্যানেলে জয়েন না থাকলে বের করা
            const inChannel = await isChannelMember(bot, member.id);
            if (!inChannel) {
                await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                await kickWithoutNotification(bot, chatId, member.id);
                continue;
            }

            const fullName = `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.username;
            await bot.sendMessage(chatId, buildWelcomeMessage(fullName));
        }

        return true;
    }

    return false;
}

module.exports = { handleWelcomeAndGate };
