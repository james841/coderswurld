# Putting Coderswurld Inventory online (Vercel + Supabase)

This takes about an hour the first time. Do the steps in order.

You will need:
- a GitHub account (Vercel deploys from GitHub)
- a Vercel account (vercel.com), signed in with GitHub
- a Supabase account (supabase.com)
- your domain name, if you have one (you can add it later)

---

## 1. Create the Supabase project (database + file storage)

1. On supabase.com, click **New project**.
2. **Region: choose London (eu-west-2).** The app on Vercel is set to run in
   London too (`vercel.json`), so the two sit next to each other and every
   page loads faster. If you pick another region, change `"regions"` in
   `vercel.json` to the Vercel region nearest to it.
3. Set a strong database password and **save it somewhere safe**.
4. When the project is ready, click **Connect** (top of the dashboard) and copy
   two connection strings:
   - **Transaction pooler** (port **6543**): this becomes `DATABASE_URL`
   - **Session pooler** (port **5432**): this becomes `DIRECT_URL`

   Replace `[YOUR-PASSWORD]` in both with your database password. If the
   password has `@ : / ? # %` in it, write `@` as `%40`, `:` as `%3A`, and so on.

5. **File storage for supplier receipts:** go to **Storage**, click
   **New bucket**, name it `receipts`, and leave **Public** switched **off**.
6. Go to **Project Settings, then API** and copy:
   - **Project URL**: this becomes `SUPABASE_URL`
   - **service_role** key (click Reveal): this becomes `SUPABASE_SERVICE_ROLE_KEY`.
     Treat it like a master password. It only ever goes into Vercel's settings.

## 2. Create the tables in Supabase (from your computer, once)

In your project folder, open the terminal and run (Windows PowerShell):

```
$env:DIRECT_URL="<your Session pooler string>"
$env:DATABASE_URL="<your Transaction pooler string>"
npx prisma migrate deploy
npx prisma db seed
```

`migrate deploy` creates every table. `db seed` creates your platform admin
account, using `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` from your
`.env` file, so set those to your real email and a strong password first.

Close that terminal afterwards so your normal `.env` (local database) is used
again.

## 3. Put the code on GitHub

1. Create a **private** repository on github.com, for example `coderswurld`.
2. In your project folder:

```
git init
git add .
git commit -m "Coderswurld Inventory"
git branch -M main
git remote add origin https://github.com/<your-username>/coderswurld.git
git push -u origin main
```

`.env` and the local `storage` folder are not uploaded (they are in
`.gitignore`). Never upload `.env`.

## 4. Deploy on Vercel

1. On vercel.com click **Add New, then Project**, and import the GitHub repository.
2. Framework: Next.js (detected). Leave the build settings as they are.
3. Open **Environment Variables** and add these (Production and Preview):

| Name | Value |
|---|---|
| `DATABASE_URL` | Transaction pooler string (port 6543) |
| `DIRECT_URL` | Session pooler string (port 5432) |
| `AUTH_SECRET` | a new long random string (see below) |
| `CRON_SECRET` | another long random string |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `SUPABASE_STORAGE_BUCKET` | `receipts` |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` (or the `.vercel.app` address for now) |
| `RESEND_API_KEY` | from resend.com |
| `MAIL_FROM` | `Coderswurld Inventory <no-reply@your-domain.com>` |
| `PLATFORM_ADMIN_EMAIL` | your email |
| `SALES_NOTIFICATION_EMAIL` | where plan requests should go |
| `SUPPORT_EMAIL`, `SUPPORT_PHONE`, `SUPPORT_WHATSAPP` | your real contacts |
| `GOOGLE_SITE_VERIFICATION` | optional, see step 6 |

Make a random string with:

```
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Use a **different** `AUTH_SECRET` from your local one.

4. Click **Deploy**. When it finishes, open the address Vercel gives you and sign
   in at `/platform/signin` with your platform admin account.

Every time you `git push` after this, Vercel deploys the new version by itself.

## 5. Your own domain

Vercel project, then **Settings, then Domains**, then add `your-domain.com`. Vercel shows the
DNS records to add at your domain seller. Then update `NEXT_PUBLIC_APP_URL` to
the domain and redeploy (Deployments, then the three dots, then Redeploy).

Also verify the domain in Resend so emails come from it.

## 6. Google Search Console

1. Go to search.google.com/search-console and click **Add property**.
2. The easiest choice is **Domain**: add the TXT record it shows at your domain
   seller. (Or choose **URL prefix**, then **HTML tag**, and copy only the
   `content="..."` value into `GOOGLE_SITE_VERIFICATION` on Vercel, then redeploy.)
3. After it is verified, open **Sitemaps** and submit: `sitemap.xml`
4. Use **URL inspection** on your home page and click **Request indexing**.

What is already in place:
- `/robots.txt` lets Google read the public site and keeps it out of every
  signed-in page (dashboard, till, platform console, API).
- `/sitemap.xml` lists the public pages.
- Every signed-in page also sends a `noindex` header, so it never shows in Google
  even if a link to it leaks.
- Preview deployments (`*.vercel.app` test versions) tell Google not to index
  them, so they never compete with your real domain.
- The home page carries structured data (product, plan prices in naira, FAQ)
  and a share picture for WhatsApp, Facebook, X and LinkedIn.

## 7. Daily summaries (scheduled job)

`vercel.json` runs `/api/cron/daily-reports` once a day at 21:00 UTC (10pm in
Lagos). Vercel sends the `CRON_SECRET` automatically. Shops whose report time is
on or before 10pm get their summary then.

On the free (Hobby) plan Vercel only allows once a day. On Pro you can make it
arrive at each shop's exact chosen time: change the schedule in `vercel.json` to
`"*/15 * * * *"` (every 15 minutes). It is safe to run often; each shop is only
sent one report a day.

## 8. Before real customers pay

- **Vercel Hobby (free) is for personal, non-commercial use only.** Once shops
  pay you, move to **Vercel Pro**.
- **Supabase Free pauses a project after a week with no activity and has no
  backups.** Move to **Supabase Pro** before real shops rely on it.
- Check the platform console and a test shop: sign in, add a product, sell at
  the till, file a supplier receipt (tests file storage), print a test receipt.

## Notes

- Uploads made on your own computer (in the `storage` folder) are not copied to
  Supabase. Shops start fresh online.
- To run migrations after a code change that adds one: repeat step 2 with the
  same two connection strings, before or right after you push.
- Moving later (to your own server): the app runs anywhere Node.js runs. Copy the
  database with `pg_dump` and the `receipts` bucket files; remove `SUPABASE_URL`
  to go back to storing files on the server's disk (`STORAGE_DIR`).
