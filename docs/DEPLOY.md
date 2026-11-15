# Putting the web version live (Vercel, free)

The web version is plain HTML, CSS and JavaScript, so Vercel can host it directly. No build step.

1. Push this repo to GitHub.
2. Open https://vercel.com/new and sign in with GitHub.
3. Import this repository.
4. Set **Root Directory** to `web` (click Edit next to it).
5. Framework Preset: **Other**. Leave Build Command and Output Directory empty.
6. Click Deploy. It is live in about a minute at `https://<project-name>.vercel.app`.
7. Put the link in the README (Live line) and in the GitHub About box (Website).

Every `git push` to `main` deploys again by itself.
