// api/welcome-gate.js

// যে গ্রুপগুলোতে এই সিস্টেম চলবে
const TARGET_GROUPS = [-1001651594619, -1002497459008];

// এই চ্যানেলগুলোর যেকোনো একটিতে জয়েন থাকলেই হবে
const REQUIRED_CHANNELS = [-1001941953227, -1002545410106];

// চ্যানেল থেকে বের হয়ে গেলে গ্রুপ থেকে শুধু কিক করা হবে (ব্যান হবে না)
const KICK_ON_CHANNEL_LEAVE = true;

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

// ব্যান না করে শুধু কিক করার ফাংশন (ban + সাথে সাথে unban)
async function kickWithoutNotification(bot, chatId, userId) {
    try {
        await bot.banChatMember(chatId, userId);
        await bot.unbanChatMember(chatId, userId);
    } catch (e) {
        console.error('Kick Error:', e.message);
    }
}

// নির্ধারিত চ্যানেলগুলোর যেকোনো একটিতে ইউজার জয়েন আছে কি না যাচাই
// সাময়িক API এরর হলে ভুল কিক এড়াতে true রিটার্ন করা হবে
async function isChannelMember(bot, userId) {
    if (!REQUIRED_CHANNELS || REQUIRED_CHANNELS.length === 0) {
        return true;
    }

    let joinedAnyChannel = false;
    let hadApiError = false;

    for (const channelId of REQUIRED_CHANNELS) {
        try {
            const member = await bot.getChatMember(channelId, userId);
            if (!member || !member.status) {
                continue;
            }

            if (['creator', 'administrator', 'member', 'restricted'].includes(member.status)) {
                joinedAnyChannel = true;
            }
        } catch (e) {
            hadApiError = true;
            console.error(`Channel check warning (${channelId}) for ${userId}:`, e.message);
        }
    }

    if (joinedAnyChannel) {
        return true;
    }

    // কোনো চ্যানেলে জয়েন না পেলে, সাময়িক API এরর হয়ে থাকলে ভুল কিক এড়াতে true রাখা হলো
    if (hadApiError) {
        return true;
    }

    return false;
}

// গ্রুপে মেসেজ পাঠানোর সময় ইউজার অন্তত একটি চ্যানেলে আছে কি না চেক করা
async function enforceChannelMembershipOnMessage(bot, msg) {
    if (!msg || !msg.chat || !msg.from) return false;
    if (msg.from.is_bot) return false;

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!TARGET_GROUPS.includes(chatId)) return false;

    // গ্রুপের অ্যাডমিনদের ছাড় দেওয়া হবে
    try {
        const groupMember = await bot.getChatMember(chatId, userId);
        if (groupMember && ['creator', 'administrator'].includes(groupMember.status)) {
            return false;
        }
    } catch (e) {
        return false;
    }

    const inAnyRequiredChannel = await isChannelMember(bot, userId);

    if (!inAnyRequiredChannel) {
        await bot.deleteMessage(chatId, msg.message_id).catch(() => {});

        if (KICK_ON_CHANNEL_LEAVE) {
            await kickWithoutNotification(bot, chatId, userId);
        }

        return true;
    }

    return false;
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

        // অন্তত একটি চ্যানেলে মেম্বারশিপ চেক
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

            // অন্তত একটি চ্যানেলে জয়েন না থাকলে বের করা
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

module.exports = {
    handleWelcomeAndGate,
    enforceChannelMembershipOnMessage
};
