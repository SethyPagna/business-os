# Releasing Business OS without Claude: setup guide

This guide is for the owner. It needs no programming. There are three ways to
release a new version. Set up at least one of them.

| Route | Where it runs | Use it when |
| --- | --- | --- |
| **A. The release menu** (`run\release.bat`) | your computer | you are at your computer and the VPN is set up as in part C |
| **B. GitHub "Deploy" button** | GitHub's computers | you want the release to run without your network at all |
| **C. VPN split tunnel** | your computer | this makes route A work while Claude keeps working |

> **The one rule that matters most**
>
> Your VPN is set to **"Only allow selected apps"** (ChatGPT, Claude, Copilot,
> Google Chrome). Anything Claude starts, and anything started from Chrome,
> goes through the VPN, and Cloudflare blocks the VPN.
>
> So **always run `run\release.bat` from a normal window you open yourself:**
> press the Windows key, type **Terminal**, and open **Windows Terminal** (or
> **PowerShell**). **Not** from inside Claude, and **not** from Chrome.
>
> For the Cloudflare and GitHub web pages below, use **Microsoft Edge**. Edge
> is not in the VPN list, so Cloudflare sees your normal home connection.

Never paste a token, a password or a screenshot of one into Claude, ChatGPT,
a chat, an email or a file. If that ever happens, delete the token (part A,
step 10) and make a new one.

---

## Part A. Make a Cloudflare API token

You need this for route B (GitHub). Route A can use it too, but it can also
use a normal `wrangler login`.

1. Open **Microsoft Edge** and go to <https://dash.cloudflare.com>. Log in.
2. Click the **person icon** at the top right, then **My Profile**.
3. On the left, click **API Tokens**.
4. Click **Create Token**.
5. Next to **Edit Cloudflare Workers**, click **Use template**.
6. Under **Permissions**, check the list has these rows. Click
   **+ Add more** for any that are missing:
   - Account | **Workers Scripts** | Edit
   - Account | **D1** | Edit
   - Account | **Workers KV Storage** | Edit
   - Account | **Queues** | Edit
   - Account | **Workers R2 Storage** | Edit (needed later for the image move)
   - Account | **Account Settings** | Read
   - Zone | **Workers Routes** | Edit
   - User | **User Details** | Read
7. Under **Account Resources**, choose **Include** and **your account only**
   (not "All accounts").
8. Under **Zone Resources**, choose **Include**, **Specific zone**,
   **leangbeauty.com**.
9. Under **TTL** (how long the token works), pick an end date about
   **6 months** away and put a reminder in your calendar a week before it.
   An expired token only stops releases; it breaks nothing in the shop.
10. Click **Continue to summary**, then **Create Token**.
11. **Copy the token once**, straight into the GitHub box in part B, step 4.
    Cloudflare shows it only once. Do not save it in a file, a note, a chat
    or a screenshot. If you lose it, delete it on the API Tokens page
    (**...** next to it, **Delete**) and make a new one.

**Your Account ID:** on <https://dash.cloudflare.com>, click
**Workers & Pages** on the left. The **Account ID** is on the right side of
that page; click it to copy. It is not secret like the token, but still keep
it out of chats.

If a later deploy stops with "Authentication error" or "code: 10000", the
token is missing a permission. Send Claude the run link (not the token).

## Part B. GitHub: the "Deploy" button

### B1. Save the two secrets (once)

1. In **Microsoft Edge**, open the Business OS repository on GitHub.
2. Click **Settings** (top row of the repository, right side).
3. On the left: **Secrets and variables**, then **Actions**.
4. Click **New repository secret**. Name: `CLOUDFLARE_API_TOKEN`.
   Secret: paste the token from part A. Click **Add secret**.
5. Click **New repository secret** again. Name: `CLOUDFLARE_ACCOUNT_ID`.
   Secret: paste the Account ID. Click **Add secret**.

The names must be exactly as written, in capitals.

### B2. Make every release wait for your click (once)

1. **Settings**, then **Environments** on the left.
2. Click **New environment**, type `production`, click
   **Configure environment**.
