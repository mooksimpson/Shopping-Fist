"""One-off: get the Google 'master token' the Keep inbox needs.

Run this on your own computer (not on Vercel):

    pip install gpsoauth
    python get_token.py

It asks for:
  1. Your Google email.
  2. An "oauth_token" cookie. To get it:
       - Open https://accounts.google.com/EmbeddedSetup in Chrome
       - Sign in to the Google account that owns the Keep list
       - Click "I agree" (the page may then spin forever, that's fine)
       - Open DevTools (Cmd+Option+I) > Application > Cookies >
         accounts.google.com, and copy the value of "oauth_token"
         (starts with "oauth2_4/"). It expires in a few minutes, so be quick.

It prints a token starting with "aas_et/". Paste that into Vercel as
GOOGLE_MASTER_TOKEN. Treat it like a password: it can read your Google
account, so never commit it or paste it into chats.

To revoke it later: Google Account > Security > Your devices, and sign out
the "Android" device it created, or change your password.
"""
import getpass
import secrets

import gpsoauth

email = input("Google email: ").strip()
oauth_token = getpass.getpass("oauth_token cookie (hidden): ").strip()
android_id = secrets.token_hex(8)

result = gpsoauth.exchange_token(email, oauth_token, android_id)
token = result.get("Token")
if not token:
    print("\nDidn't work. Google said:", result.get("Error") or result)
    print("Grab a fresh oauth_token cookie and try again straight away.")
else:
    print("\nGOOGLE_MASTER_TOKEN =", token)
