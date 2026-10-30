# Trolley 🛒

The family shopping list. Sorted by aisle, remembers what you buy, syncs
between phones, works offline in the shop, and pulls in anything you say
to "Hey Google" via your Keep list.

## What's in here

- `public/` the app (one page, installs to the home screen)
- `public/catalog.js` aisles, starter items and the aisle-guessing rules. Edit freely.
- `api/list.js` the shared list (stored in Upstash Redis)
- `api/keep_sync.py` the Keep inbox: moves items from your Keep "shopping list" into the app
- `api/keep_pull.py` Keep bridge for Fo-odyssey: reads (then, once told, clears) the Keep "food list". Off unless `KEEP_BRIDGE_CODE` is set; `KEEP_BRIDGE_LISTS` limits which lists it may touch
- `get_token.py` one-off script to get the Google token for the Keep inbox
- `dev/server.js` local test server with a fake database (`node dev/server.js`, code `test`)

## Setup (about 15 minutes)

### 1. GitHub
Create an empty repo called `shopping-list` and put these files in it.

### 2. Vercel
1. **Add New > Project**, import `shopping-list`. Framework preset: **Other**.
   Leave build command empty; output directory `public`.
2. In the project, **Storage > Create Database > Upstash (Redis)**, free plan,
   connect it to the project. This adds `KV_REST_API_URL` and
   `KV_REST_API_TOKEN` automatically.
3. **Settings > Environment Variables**, add:

| Name | Value |
|---|---|
| `FAMILY_CODE` | Anything the family can remember, e.g. `darlo-snacks` |
| `GOOGLE_EMAIL` | mooksimpson@gmail.com |
| `GOOGLE_MASTER_TOKEN` | from step 3 below |
| `KEEP_LIST_TITLE` | `shopping list` (the Keep list's title, any capitals) |

4. Redeploy.

### 3. Google token (for the Keep inbox)
On your Mac, in this folder:

```
pip3 install gpsoauth
python3 get_token.py
```

Follow the prompts (the script explains where to grab the `oauth_token`
cookie). Paste the `aas_et/...` result into `GOOGLE_MASTER_TOKEN` in Vercel,
then redeploy. Treat it like a password.

Test it: say "Hey Google, add bananas to the shopping list", open the app,
Settings > **Pull from Keep now**.

### 4. Background sync (optional, recommended)
The app pulls from Keep whenever anyone opens it. To keep it tidy in between,
make a free job at [cron-job.org](https://cron-job.org) that calls this
every 10 minutes:

```
https://YOUR-APP.vercel.app/api/keep_sync?key=YOUR_FAMILY_CODE
```

### 5. Phones
Open the site, enter your name and the family code.
- **Android (Chrome):** menu > **Add to Home screen**
- **iPhone (Safari):** Share > **Add to Home Screen**

## How it behaves

- **Typing:** commas add several at once: `bread, 2 milk, eggs`
- **Mic button:** "milk and eggs and dishwasher tablets"
- **Tap an item** to change quantity, note or aisle. Move it once and it
  remembers that aisle forever.
- **Tick** as you shop; **Finish shop** clears ticked items and logs them, which
  feeds "The usuals" and "Probably running low".
- **Settings > Aisle order** to match your supermarket's walk-through.
- Duplicates are ignored (saying "milk" twice won't give you two milks).
- The dot top right: green synced, yellow saving, red offline (changes are
  kept and sent when you're back).

## When the Keep inbox breaks

It uses an unofficial Keep library, so Google may break it occasionally. The
list itself keeps working; voice items just wait in Keep. Usually the fix is
bumping `gkeepapi` in `requirements.txt`, or a fresh token if you changed your
Google password.