3. Tick **Required reviewers**, type your GitHub name, pick yourself, click
   **Save protection rules**.
4. Under **Deployment branches and tags**, choose **Selected branches and
   tags**, click **Add deployment branch or tag rule**, type `main`, and save.
   (This means only the workflow from `main` can release. Ask Claude before
   changing it.)

### B3. Release

1. Open the repository, click the **Actions** tab.
2. On the left, click **Deploy**.
3. Click **Run workflow** (right side). Fill in:
   - **Use workflow from**: `main`
   - **Branch or commit to release**: what Claude told you (for example
     `claude/urgent-20260925`)
   - **Cloudflare plan**: `paid` (production runs paid)
   - **Apply waiting database updates**: leave ticked
   - **Type DEPLOY to confirm**: `DEPLOY`
4. Click the green **Run workflow**.
5. Click the new run. It waits with **Review deployments**. Click it, tick
   **production**, click **Approve and deploy**.
6. Wait. The tests take the longest (up to about an hour). Every step gets a
   green tick when it is done.
7. At the end, scroll down on the run page to the **summary**: the commit,
   the restore point, row counts before and after, and live checks.

### B4. Undo a release

1. **Actions** tab, **Deploy rollback** on the left, **Run workflow**.
2. **What to put back**:
   - `worker` puts the website back. Leave the version id empty to go back
     one version, or paste "Worker version before" from the Deploy summary.
   - `database` puts a database back to the restore point from the Deploy
     summary. **Every sale and change made after that moment is lost.**
     Only do this when Claude says so.
3. Type `ROLLBACK` in the confirm box, run it, approve the review as in B3.

### B5. When a step is red

- A red cross means that step failed and **nothing after it ran**. A red
  test step means nothing was released.
- Send Claude **the link of the run page** (copy it from Edge's address bar).
  Never the token.

## Part C. VPN split tunnel

Your VPN offers three modes: "allow all apps", "do not allow selected apps",
and "only allow selected apps". Use **Only allow selected apps to use the
VPN**, and add only:

1. The Claude desktop app:
   `C:\Program Files\WindowsApps\Claude_...\app\claude.exe`
2. Claude Code inside it:
   `C:\Users\<your Windows name>\AppData\Roaming\Claude\claude-code\<version>\claude.exe`
3. Your browser only if you use claude.ai or ChatGPT in it (you use Chrome;
   then do the Cloudflare and GitHub pages in **Edge**).

Everything else (Windows Terminal, Node, git, wrangler) then goes directly
to the internet, so Cloudflare sees your normal home connection.

Things to know:

- **The Claude Code folder has a version number in its name.** After Claude
  updates, the VPN may need the new folder added. You will notice because
  Claude stops working, or the release menu's network check starts saying
  "blocked" again. Then add the new `claude-code\<version>\claude.exe`.
- **`WindowsApps` is a hidden, protected folder.** If the VPN's file picker
  cannot open it, start Claude first and choose it from the VPN's list of
  running apps instead.
- Anything Claude starts inherits the VPN, which is why Claude itself still
  cannot release. That is expected; it is why the menu exists.

**Self-check:** open **Windows Terminal from the Start menu**, run
`run\release.bat`, choose **1 Network check**. Both lines must say **OK**. If
it says "BLOCKED", this window is going through the VPN: close it, open
Windows Terminal from the Start menu (not from Claude), and try again.

## Part D. The release menu in six lines

1. Open **Windows Terminal from the Start menu**, go to the Business OS
   folder (`cd` to it), run `run\release.bat`.
2. **1** checks the network; **2 FULL RELEASE** does everything in order and
   stops at the first problem.
3. It asks which branch (Enter keeps Claude's default), shows the commit and
   asks you to confirm; it builds a clean copy in `Worktrees\release`.
4. It runs every test, saves a restore point and row counts, shows waiting
   database updates, and asks you to type **YES** before changing production.
5. After publishing it checks the live site and compares row counts.
6. **10** undoes a release (asks twice). Every run saves a log in
   `Records\Deploys\<date>-<commit>\`; Claude reads it, you copy nothing.
