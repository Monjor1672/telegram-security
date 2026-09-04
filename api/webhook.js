export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // security secret check (optional but recommended)
  const secret = process.env.TELEGRAM_SECRET;
  if (secret) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== secret) {
      return res.status(401).json({ ok: false, error: 'invalid secret' });
    }
  }

  let update = req.body;
  // In some environments body may be a string
  if (typeof update === 'string') {
    try { update = JSON.parse(update); } catch (e) { /* ignore */ }
  }

  try {
    // Example: echo back text messages
    if (update && update.message && update.message.text) {
      const chat_id = update.message.chat.id;
      const text = 'Echo: ' + update.message.text;

      // Vercel provides global fetch on Node 18
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
