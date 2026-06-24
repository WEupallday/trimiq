# TrimIQ — Run the working app

TrimIQ now actually works: upload a video, click **Generate Clean Edit**, and it
removes the silent/dead sections and gives you a cleaned video to download. The
video engine (ffmpeg) is bundled in automatically — you do NOT need Homebrew or
any separate install.

You only need to run two commands once. I'll explain exactly what they do.

## One-time: get the code ready

1. Put the `trimiq` folder somewhere easy, like your Desktop.
2. Open it in VS Code: **File → Open Folder** → choose `trimiq`.
3. Open the terminal inside VS Code: top menu **Terminal → New Terminal**.
   A panel opens at the bottom — that's where you type the two commands.

## Run it (two commands)

In that terminal, type this and press **Return**:

```bash
npm install
```

This downloads everything the app needs (libraries + the video engine). It can
take 1–3 minutes the first time and prints a lot of text — that's normal. Wait
until you get a normal prompt back.

Then type this and press **Return**:

```bash
npm run dev
```

When it finishes starting, it prints a line like `Local: http://localhost:3000`.

## See it work

1. Open your browser to **http://localhost:3000**
2. Click **Get started** (or **Generate Clean Edit**) — it takes you to the app.
3. Click the upload box, pick a short video that has some pauses/silence in it.
4. Click **Generate Clean Edit** and wait. When it's done you'll see how many
   seconds were removed, a preview of the cleaned video, and a **Download** button.

To stop the app, click in the terminal and press **Ctrl + C**.
To start it again later, just run `npm run dev` again (you only do `npm install` once).

## Good to know for the MVP

- Use a **short clip** to start (a few seconds to a couple of minutes). Big files
  work but take longer and use more memory while we're running on your laptop.
- "Login" and "Get started" both go to the app for now — real accounts come in the
  next milestone, so there's no password yet. That's intentional.
- The "5 edits left" badge is a placeholder until we build real edit-tracking.

## If something goes wrong

Copy the red error text from the terminal or the browser into the chat and I'll
tell you the fix. Common ones:
- `command not found: npm` → Node.js isn't installed. Get the LTS version from
  https://nodejs.org, run the installer, then reopen the terminal.
- It says the port is in use → run `npm run dev -- -p 3001` and use
  http://localhost:3001 instead.
