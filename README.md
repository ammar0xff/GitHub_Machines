# GitHub Machines

<p>
  <img src="https://img.shields.io/github/contributors/ammar0xff/GitHub_Machines.svg?style=for-the-badge&color=red" />
  <img src="https://img.shields.io/github/forks/ammar0xff/GitHub_Machines.svg?style=for-the-badge&color=red" />
  <img src="https://img.shields.io/github/stars/ammar0xff/GitHub_Machines?style=for-the-badge&color=red" />
  <img src="https://img.shields.io/github/issues/ammar0xff/GitHub_Machines.svg?style=for-the-badge&color=red" />
  <img src="https://img.shields.io/github/license/ammar0xff/GitHub_Machines?style=for-the-badge&color=red">
</p>

**GitHub Machines** is an automation solution that spins up a temporary Windows, Ubuntu, or macOS machine on a GitHub
Actions runner and exposes it through a public tunnel — no account or token required. It ships with a small web app
(`app/`) that launches, tracks, and stops machines from your phone or browser.

## Table of Contents

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li><a href="#features">Features</a></li>
    <li><a href="#installation">Installation</a></li>
    <li><a href="#usage">Usage</a>
      <ul>
        <li><a href="#web-app-recommended">Web App (recommended)</a></li>
        <li><a href="#triggering-the-workflows">Triggering the Workflows</a></li>
        <li><a href="#accessing-the-machines">Accessing the Machines</a>
          <ul>
            <li><a href="#windows">Windows</a></li>
            <li><a href="#ubuntu">Ubuntu</a></li>
            <li><a href="#macos">macOS</a></li>
          </ul>
        </li>
      </ul>
    </li>
    <li><a href="#customizing">Customizing</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## Features

- **Cross-Platform Support**: Gain access to Windows, Ubuntu, and macOS virtual machines using GitHub Actions.
- **Easy Setup**: Fork the repository and run the workflow — no cloud account, token, or payment method needed.
- **Universal Access**: Every machine opens a terminal in any modern browser, on any device — Windows, macOS, Linux,
  Android, iOS, even Chromebooks. Windows additionally offers full Remote Desktop.
