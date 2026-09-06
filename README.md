# GitHub Machines

Spin up a temporary **Windows, Ubuntu, or macOS** machine on a GitHub Actions runner and reach it straight from a browser.
Every machine gets a live web terminal; Windows also gets full Remote Desktop. No cloud account, API key, or payment
method required.

<p>
  <img alt="contributors" src="https://img.shields.io/github/contributors/ammar0xff/GitHub_Machines?style=for-the-badge&color=18181b" />
  <img alt="forks" src="https://img.shields.io/github/forks/ammar0xff/GitHub_Machines?style=for-the-badge&color=18181b" />
  <img alt="stars" src="https://img.shields.io/github/stars/ammar0xff/GitHub_Machines?style=for-the-badge&color=18181b" />
  <img alt="issues" src="https://img.shields.io/github/issues/ammar0xff/GitHub_Machines?style=for-the-badge&color=18181b" />
  <img alt="license" src="https://img.shields.io/github/license/ammar0xff/GitHub_Machines?style=for-the-badge&color=18181b" />
</p>

## How it works

- Each workflow boots a machine on a GitHub Actions runner, starts the access services, and then holds the run open so
  the machine stays alive.
- A [cloudflared](https://github.com/cloudflare/cloudflared) quick tunnel publishes an **HTTPS** console URL
  (`https://*.trycloudflare.com`). All terminals live under that single URL.
- On Windows, [bore](https://github.com/ekzhang/bore) also relays the Remote Desktop port (`bore.pub:PORT`) for native
  RDP clients.
- The bundled PWA (`app/`) launches, tracks, and stops machines and hands you the live access links. It is plain
  HTML/CSS/JS with no build step.

## Features

- **Cross-platform**: Windows, Ubuntu, and macOS runners, all on GitHub Actions.
- **Zero setup**: fork the repo and run a workflow. No cloud account, token, or payment method.
- **Universal access**: every machine opens a terminal in any modern browser on any device (Windows, macOS, Linux,
  Android, iOS, Chromebooks). Windows additionally offers full Remote Desktop.
- **HTTPS by default**: terminals are served over the TLS path on a trycloudflare origin.
- **Self-terminating**: the machine dies when the run ends (or you stop it), so nothing lingers.
- **One-tap launcher app**: three machine cards that start, track, and stop machines, with a ticking countdown and
  copy-ready access links.

### Built with

<p>
  <img alt="GitHub Actions" src="https://img.shields.io/badge/github%20actions-%232671E5.svg?style=for-the-badge&logo=githubactions&logoColor=white" />
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img alt="cloudflared" src="https://img.shields.io/badge/cloudflared-F38020?style=for-the-badge&logo=cloudflare&logoColor=white" />
  <img alt="bore" src="https://img.shields.io/badge/bore-10B981?style=for-the-badge&logo=rust&logoColor=white" />
  <img alt="ttyd" src="https://img.shields.io/badge/ttyd-2496ED?style=for-the-badge&logo=termius&logoColor=white" />
  <img alt="vanilla JS" src="https://img.shields.io/badge/vanilla%20js-black?style=for-the-badge&logo=javascript&logoColor=white" />
</p>

## What runs where

| Machine | Terminal              | Desktop       | Browser access                               |
|---------|-----------------------|---------------|----------------------------------------------|
| Ubuntu  | `bash` (ttyd)         | -             | console URL, terminal at `/term/`            |
| Windows | `cmd` (built in)      | Remote Desktop| console URL, terminal at `/term/`, RDP       |
| macOS   | `bash` (ttyd, brew)   | -             | console URL, terminal at `/term/`            |

Terminals are unauthenticated. The Windows RDP session uses user `runneradmin` and the machine password (see
[Setup secrets](#3-optional-setup-secrets)).

## Usage

### 1. Fork the repository

Click **Fork** at the top right of this page, or on GitHub use **Use this template**.

### 2. Open the launcher app (recommended)

The app is deployed to GitHub Pages by the `deploy.yml` workflow:

**https://ammar0xff.github.io/GitHub_Machines/**

On first launch, open **Settings** and set two fields:

| Field | Required | What to put                                                     |
|-------|----------|-----------------------------------------------------------------|
| Repo  | yes      | `owner/repo` (your fork, e.g. `you/GitHub_Machines`)            |
| Token | yes      | a Personal Access Token with **Actions: Read and write** scope  |

The token is stored only in `localStorage` and sent only to the GitHub API. It is required even for public repos because
launching and tracking both use the Actions API. Cancel it if it leaks; the token has no permissions beyond Actions.

Each card shows live status (run number, current state, ticking countdown) and, once the machine is up, its access
links:

- Ubuntu/macOS: a **Terminal** tile.
- Windows: a **Terminal** tile plus the **RDP credentials** line.

**Open** jumps to the link in a new tab; **copy** grabs the address (handy for native RDP `host:port`). **Stop machine**
cancels the run; the machine dies with it.

> The machine lives until the run finishes, you press **Stop machine**, or the relay window ends (~6 hours maximum).
> Treat the tunnel URL as your key to the machine: share it the way you would share a password.

### 3. Optional: setup secrets

Set any secrets in **Settings > Secrets and variables > Actions**:

| Secret             | Default                    | Used for                                             |
|--------------------|----------------------------|------------------------------------------------------|
| `MACHINE_PASSWORD` | `P@ssw0rd!123`             | Windows RDP password (set on `runneradmin`)          |

### 4. Accessing the machines

When you launch a machine, its access links appear in three places:

1. The run's **summary** page and **notice** annotations (for example `MAROHUB_CONSOLE`, `MAROHUB_TERMINAL`).
2. The live endpoint file published to the `machine-state/<kind>` branch, which the app polls while the run is alive.
3. The launcher app cards.

#### Windows

- **Browser terminal**: open the console URL from the app or run summary. A `cmd` shell loads in the page at `/term/`.
- **Embedded desktop**: the console page also carries a Remote Desktop viewer wired straight to the runner.
- **Native RDP**: connect any RDP client (built into Windows, Microsoft Remote Desktop on macOS/iOS/Android) to the
  `bore.pub:PORT` address with user **`runneradmin`** and the machine password. Some clients want the port appended as
  `bore.pub:PORT`.

#### Ubuntu and macOS

Open the console URL from the app or the run summary. A `bash` terminal loads in the page at `/term/` (user `runner`).
On macOS the runner is `macos-latest`; ttyd is installed via Homebrew, so the arm64 image is supported.

> GitHub's macOS runner images require a paid plan for private repositories; public repositories can use them within the
> Actions quota. The bore relay uses a random high port, so on networks that block non-standard ports try a phone
> hotspot or a VPN. workflows are free up to the Actions quota for public repos.

### Launching without the app

1. Open the **Actions** tab.
2. Pick the workflow you want (**Ubuntu**, **Windows**, or **macOS**).
3. Click **Run workflow**, then wait for the jobs to boot.

Each machine type runs in its own concurrency group, so launching the same OS again while one is live queues the new run
until the current one ends. To force a fresh machine, stop the running one first.

## Customizing

Clone the repository to work on it locally:

```bash
git clone https://github.com/yourusername/GitHub_Machines.git
cd GitHub_Machines
```

- **Swap the terminal server**: ttyd (Ubuntu/macOS) and the built-in Node terminal (Windows) both live in the machine
  console. Point the console at any HTTP endpoint you like by editing the workflow's service step and forwarding the
  matching port.
- **Run your own relay**: start `bore server` on a host you control and pass `--to yourhost:port` in the workflows
  instead of `bore.pub`.
- **Change RDP credentials**: set the `MACHINE_PASSWORD` secret (or edit the default in `Windows-machine.yml`).
- **Point the app at another repo**: change the `config.repo` default in `app/app.js`, or just edit the Repo field in
  the app's Settings sheet.
- **Redeploy the app**: pushing to `main` runs `deploy.yml`, which publishes the PWA to GitHub Pages. Bump the cache name
  in `app/sw.js` when you change app files so stale clients refresh.

## Directory layout

```
app/                           PWA launcher (no build step)
machine-console/               console + terminals served on the runners
.github/workflows/
  Ubuntu.yml                   Ubuntu machine (bash via ttyd)
  Windows-machine.yml          Windows machine (cmd + RDP)
  macOS.yml                    macOS machine (bash via ttyd/brew)
  deploy.yml                   GitHub Pages publish
```

## Contributing

Contributions are welcome. Open an issue for bugs or ideas, or fork and open a pull request:

1. Fork the project.
2. Create a branch (`git checkout -b feature/cool-thing`).
3. Commit your changes (`git commit -m 'Add a cool thing'`).
4. Push (`git push origin feature/cool-thing`) and open a pull request.

## License

Distributed under the MIT License. See [LICENSE](LICENSE).

## Acknowledgments

- [ttyd](https://github.com/tsl0922/ttyd) - terminal in the browser (Ubuntu, macOS)
- [cloudflared](https://github.com/cloudflare/cloudflared) - HTTPS quick tunnels
- [Bore](https://github.com/ekzhang/bore) - TCP relay for Remote Desktop
- [LCXL Remote Desk](https://github.com/lcxl-remote/lcxl-remote-desk-web) - WebRTC desktop probe on Windows