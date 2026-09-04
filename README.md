# Telegram Webhook Bot (Vercel)

Install files in repo and deploy on Vercel.

Required environment variables (set these in Vercel Dashboard → Project → Settings → Environment Variables):
- BOT_TOKEN  (from BotFather)
- TELEGRAM_SECRET  (random string, optional but recommended)

Quick steps (mobile friendly):
1. Add files to repo (package.json, api/webhook.js, etc).
2. Go to https://vercel.com → New Project → Import your GitHub repo → Deploy.
3. In Vercel Project Settings → Environment Variables add BOT_TOKEN and TELEGRAM_SECRET and redeploy.
4. Set webhook (open this URL in mobile browser, replace <NEW_TOKEN> and <PROJECT_URL> and <YOUR_SECRET>):
   - With secret:
     https://api.telegram.org/bot<NEW_TOKEN>/setWebhook?url=https://<PROJECT_URL>/api/webhook&secret_token=<YOUR_SECRET>
   - Without secret:
     https://api.telegram.org/bot<NEW_TOKEN>/setWebhook?url=https://<PROJECT_URL>/api/webhook

Verify:
- https://api.telegram.org/bot<NEW_TOKEN>/getMe
- https://api.telegram.org/bot<NEW_TOKEN>/getWebhookInfo

Notes:
- NEVER commit BOT_TOKEN to GitHub. Use Vercel env vars.
- Use mobile browser to paste setWebhook URL (URL encoding usually not required for simple URLs).