- **Secure Access**: [bore](https://github.com/ekzhang/bore) creates an encrypted tunnel into the machine.
- **Customizable Workflows**: Modify the GitHub Actions workflows to suit your requirements.
- **Spins Down Automatically**: The machine stops when the run ends, so nothing lingers.
- **One-Tap Launcher App**: the bundled `app/` is a standalone PWA (no build step) with three machine cards that start,
  track, and stop machines, and surface Terminal / Files / Desktop access links.

### Built With

<p>
  <img src="https://img.shields.io/badge/github%20actions-%232671E5.svg?style=for-the-badge&logo=githubactions&logoColor=white" />
  <img src="https://img.shields.io/badge/GNU%20Bash-4EAA25?style=for-the-badge&logo=GNU%20Bash&logoColor=white" />
  <img src="https://img.shields.io/badge/PowerShell-5391FE?style=for-the-badge&logo=powershell&logoColor=white" />
  <img src="https://img.shields.io/badge/bore-10B981?style=for-the-badge&logo=rust&logoColor=white"/>
  <img src="https://img.shields.io/badge/ttyd-2496ED?style=for-the-badge&logo=docker&logoColor=white"/>
  <img src="https://img.shields.io/badge/vanilla%20js-black?style=for-the-badge&logo=javascript&logoColor=white"/>
</p>

## Installation

1. **Fork the Repository**: click the **Fork** button at the top right of this repository.

2. **Optional GitHub Secrets**: tunneling now uses [bore](https://github.com/ekzhang/bore) and its public relay
   (`bore.pub`), so **no secrets are required**. Set secrets in **Settings > Secrets and variables > Actions** only if
   you run your own relay or switch back to ngrok:

   | Secret        | Description                     |
   |---------------|---------------------------------|
   | `NGROK_TOKEN` | ngrok authentication token      |
   | `NGROK_DOMAIN`| ngrok reserved subdomain        |

## Usage

Once you've forked the repository, start a machine from the **Actions** tab, or from the launcher app. GitHub Actions is
free for public repositories and includes a monthly quota on private ones.

### Web App (recommended)

The app lives in `app/` and is plain HTML/CSS/JS — no build step. It's deployed to GitHub Pages by the
`deploy.yml` workflow at:

**https://ammar0xff.github.io/GitHub_Machines/**

It keeps the machine list and your settings in `localStorage`, updates live via the Actions API, and never stores
secrets server-side.

Config lives behind the **Settings** sheet:

| Field       | Required | What to put                                                       |
|-------------|----------|-------------------------------------------------------------------|
| Repo        | yes      | `owner/repo` (your fork, e.g. `you/GitHub_Machines`)              |
| Token       | yes      | a Personal Access Token with **Actions: Read and write** scope    |
| Password    | optional | how you'll log into Desktop/Files; shown next to the links        |

Launching and tracking both call the GitHub API, so the token is required even for public repos. To keep the machine
alive, the run holds a blocking `wait` step instead of ending.

Each card shows a live status strip (run number, current step, ticking countdown) and, once the machine is up, action
tiles:

| Machine | Terminal | Files          | Desktop                 |
|---------|----------|----------------|-------------------------|
| Ubuntu  | bash     | file manager   | noVNC (browser)         |
| Windows | cmd      | —              | RDP (`host:port`)       |
| macOS   | bash     | —              | VNC (`host:port`)       |

- **Open** jumps straight to the access link in a new tab; **copy** grabs the address (handy for RDP/VNC `host:port`).
- **Stop machine** cancels the run; the machine dies with it.

> The machine lives until the run finishes, you press **Stop machine**, or the `bore.pub` relay closes the tunnel
> (~6 hours maximum). Treat the tunnel URL as your key to the machine — share it the way you'd share a password.

### Triggering the Workflows

1. Go to the **Actions** tab in your repository.
2. Select the desired workflow (**Ubuntu**, **macOS**, or **Windows**).
3. Click **Run workflow**.
4. Wait for the job to boot, then open the machine as described below.

The launcher app starts the same workflows without visiting the Actions tab: it fires a `repository_dispatch` event
(`machine-ubuntu`, `machine-windows`, or `machine-macos`), then tracks the matching run from its logs.

> Each machine lives until the run finishes or the `bore.pub` relay closes the tunnel (~6 hours maximum). You can stop
> it early by canceling the run.

### Accessing the Machines

Every run prints its access links in two places:

1. A **notice** annotation and the run's **summary** page (`Summary` tab), as `http://bore.pub:PORT`.
2. A browser-friendly title banner in the **Start tunnel** step of the run log.

Because the tunnel URL is freshly generated per run, treat it as your key to the machine — share it the way you'd share a
password.

#### Windows

- **Browser terminal (recommended)**: open the `http://bore.pub:PORT` URL from the run summary — a `cmd` terminal loads
  in any modern browser on any device.
- **Full desktop via RDP**: open a remote desktop client (built into Windows, or the Microsoft Remote Desktop app for
  macOS/iOS/Android) and connect to the `bore.pub:PORT` RDP endpoint from the run summary with user **`runneradmin`** and
  password **`P@ssw0rd!123`**. Some RDP clients need the port appended as `bore.pub:PORT`.

#### Ubuntu

1. Read the run summary or the **Start tunnel** step. The endpoint is printed as `http://bore.pub:PORT`.
2. Open that URL in any browser — you get a `bash` terminal in the page (via ttyd), logged in as `runner`.

#### macOS

1. Read the run summary or the **Start tunnel** step. The endpoint is printed as `http://bore.pub:PORT`.
2. Open that URL in any browser — a macOS `bash` terminal (via Gotty) opens in the page, logged in as `runner`.

> Note: GitHub's macOS runner images require a paid plan for private repositories; public repositories can use them for
> free within the Actions quota. If your network blocks non-standard ports, try a phone hotspot or VPN — the bore relay
> uses a random high port.

## Customizing

Clone the repository to your local machine:

```bash
git clone https://github.com/yourusername/GitHub_Machines.git
cd GitHub_Machines
```

- **Swap the terminal**: replace ttyd/Gotty with any server you like (OpenSSH, code-server, VNC, ...) and forward the
  port with the same `bore local <port> --to bore.pub` command.
- **Use a fixed address**: run your own relay (`bore server`) and pass `--to yourhost:port`, or switch to ngrok with the
  `NGROK_TOKEN`/`NGROK_DOMAIN` secrets above.
- **Change the access credentials**: update the password in `Windows-latest.yml` (or run Gotty with `--credential`).

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any
contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also
simply open an issue with the tag "enhancement". Don't forget to give the project a star! Thanks again!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Top contributors:

<a href="https://github.com/ammar0xff/GitHub_Machines/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ammar0xff/GitHub_Machines" alt="contrib.rocks image" />
</a>

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

## Contact

Ammar Mohamed - [ammar0xff](https://github.com/ammar0xff)

Project Link: [https://github.com/ammar0xff/GitHub_Machines](https://github.com/ammar0xff/GitHub_Machines)

## Acknowledgments

- [ttyd](https://github.com/tsl0922/ttyd) — terminal in the browser (Ubuntu and Windows)
- [Gotty](https://github.com/yudai/gotty) — terminal in the browser (macOS)
- [Bore](https://github.com/ekzhang/bore) — dead-simple tunneling