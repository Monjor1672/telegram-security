export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // security secret check (optional but strongly recommended)
  const secret = process.env.TELEGRAM_SECRET;
  if (secret) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== secret) {
      return res.status(401).json({ ok: false, error: 'invalid secret' });
    }
  }

  const update = req.body;
  try {
    // Example: echo back text messages
    if (update && update.message && update.message.text) {
      const chat_id = update.message.chat.id;
      const text = 'Echo: ' + update.message.text;

      await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id, text }),
      });
    }
  } catch (err) {
    console.error('handler error', err);
  }

  // reply quickly to Telegram
  return res.status(200).json({ ok: true });
}
